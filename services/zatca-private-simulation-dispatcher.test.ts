import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createZatcaCsr } from '../lib/vat-zatca-csr';
import { createZatcaPrivateSimulationDispatcher } from './zatca-private-simulation-dispatcher';

const mocks = vi.hoisted(() => ({ load: vi.fn(), claim: vi.fn(), stage: vi.fn(), record: vi.fn() }));
vi.mock('./zatca-private-enrollment-reader', () => ({ createVerifiedZatcaEnrollmentReader: () => ({ loadOriginalEnrollment: mocks.load }) }));
vi.mock('./zatca-private-enrollment-dispatch', () => ({ createVerifiedZatcaEnrollmentDispatch: () => ({ claimInitialDispatch: mocks.claim }) }));
vi.mock('./zatca-private-enrollment-response', () => ({ createVerifiedZatcaEnrollmentResponseStore: () => ({ recordResponseReference: mocks.record }) }));
vi.mock('../lib/zatca-enrollment-response-staging', () => ({ createZatcaEnrollmentResponseStager: () => ({ stageResponse: mocks.stage }) }));
const config = { region: 'eu-central-1', accountId: '123456789012', encryptionKeyArn: 'arn:aws:kms:eu-central-1:123456789012:key/' + randomUUID() };
const keyArn = 'arn:aws:kms:eu-central-1:123456789012:key/' + randomUUID();
const input = { organizationId: randomUUID(), connectionId: randomUUID(), environment: 'SIMULATION',
  enrollmentId: randomUUID(), dispatchId: randomUUID(), otp: '654321' };
const token = 'SYNTHETIC.TOKEN', marker = 'SYNTHETIC_SECRET_NEVER_RETURN';
let original: Record<string, any>, spki: Buffer;
let order: string[];
const kms = { send: vi.fn() }, transport = vi.fn();
const factory = (settings: unknown = config) => createZatcaPrivateSimulationDispatcher({} as never, {} as never,
  { kms: kms as never, secrets: {} as never, transport }, settings);
