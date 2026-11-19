import { GetPublicKeyCommand, SignCommand } from '@aws-sdk/client-kms';
import { CreateSecretCommand, DescribeSecretCommand, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertSimulationQaTarget, createSimulationQa, simulationQaRole, simulationQaSigningKey } from '../scripts/zatca/simulation-qa';

let directory: string, spki: Buffer, keyPath: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'simulation-qa-'));
  const keys = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  spki = keys.publicKey.export({ type: 'spki', format: 'der' });
  keyPath = join(directory, 'synthetic.key');
  writeFileSync(keyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
const fail = (name: string): never => { const error = new Error('PRIVATE_UPSTREAM_DIAGNOSTIC'); error.name = name; throw error; };
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const unit = { organizationId: randomUUID(), connectionId: randomUUID(), enrollmentId: randomUUID(),
    commonName: 'Synthetic Simulation QA', taxpayerVatNumber: '312345678901233', legalName: 'شركة الاختبار الاصطناعي',
    branchName: 'Riyadh QA', branchLocation: 'AAAA1234', industry: 'Software', email: 'qa@example.invalid',
    egsSerialNumber: '1-QA|2-1|3-' + randomUUID(), invoiceType: '1100' };
  const config = { unit, sourceSha: 'a'.repeat(40), encryptionKeyArn: 'arn:aws:kms:eu-north-1:701899214938:key/' + randomUUID() };
  const map = new Map<string, { content: string; version: string; arn: string; key: string }>();
  const state = { originalLostAck: false, intentLostAck: false, responseLostAck: false, intentBadAck: false,
    wrongKey: false, deny: false, disableSigning: false, validCertificate: false, requestFail: false, createUpserts: false };
  const secrets = { send: vi.fn(async (command: unknown) => {
    if (state.deny) return fail('AccessDeniedException');
    if (command instanceof CreateSecretCommand) {
      const i = command.input, name = i.Name!;
      if (map.has(name) && !state.createUpserts) return fail('ResourceExistsException');
      const entry = { content: i.SecretString!, version: i.ClientRequestToken!,
        arn: 'arn:aws:secretsmanager:eu-north-1:701899214938:secret:' + name + '-ABC123', key: i.KmsKeyId! };
      map.set(name, entry);
      if ((name.endsWith('/original-csr') && state.originalLostAck) || (name.endsWith('/dispatch-once') && state.intentLostAck)
        || (!name.endsWith('/original-csr') && !name.endsWith('/dispatch-once') && state.responseLostAck)) return fail('TimeoutError');
      return { ARN: entry.arn, Name: name, VersionId: name.endsWith('/dispatch-once') && state.intentBadAck ? randomUUID() : entry.version };
    }
    if (command instanceof DescribeSecretCommand || command instanceof GetSecretValueCommand) {
      const id = command.input.SecretId, found = [...map].find(([name, entry]) => name === id || entry.arn === id);
      if (!found) return fail('ResourceNotFoundException');
      const [name, entry] = found;
      if (command instanceof DescribeSecretCommand) return { ARN: entry.arn, Name: name, KmsKeyId: entry.key };
      if (command.input.VersionId && command.input.VersionId !== entry.version) return fail('ResourceNotFoundException');
      return { ARN: entry.arn, Name: name, VersionId: entry.version, SecretString: entry.content };
    }
    throw new Error('Unexpected Secrets Manager operation');
  }) };
  const kms = { send: vi.fn(async (command: unknown) => {
    if (command instanceof GetPublicKeyCommand) return { KeyId: state.wrongKey ? simulationQaSigningKey.replace('ab50c7e0','00000000') : simulationQaSigningKey,
      KeySpec: 'ECC_SECG_P256K1', KeyUsage: 'SIGN_VERIFY', SigningAlgorithms: ['ECDSA_SHA_256'], PublicKey: spki };
    if (command instanceof SignCommand) {
      if (state.disableSigning) return fail('DisabledException');
      expect(command.input.MessageType).toBe('DIGEST');
      const signature = execFileSync('openssl', ['pkeyutl','-sign','-inkey',keyPath,'-pkeyopt','digest:sha256'],
        { input: Buffer.from(command.input.Message!), stdio: ['pipe','pipe','pipe'] });
      return { KeyId: simulationQaSigningKey, SigningAlgorithm: 'ECDSA_SHA_256', Signature: signature };
    }
    throw new Error('Unexpected KMS operation');
  }) };
  const transport = vi.fn(async () => {
    if (state.requestFail) throw new Error('654321 PRIVATE_CREDENTIAL');
    let certificate = 'MAA=';
    if (state.validCertificate) {
      const saved = JSON.parse([...map].find(([name]) => name.endsWith('/original-csr'))![1].content);
      const csr = join(directory, unit.enrollmentId + '.csr'), output = join(directory, unit.enrollmentId + '.pem');
      writeFileSync(csr, saved.csrPem);
      execFileSync('openssl', ['x509','-req','-in',csr,'-signkey',keyPath,'-copy_extensions','copy','-set_serial','12345','-days','1','-out',output], { stdio: 'pipe' });
      const der = new X509Certificate(readFileSync(output)).raw;
      certificate = Buffer.from(der.toString('base64')).toString('base64');
    }
    return new Response(JSON.stringify({ requestID: '12345678901234567890', dispositionMessage: 'ISSUED', binarySecurityToken: certificate,
      secret: 'PRIVATE_CREDENTIAL', errors: null }));
  });
  const create = (value: unknown = config) => createSimulationQa({ kms: kms as never, secrets: secrets as never, transport }, value);
  return { config, unit, map, state, kms, secrets, transport, create, api: create(), original: () => [...map].find(([n]) => n.endsWith('/original-csr'))!,
    intent: () => [...map].find(([n]) => n.endsWith('/dispatch-once'))! };
}
const otpInput = (status: { csrSha256: string | null }) => ({ otp: '654321', csrSha256: status.csrSha256 });

