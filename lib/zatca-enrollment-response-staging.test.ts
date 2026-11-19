import { CreateSecretCommand, DescribeSecretCommand, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createZatcaEnrollmentResponseStager } from './zatca-enrollment-response-staging';
import { createStoredZatcaPreparation } from './zatca-stored-signer';

function fixture() {
  const config = { region: 'eu-central-1', accountId: '123456789012', encryptionKeyArn: 'arn:aws:kms:eu-central-1:123456789012:key/' + randomUUID() };
  const context = { organizationId: randomUUID(), connectionId: randomUUID(), environment: 'SIMULATION', enrollmentId: randomUUID(),
    enrollmentDigest: 'a'.repeat(64), dispatchId: randomUUID() as string, kmsKeyArn: 'arn:aws:kms:eu-central-1:123456789012:key/' + randomUUID() };
  const response = { requestId: '1234567890', binarySecurityToken: 'MAA=', secret: 'SYNTHETIC_PRIVATE_CREDENTIAL' };
  const name = `zakatflow/fatoora-enrollment/${context.organizationId}/simulation/${context.connectionId}/${context.enrollmentId}/${context.dispatchId}`;
  const arn = `arn:aws:secretsmanager:${config.region}:${config.accountId}:secret:${name}-ABC123`;
  const state = { content: undefined as string | undefined, writes: 0, lostCreateAck: false,
    metadata: { ARN: arn, Name: name, KmsKeyId: config.encryptionKeyArn } as Record<string,unknown>,
    saved: {} as Record<string,unknown>, created: {} as Record<string,unknown> };
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof CreateSecretCommand) {
      if (state.content !== undefined) throw Object.assign(new Error(response.secret), { name: 'ResourceExistsException' });
      state.content = command.input.SecretString; state.writes++;
      if (state.lostCreateAck) throw new Error(response.secret);
      return { ARN: arn, Name: name, VersionId: context.dispatchId, ...state.created };
    }
    if (command instanceof DescribeSecretCommand) {
      if (!state.content) throw new Error(response.secret); return { ...state.metadata };
    }
    if (command instanceof GetSecretValueCommand) {
      if (!state.content) throw new Error(response.secret);
      return { ARN: arn, Name: name, VersionId: context.dispatchId, SecretString: state.content, VersionStages: ['AWSCURRENT'], ...state.saved };
    }
    throw new Error('Unexpected AWS operation');
  });
  const client = { send }, stager = createZatcaEnrollmentResponseStager(client as never, config);
  const stage = () => stager.stageResponse(context, response), recover = () => stager.recoverResponse(context);
  return { config, context, response, name, arn, state, client, send, stager, stage, recover };
}
describe('immutable isolated enrollment-response quarantine with mocked AWS transport', () => {
  it('uses a deterministic separate secret and exact dispatch VersionId, validates readback and returns no credentials', async () => {
    const f = fixture(), r = await f.stage();
    expect(r.stage).toBe('ENROLLMENT_RESPONSE_QUARANTINED_ONLY'); expect(r.reference.secretArn).toBe(f.arn);
    expect(r.reference.secretVersionId).toBe(f.context.dispatchId); expect(r.reference.responseSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(f.send.mock.calls.map(([c]) => (c as object).constructor.name)).toEqual(['CreateSecretCommand','DescribeSecretCommand','GetSecretValueCommand']);
    const create = f.send.mock.calls[0][0] as CreateSecretCommand;
    expect(create.input.Name).toBe(f.name); expect(create.input.KmsKeyId).toBe(f.config.encryptionKeyArn); expect(create.input.ClientRequestToken).toBe(f.context.dispatchId);
    expect(create.input.Tags).not.toContainEqual(expect.objectContaining({ Value: f.response.secret }));
    expect((f.send.mock.calls[2][0] as GetSecretValueCommand).input).toEqual({ SecretId: f.arn, VersionId: f.context.dispatchId });
    expect(JSON.parse(f.state.content!).context).toEqual(f.context); expect(JSON.parse(f.state.content!).response).toEqual(f.response);
    expect(JSON.stringify(r)).not.toContain(f.response.secret); expect(JSON.stringify(r)).not.toContain(f.response.binarySecurityToken);
  });
  it('cannot pass a quarantine ARN into the active stored signer', async () => {
    const f = fixture(), r = await f.stage(); f.send.mockClear();
    const scope = { organizationId: f.context.organizationId, environment: 'SIMULATION', connectionId: f.context.connectionId,
      unitId: f.context.connectionId, documentId: randomUUID(), invoiceUuid: randomUUID() };
    const binding = { version: 'ZATCA_SAVED_SIGNER_V1', organizationId: scope.organizationId, environment: scope.environment,
      connectionId: scope.connectionId, unitId: scope.unitId, kmsKeyArn: f.context.kmsKeyArn, secretArn: r.reference.secretArn,
      secretVersionId: r.reference.secretVersionId, certificateFingerprintSha256: r.reference.binarySecurityTokenSha256,
      issuerChainDerBase64: ['MAA='], policy: { identifier: 'https://example.invalid/policy', digestSha256Base64: 'A'.repeat(43) + '=' }, includeSimplifiedQr: false };
    await expect(createStoredZatcaPreparation(binding, scope, { secrets: f.client, kms: { send: vi.fn() } } as never)).rejects.toThrow('STORED_SIGNER_REFERENCE_INVALID');
    expect(f.send).not.toHaveBeenCalled();
  });
  it('recovers the same immutable reference after losing the original process response, without creating a secret or version', async () => {
    const f = fixture(), first = await f.stage(); f.send.mockClear();
    expect(await f.recover()).toEqual(first); expect(f.send.mock.calls.map(([c]) => (c as object).constructor.name)).toEqual(['DescribeSecretCommand','GetSecretValueCommand']); expect(f.state.writes).toBe(1);
  });
  it('reconciles ResourceExists with the exact original version/content without PutSecretValue or changing active credentials', async () => {
    const f = fixture(), first = await f.stage(); expect(await f.stage()).toEqual(first); expect(f.state.writes).toBe(1);
  });
  it('reconciles a lost CreateSecret acknowledgement through an exact read, without a second write', async () => {
    const f = fixture(); f.state.lostCreateAck = true; const r = await f.stage();
    expect(r.reference.secretVersionId).toBe(f.context.dispatchId); expect(f.state.writes).toBe(1); expect(await f.recover()).toEqual(r);
  });
  it('supports concurrent identical staging calls with only one stored immutable version', async () => {
    const f = fixture(), rows = await Promise.all(Array.from({ length: 8 }, f.stage));
    rows.forEach(r => expect(r).toEqual(rows[0])); expect(f.state.writes).toBe(1);
  });
  it.each(['requestId','binarySecurityToken','secret'])('refuses changed %s on retry instead of overwriting the first response', async field => {
    const f = fixture(), first = await f.stage();
    f.response[field as keyof typeof f.response] = field === 'requestId' ? '123' : field === 'binarySecurityToken' ? 'MAE=' : 'DIFFERENT_PRIVATE_CREDENTIAL';
    await expect(f.stage()).rejects.toThrow('ENROLLMENT_RESPONSE_CONTENT_CHANGED'); expect(await f.recover()).toEqual(first); expect(f.state.writes).toBe(1);
  });
  it.each(['otp','url','role','secretArn'])('rejects extra response %s without AWS calls', async field => {
    const f = fixture(); await expect(f.stager.stageResponse(f.context, { ...f.response, [field]: 'override' })).rejects.toThrow('ENROLLMENT_RESPONSE_INPUT_INVALID'); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['requestId','codec','secret'])('rejects invalid normalized %s without AWS calls', async mode => {
    const f = fixture(); if (mode === 'requestId') f.response.requestId = 'invalid'; if (mode === 'codec') f.response.binarySecurityToken += '='; if (mode === 'secret') f.response.secret = 'value\n';
    await expect(f.stage()).rejects.toThrow('ENROLLMENT_RESPONSE_INPUT_INVALID'); expect(f.send).not.toHaveBeenCalled();
  });
  it('rejects caller context overrides and wrong signing-key scope without AWS calls', async () => {
    const f = fixture(); await expect(f.stager.stageResponse({ ...f.context, actorId: randomUUID() }, f.response)).rejects.toThrow('ENROLLMENT_RESPONSE_CONTEXT_INVALID');
    f.context.kmsKeyArn = f.config.encryptionKeyArn; await expect(f.stage()).rejects.toThrow('ENROLLMENT_RESPONSE_KEY_SCOPE_INVALID'); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['account','key','extra'])('rejects invalid protected %s configuration', mode => {
    const f = fixture(); const config = mode === 'account' ? { ...f.config, accountId: '000000000000' } : mode === 'key' ? { ...f.config, encryptionKeyArn: 'alias/key' } : { ...f.config, endpoint: 'https://override.invalid' };
    expect(() => createZatcaEnrollmentResponseStager(f.client as never, config)).toThrow('ENROLLMENT_RESPONSE_CONFIG_INVALID'); expect(f.send).not.toHaveBeenCalled();
  });
  it.each(['ARN','Name','VersionId'])('rejects wrong CreateSecret %s response instead of adopting it', async field => {
    const f = fixture(); f.state.created[field] = 'invalid'; await expect(f.stage()).rejects.toThrow('ENROLLMENT_RESPONSE_CREATE_RECEIPT_INVALID');
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each(['ARN','Name','KmsKeyId','DeletedDate','RotationEnabled','OwningService','ReplicationStatus'])('rejects incompatible quarantine metadata %s', async field => {
    const f = fixture(); await f.stage(); f.state.metadata[field] = field === 'RotationEnabled' ? true : field === 'DeletedDate' ? new Date() : field === 'ReplicationStatus' ? [{ Region: 'other' }] : 'invalid';
    await expect(f.recover()).rejects.toThrow('ENROLLMENT_RESPONSE_METADATA_INVALID');
  });
  it.each(['ARN','Name','VersionId','SecretBinary'])('rejects wrong GetSecretValue %s without returning content', async field => {
    const f = fixture(); await f.stage(); f.state.saved[field] = field === 'SecretBinary' ? Buffer.from('private') : 'invalid';
    await expect(f.recover()).rejects.toThrow('ENROLLMENT_RESPONSE_VERSION_INVALID');
  });
  it.each(['json','extra','duplicate','scope','version','codec','whitespace'])('rejects corrupt or ambiguous stored %s content', async mode => {
    const f = fixture(); await f.stage(); const parsed = JSON.parse(f.state.content!);
    if (mode === 'json') f.state.content = 'not json';
    if (mode === 'extra') f.state.content = JSON.stringify({ ...parsed, extra: true });
    if (mode === 'duplicate') f.state.content = f.state.content!.replace('"version":', '"version":"IGNORED_DUPLICATE","version":');
    if (mode === 'scope') { parsed.context.enrollmentDigest = 'b'.repeat(64); f.state.content = JSON.stringify(parsed); }
    if (mode === 'version') { parsed.version = 'OTHER'; f.state.content = JSON.stringify(parsed); }
    if (mode === 'codec') { parsed.response.binarySecurityToken += '='; f.state.content = JSON.stringify(parsed); }
    if (mode === 'whitespace') f.state.content += '\n';
    await expect(f.recover()).rejects.toThrow('ENROLLMENT_RESPONSE_CONTENT_INVALID');
  });
  it.each(['create','describe','get'])('sanitizes %s transport failure and never exposes cause or credentials', async step => {
    const f = fixture(), base = f.send.getMockImplementation()!;
    if (step !== 'create') await f.stage();
    f.send.mockImplementation(async command => {
      if ((step === 'create' && command instanceof CreateSecretCommand) || (step === 'describe' && command instanceof DescribeSecretCommand) || (step === 'get' && command instanceof GetSecretValueCommand)) throw new Error(f.response.secret, { cause: new Error('PRIVATE_PASSWORD') });
      return base(command);
    });
    const error = await (step === 'create' ? f.stage() : f.recover()).catch(error => error);
    expect(error.message).toBe('ENROLLMENT_RESPONSE_RECOVERY_REQUIRED'); expect(error.cause).toBeUndefined(); expect(String(error)).not.toContain(f.response.secret);
  });
  it('captures protected config, context, response and AWS send before asynchronous staging', async () => {
    const f = fixture(), context = { ...f.context }, response = { ...f.response }; let resume!: () => void;
    const base = f.send.getMockImplementation()!;
    f.send.mockImplementationOnce(async command => { await new Promise<void>(r => { resume = r; }); return base(command); });
    const pending = f.stager.stageResponse(context, response); context.enrollmentDigest = 'b'.repeat(64); response.secret = 'CHANGED'; f.config.encryptionKeyArn = 'invalid';
    f.client.send = vi.fn(async () => { throw new Error('changed transport'); }); resume();
    const r = await pending; expect(r.reference.secretVersionId).toBe(f.context.dispatchId); expect(JSON.parse(f.state.content!).response.secret).toBe(f.response.secret);
  });
});