beforeAll(async () => {
  const keys = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  spki = keys.publicKey.export({ type: 'spki', format: 'der' });
  const fields = { environment: 'SIMULATION' as const, commonName: 'Saved synthetic unit', taxpayerVatNumber: '312345678901233',
    branchName: 'Riyadh', organizationName: 'Synthetic Company', serialNumber: '1-QA|2-1|3-unit', invoiceType: '1100',
    registeredAddress: 'Riyadh', businessCategory: 'Software', email: 'qa@example.invalid' };
  const csrPem = await createZatcaCsr(fields, spki, async bytes => sign('sha256', bytes, keys.privateKey));
  const der = Buffer.from(csrPem.replace(/-----[^\n]+-----/g, '').replace(/\s/g, ''), 'base64');
  original = { enrollmentId: input.enrollmentId, enrollmentDigest: 'a'.repeat(64), kmsKeyArn: keyArn, csrPem,
    savedUnit: { organizationId: input.organizationId, connectionId: input.connectionId, unitId: input.connectionId,
      environment: 'SIMULATION', profile: 'ZAKATFLOW_SAN_DIRECTORY_V2', csrSha256: createHash('sha256').update(der).digest('hex'),
      kmsPublicKeySpkiBase64: spki.toString('base64'), taxpayerVatNumber: fields.taxpayerVatNumber, commonName: fields.commonName,
      branchName: fields.branchName, legalName: fields.organizationName, egsSerialNumber: fields.serialNumber, invoiceType: fields.invoiceType,
      branchLocation: fields.registeredAddress, industry: fields.businessCategory, email: fields.email } };
});
beforeEach(() => {
  vi.resetAllMocks(); order = [];
  mocks.load.mockImplementation(async () => { order.push('load'); return structuredClone(original); });
  kms.send.mockImplementation(async () => { order.push('key'); return { KeyId: keyArn, KeySpec: 'ECC_SECG_P256K1', KeyUsage: 'SIGN_VERIFY', SigningAlgorithms: ['ECDSA_SHA_256'], PublicKey: spki }; });
  mocks.claim.mockImplementation(async () => { order.push('claim'); return { decision: 'FIRST_INTENT_RECORDED' }; });
  transport.mockImplementation(async () => { order.push('http'); return new Response(JSON.stringify({ requestID: 123, dispositionMessage: 'ISSUED', binarySecurityToken: 'MAA=', secret: marker })); });
  mocks.stage.mockImplementation(async () => { order.push('quarantine'); return { reference: { private: 'saved' } }; });
  mocks.record.mockImplementation(async () => { order.push('receipt'); return { receiptDigest: 'b'.repeat(64) }; });
});
describe('private Simulation one-shot orchestration', () => {
  it('checks the real CSR and KMS key, claims once, sends once, quarantines, then records a freshly authorized reference', async () => {
    const result = await factory().submitOriginal(token, input);
    expect(order).toEqual(['load', 'key', 'claim', 'http', 'quarantine', 'receipt']);
    expect(result).toEqual({ stage: 'SIMULATION_RESPONSE_QUARANTINED_ONLY', enrollmentId: input.enrollmentId,
      dispatchId: input.dispatchId, receiptDigest: 'b'.repeat(64), activationAllowed: false });
    expect(JSON.stringify(result)).not.toContain(marker); expect(JSON.stringify(result)).not.toContain(input.otp);
    const { otp: _otp, ...scope } = input;
    expect(mocks.claim).toHaveBeenCalledWith(token, { ...scope, enrollmentDigest: original.enrollmentDigest });
    expect(mocks.record).toHaveBeenCalledWith(token, { ...scope, enrollmentDigest: original.enrollmentDigest }, { private: 'saved' });
    expect(mocks.stage.mock.calls[0][1]).toEqual({ requestId: '123', binarySecurityToken: 'MAA=', secret: marker });
  });
  it.each([{ environment: 'PRODUCTION' }, { otp: '٦٥٤٣٢١' }, { kmsKeyArn: keyArn }, { csrPem: 'override' }, { enrollmentDigest: '0'.repeat(64) }])
    ('rejects client overrides before private reads: %j', async change => {
      await expect(factory().submitOriginal(token, { ...input, ...change })).rejects.toThrow('SIMULATION_ENROLLMENT_INPUT_INVALID');
      expect(mocks.load).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
    });
  it('never sends on replay, even if the earlier call failed before returning a response', async () => {
    transport.mockRejectedValueOnce(new Error(marker));
    const runner = factory();
    await expect(runner.submitOriginal(token, input)).rejects.toThrow('SIMULATION_ENROLLMENT_RECONCILIATION_REQUIRED');
    mocks.claim.mockResolvedValueOnce({ decision: 'RECONCILIATION_REQUIRED' });
    await expect(runner.submitOriginal(token, input)).rejects.toThrow('SIMULATION_ENROLLMENT_RECONCILIATION_REQUIRED');
    expect(transport).toHaveBeenCalledTimes(1); expect(mocks.stage).not.toHaveBeenCalled();
  });
  it.each(['stage', 'record'] as const)('does not retry or leak credentials after lost %s acknowledgement', async step => {
    mocks[step].mockRejectedValueOnce(new Error(marker));
    const error = await factory().submitOriginal(token, input).catch(e => e);
    expect(error.message).toBe('SIMULATION_ENROLLMENT_RECONCILIATION_REQUIRED'); expect(error.cause).toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects changed saved identity before KMS, claim or network', async () => {
    const changed = structuredClone(original); changed.savedUnit.commonName = 'Substituted'; mocks.load.mockResolvedValueOnce(changed);
    await expect(factory().submitOriginal(token, input)).rejects.toThrow('SIMULATION_ENROLLMENT_PREPARATION_FAILED');
    expect(kms.send).not.toHaveBeenCalled(); expect(mocks.claim).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it('does not consume the intent when KMS returns a different key', async () => {
    kms.send.mockResolvedValueOnce({ KeyId: keyArn, KeySpec: 'ECC_SECG_P256K1', KeyUsage: 'SIGN_VERIFY', SigningAlgorithms: ['ECDSA_SHA_256'],
      PublicKey: generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).publicKey.export({ type: 'spki', format: 'der' }) });
    await expect(factory().submitOriginal(token, input)).rejects.toThrow('SIMULATION_ENROLLMENT_KEY_CHECK_FAILED');
    expect(mocks.claim).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it('rejects another enrollment or cloud account before claiming', async () => {
    for (const change of [{ enrollmentId: randomUUID() }, { kmsKeyArn: keyArn.replace('123456789012', '123456789013') }]) {
      mocks.load.mockResolvedValueOnce({ ...structuredClone(original), ...change });
      await expect(factory().submitOriginal(token, input)).rejects.toThrow(/SIMULATION_ENROLLMENT_(ORIGIN_MISMATCH|KEY_CHECK_FAILED)/);
    }
    expect(mocks.claim).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });
  it('preserves read authorization denial and requires reconciliation after an uncertain claim commit', async () => {
    mocks.load.mockRejectedValueOnce(new Error('ORGANIZATION_ADMIN_REQUIRED'));
    await expect(factory().submitOriginal(token, input)).rejects.toThrow('ORGANIZATION_ADMIN_REQUIRED');
    mocks.claim.mockRejectedValueOnce(new Error(marker));
    await expect(factory().submitOriginal(token, input)).rejects.toThrow('SIMULATION_ENROLLMENT_RECONCILIATION_REQUIRED');
    expect(transport).not.toHaveBeenCalled();
  });
  it('captures caller inputs and protected configuration before asynchronous reads', async () => {
    const settings = { ...config }, values = { ...input }, runner = factory(settings);
    let resume!: () => void;
    mocks.load.mockImplementationOnce(async () => { await new Promise<void>(r => { resume = r; }); return structuredClone(original); });
    const pending = runner.submitOriginal(token, values); values.otp = '111111'; values.organizationId = randomUUID(); settings.accountId = '000000000000'; resume();
    await pending;
    expect(transport.mock.calls[0][1].headers.OTP).toBe(input.otp);
    expect(mocks.claim.mock.calls[0][1].organizationId).toBe(input.organizationId);
  });
  it('rejects an injected endpoint in protected configuration', () => {
    expect(() => factory({ ...config, endpoint: 'https://override.invalid' })).toThrow('SIMULATION_ENROLLMENT_CONFIG_INVALID');
  });
});