describe('isolated Simulation QA durable original and one-shot secret fence', () => {
  it('is read-only until preparation, never calls the authority, preserves the exact signed original on reload', async () => {
    const f = fixture();
    expect((await f.api.status()).state).toBe('NOT_PREPARED'); expect(f.map.size).toBe(0);
    const prepared = await f.api.prepareOriginal();
    expect(prepared.state).toBe('READY_FOR_OTP'); expect(f.transport).not.toHaveBeenCalled(); expect(f.map.size).toBe(2);
    const original = f.original()[1].content, signs = f.kms.send.mock.calls.length;
    expect((await f.create().prepareOriginal()).csrSha256).toBe(prepared.csrSha256);
    expect(f.original()[1].content).toBe(original);
    expect(f.kms.send.mock.calls.slice(signs).some(([c]) => c instanceof SignCommand)).toBe(false);
    const value = JSON.parse(original);
    expect(value.savedUnit.csrSha256).toBe(prepared.csrSha256);
    expect(JSON.stringify(prepared)).not.toContain('CERTIFICATE REQUEST');
    expect(JSON.stringify(prepared)).not.toContain('kmsPublicKey');
  });
  it('sends the original PEM once and stores original, intent and response only in the encrypted Simulation namespace', async () => {
    const f = fixture(), prepared = await f.api.prepareOriginal();
    const result = await f.api.submitOtp(otpInput(prepared));
    expect(result).toMatchObject({ state: 'RESPONSE_QUARANTINED', identityMatched: false, trustVerified: false, activationAllowed: false });
    expect(f.map.size).toBe(4); expect(f.transport).toHaveBeenCalledTimes(1);
    const [url, request] = f.transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance');
    expect(Buffer.from(JSON.parse(String(request.body)).csr, 'base64').toString()).toBe(JSON.parse(f.original()[1].content).csrPem);
    expect([...f.map.values()].every(e => e.key === f.config.encryptionKeyArn)).toBe(true);
    expect([...f.map].every(([name]) => name.startsWith('zakatflow/fatoora-enrollment/' + f.unit.organizationId + '/simulation/'))).toBe(true);
    expect([...f.map.values()].some(e => e.content.includes('"otp"'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_CREDENTIAL');
    await f.create().submitOtp({ ...otpInput(prepared), otp: '111111' });
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('verifies a real same-key CSR/certificate identity through a double-base64 token without granting CA trust or activation', async () => {
    const f = fixture(); f.state.validCertificate = true;
    const result = await f.api.submitOtp(otpInput(await f.api.prepareOriginal()));
    expect(result).toMatchObject({ state: 'RESPONSE_QUARANTINED', identityMatched: true, trustVerified: false, activationAllowed: false });
  });
  it('allows only one authority request across simultaneous worker instances', async () => {
    const f = fixture(), input = otpInput(await f.api.prepareOriginal());
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => f.create().submitOtp(input)));
    expect(f.transport).toHaveBeenCalledTimes(1); expect(f.map.size).toBe(4);
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    expect((await f.api.status()).state).toBe('RESPONSE_QUARANTINED');
  });
  it('recovers original/response lost acknowledgements without changing the saved bytes or resending', async () => {
    const f = fixture(); f.state.originalLostAck = true; f.state.responseLostAck = true;
    const prepared = await f.api.prepareOriginal(), original = f.original()[1].content;
    expect((await f.api.submitOtp(otpInput(prepared))).state).toBe('RESPONSE_QUARANTINED');
    expect(f.original()[1].content).toBe(original); expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it.each(['intentLostAck','intentBadAck'] as const)('requires reconciliation after %s and never sends', async mode => {
    const f = fixture(), input = otpInput(await f.api.prepareOriginal()); f.state[mode] = true;
    await expect(f.api.submitOtp(input)).rejects.toThrow('QA_RECONCILIATION_REQUIRED');
    expect(f.transport).not.toHaveBeenCalled();
    expect((await f.create().submitOtp(input)).state).toBe('RECONCILIATION_REQUIRED');
    expect(f.transport).not.toHaveBeenCalled();
  });
  it('never retries an ambiguous authority result after reload or a new OTP', async () => {
    const f = fixture(), input = otpInput(await f.api.prepareOriginal()); f.state.requestFail = true;
    const error = await f.api.submitOtp(input).catch(e => e);
    expect(error.message).toBe('QA_RECONCILIATION_REQUIRED'); expect(error.cause).toBeUndefined();
    expect((await f.create().submitOtp({ ...input, otp: '111111' })).state).toBe('RECONCILIATION_REQUIRED');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
  it('refuses signing disabled after preparation without consuming a dispatch intent', async () => {
    const f = fixture(), input = otpInput(await f.api.prepareOriginal()); f.state.disableSigning = true;
    await expect(f.api.submitOtp(input)).rejects.toThrow('QA_SIGNING_KEY_UNAVAILABLE');
    expect(f.intent()).toBeUndefined(); expect(f.transport).not.toHaveBeenCalled();
  });
  it('refuses wrong KMS metadata and storage permission failures without creating an original', async () => {
    const f = fixture(); f.state.wrongKey = true;
    await expect(f.api.prepareOriginal()).rejects.toThrow('QA_SIGNING_KEY_INVALID'); expect(f.map.size).toBe(0);
    f.state.deny = true;
    await expect(f.api.status()).rejects.toThrow('QA_PRIVATE_STORAGE_UNAVAILABLE'); expect(f.transport).not.toHaveBeenCalled();
  });
  it('refuses OTP readiness if CreateSecret can upsert the same name instead of rejecting it', async () => {
    const f = fixture(); f.state.createUpserts = true;
    await expect(f.api.prepareOriginal()).rejects.toThrow('QA_STORAGE_FENCE_UNVERIFIED');
    expect(f.original()).toBeUndefined(); expect(f.transport).not.toHaveBeenCalled();
  });
  it('performs the existing-name proof before the durable original is signed and stored', async () => {
    const f = fixture(); await f.api.prepareOriginal();
    const creates = f.secrets.send.mock.calls.filter(([c]) => c instanceof CreateSecretCommand).map(([c]) => (c as CreateSecretCommand).input);
    const probes = creates.filter(c => c.Name!.endsWith('/storage-fence-probe'));
    expect(probes).toHaveLength(2); expect(probes[0].ClientRequestToken).not.toBe(probes[1].ClientRequestToken);
    expect(probes[0].SecretString).not.toBe(probes[1].SecretString);
    expect(JSON.parse(f.original()[1].content).createOnlyFenceVerified).toBe(true);
  });
  it('rejects changed original/profile/metadata instead of adopting or overwriting it', async () => {
    const f = fixture(); await f.api.prepareOriginal(); const [name, saved] = f.original();
    const old = saved.content; saved.content = JSON.stringify({ ...JSON.parse(old), profileDigest: '0'.repeat(64) });
    await expect(f.api.prepareOriginal()).rejects.toThrow('QA_ORIGINAL_CHANGED');
    saved.content = old;
    await expect(f.create({ ...f.config, unit: { ...f.unit, legalName: 'Another company' } }).status()).rejects.toThrow('QA_ORIGINAL_CHANGED');
    saved.key = simulationQaSigningKey;
    await expect(f.api.status()).rejects.toThrow('QA_PRIVATE_STORAGE_INVALID'); expect(f.map.get(name)!.content).toBe(old);
    expect(f.transport).not.toHaveBeenCalled();
  });
  it.each([{ otp: '٦٥٤٣٢١' }, { endpoint: 'https://override.invalid' }, { environment: 'PRODUCTION' }, { csrSha256: '0'.repeat(64) }])
    ('rejects input or saved-request overrides: %j', async change => {
      const f = fixture(), input = otpInput(await f.api.prepareOriginal());
      await expect(f.api.submitOtp({ ...input, ...change })).rejects.toThrow(/QA_(OTP_INPUT_INVALID|ORIGINAL_CHANGED)/);
      expect(f.transport).not.toHaveBeenCalled(); expect(f.intent()).toBeUndefined();
    });
  it('captures private configuration before asynchronous operations', async () => {
    const f = fixture(), prepared = await f.api.prepareOriginal();
    f.config.unit.legalName = 'Mutated'; f.config.encryptionKeyArn = simulationQaSigningKey;
    expect((await f.api.status()).csrSha256).toBe(prepared.csrSha256);
  });
  it('keeps the same original across a code-version update', async () => {
    const f = fixture(), prepared = await f.api.prepareOriginal(), saved = f.original()[1].content;
    const updated = f.create({ ...f.config, sourceSha: 'b'.repeat(40) });
    expect((await updated.prepareOriginal()).csrSha256).toBe(prepared.csrSha256);
    expect(f.original()[1].content).toBe(saved);
    expect(JSON.parse(saved).sourceSha).toBe('a'.repeat(40));
  });
});

describe('strict platform-owned isolated preview identity', () => {
  const claims = { sub: 'owner:oalhalabioa-9334:project:yaqeen-fatoora-qa:environment:preview',
    iss: 'https://oidc.vercel.com/oalhalabioa-9334', aud: 'https://vercel.com/oalhalabioa-9334' };
  const env = { VERCEL_ENV: 'preview', FATOORA_QA_AWS_REGION: 'eu-north-1', FATOORA_QA_AWS_ROLE_ARN: simulationQaRole,
    FATOORA_QA_KMS_KEY_ARN: simulationQaSigningKey, VERCEL_OIDC_TOKEN: 'synthetic.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.not-a-real-token' };
  it('accepts only the pre-existing isolated QA target', () => { expect(() => assertSimulationQaTarget(env)).not.toThrow(); });
  it.each([{ VERCEL_ENV: 'production' }, { FATOORA_QA_AWS_ROLE_ARN: 'another-role' }, { FATOORA_QA_KMS_KEY_ARN: 'another-key' },
    { FATOORA_QA_AWS_REGION: 'eu-central-1' }, { VERCEL_OIDC_TOKEN: 'invalid' }])('rejects wrong protected environment: %j', change => {
      expect(() => assertSimulationQaTarget({ ...env, ...change })).toThrow(/QA_(TARGET|IDENTITY)_REQUIRED/);
    });
  it.each(['sub','iss','aud'])('rejects another %s claim before any cloud client is constructed', key => {
    const token = 'synthetic.' + Buffer.from(JSON.stringify({ ...claims, [key]: 'another' })).toString('base64url') + '.signature';
    expect(() => assertSimulationQaTarget({ ...env, VERCEL_OIDC_TOKEN: token })).toThrow('QA_IDENTITY_REQUIRED');
  });
});
