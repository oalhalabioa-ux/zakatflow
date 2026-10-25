import { CreateSecretCommand, DescribeSecretCommand, GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const uuid = z.string().uuid(), pin = z.string().regex(/^[a-f0-9]{64}$/);
const keyArn = z.string().regex(/^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const contextSchema = z.object({ organizationId: uuid, connectionId: uuid, environment: z.enum(['SIMULATION','PRODUCTION']),
  enrollmentId: uuid, enrollmentDigest: pin, dispatchId: uuid, kmsKeyArn: keyArn,
}).strict();
const configSchema = z.object({ region: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)+$/), accountId: z.string().regex(/^[0-9]{12}$/), encryptionKeyArn: keyArn }).strict();
const responseSchema = z.object({ requestId: z.string().regex(/^[0-9]{1,40}$/),
  binarySecurityToken: z.string().min(4).max(32768).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  secret: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/),
}).strict();
export const zatcaEnrollmentQuarantineReferenceSchema = z.object({ version: z.literal('ZATCA_ENROLLMENT_QUARANTINE_V1'),
  secretArn: z.string().min(20).max(2048), secretVersionId: uuid, encryptionKeyArn: keyArn,
  responseSha256: pin, binarySecurityTokenSha256: pin,
}).strict();
const envelopeSchema = z.object({ version: z.literal('ZATCA_ENROLLMENT_RESPONSE_V1'), context: contextSchema, response: responseSchema }).strict();
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fail = (code: string): never => { throw new Error(code); };
function normalizedResponse(value: unknown) {
  const response = responseSchema.parse(value), der = Buffer.from(response.binarySecurityToken, 'base64');
  if (der.toString('base64') !== response.binarySecurityToken) fail('ENROLLMENT_RESPONSE_INPUT_INVALID');
  return response;
}
function envelope(context: z.infer<typeof contextSchema>, response: z.infer<typeof responseSchema>) {
  // Fixed member order; reject noncanonical/duplicate/extra JSON on readback.
  return JSON.stringify({ version: 'ZATCA_ENROLLMENT_RESPONSE_V1', context, response });
}

/** Protected backend primitive only, with injected AWS transport/configuration.
 * No client construction, authority call, authorization or activation occurs.
 * Inputs are saved trusted dispatch context + normalized in-memory authority data,
 * never HTTP JSON. VersionId is the saved dispatch UUID. Quarantine is a separate
 * secret namespace and cannot be used as the active signer's credential ARN.
 * Recovery never creates/replaces versions and returns no credential material.
 */
export function createZatcaEnrollmentResponseStager(secrets: Pick<SecretsManagerClient, 'send'>, protectedConfig: unknown) {
  let config: z.infer<typeof configSchema>;
  try {
    config = configSchema.parse(protectedConfig);
    if (!config.encryptionKeyArn.startsWith(`arn:aws:kms:${config.region}:${config.accountId}:key/`)) throw new Error();
  } catch { return fail('ENROLLMENT_RESPONSE_CONFIG_INVALID'); }
  const send = secrets.send.bind(secrets);
  function parseContext(value: unknown) {
    let context: z.infer<typeof contextSchema>;
    try { context = contextSchema.parse(value); }
    catch { return fail('ENROLLMENT_RESPONSE_CONTEXT_INVALID'); }
    if (!context.kmsKeyArn.startsWith(`arn:aws:kms:${config.region}:${config.accountId}:key/`)
      || context.kmsKeyArn === config.encryptionKeyArn) fail('ENROLLMENT_RESPONSE_KEY_SCOPE_INVALID');
    return context;
  }
  const name = (c: z.infer<typeof contextSchema>) => `zakatflow/fatoora-enrollment/${c.organizationId}/${c.environment.toLowerCase()}/${c.connectionId}/${c.enrollmentId}/${c.dispatchId}`;
  function validArn(arn: unknown, secretName: string): arn is string {
    const prefix = `arn:aws:secretsmanager:${config.region}:${config.accountId}:secret:${secretName}-`;
    return typeof arn === 'string' && arn.startsWith(prefix) && /^[A-Za-z0-9]{6}$/.test(arn.slice(prefix.length));
  }
  async function read(context: z.infer<typeof contextSchema>, expected?: string, createdArn?: string) {
    const secretName = name(context);
    let metadata, saved;
    try { metadata = await send(new DescribeSecretCommand({ SecretId: createdArn ?? secretName })); }
    catch { return fail('ENROLLMENT_RESPONSE_RECOVERY_REQUIRED'); }
    if (!metadata || !validArn(metadata.ARN, secretName) || metadata.Name !== secretName || metadata.KmsKeyId !== config.encryptionKeyArn
      || metadata.DeletedDate !== undefined || (metadata.RotationEnabled !== undefined && metadata.RotationEnabled !== false) || metadata.OwningService !== undefined
      || (metadata.ReplicationStatus !== undefined && (!Array.isArray(metadata.ReplicationStatus) || metadata.ReplicationStatus.length > 0))
      || (createdArn !== undefined && metadata.ARN !== createdArn)) return fail('ENROLLMENT_RESPONSE_METADATA_INVALID');
    try { saved = await send(new GetSecretValueCommand({ SecretId: metadata.ARN, VersionId: context.dispatchId })); }
    catch { return fail('ENROLLMENT_RESPONSE_RECOVERY_REQUIRED'); }
    if (!saved || saved.ARN !== metadata.ARN || saved.Name !== secretName || saved.VersionId !== context.dispatchId
      || saved.SecretBinary !== undefined || typeof saved.SecretString !== 'string' || Buffer.byteLength(saved.SecretString, 'utf8') > 65536)
      return fail('ENROLLMENT_RESPONSE_VERSION_INVALID');
    let decoded: z.infer<typeof envelopeSchema>, canonical: string;
    try {
      decoded = envelopeSchema.parse(JSON.parse(saved.SecretString));
      const response = normalizedResponse(decoded.response);
      const savedContext = contextSchema.parse(decoded.context);
      if (JSON.stringify(savedContext) !== JSON.stringify(context)) throw new Error();
      canonical = envelope(savedContext, response);
      if (saved.SecretString !== canonical) throw new Error();
    } catch { return fail('ENROLLMENT_RESPONSE_CONTENT_INVALID'); }
    if (expected !== undefined && canonical !== expected) return fail('ENROLLMENT_RESPONSE_CONTENT_CHANGED');
    return { stage: 'ENROLLMENT_RESPONSE_QUARANTINED_ONLY' as const, reference: {
      version: 'ZATCA_ENROLLMENT_QUARANTINE_V1' as const, secretArn: metadata.ARN, secretVersionId: saved.VersionId,
      encryptionKeyArn: config.encryptionKeyArn, responseSha256: sha(canonical),
      binarySecurityTokenSha256: sha(Buffer.from(decoded.response.binarySecurityToken, 'base64')) } };
  }
  return {
    async stageResponse(contextValue: unknown, normalizedResponseValue: unknown) {
      const context = parseContext(contextValue); let response: z.infer<typeof responseSchema>;
      try { response = normalizedResponse(normalizedResponseValue); }
      catch { return fail('ENROLLMENT_RESPONSE_INPUT_INVALID'); }
      const secretName = name(context), content = envelope(context, response);
      if (secretName.length > 512 || Buffer.byteLength(content, 'utf8') > 65536) return fail('ENROLLMENT_RESPONSE_INPUT_INVALID');
      let created;
      try {
        created = await send(new CreateSecretCommand({ Name: secretName, KmsKeyId: config.encryptionKeyArn,
          ClientRequestToken: context.dispatchId, SecretString: content,
          Description: 'Unverified enrollment response quarantine. Not an active signer credential.',
          Tags: [{ Key: 'application', Value: 'zakatflow' }, { Key: 'purpose', Value: 'enrollment-quarantine' },
            { Key: 'organization_id', Value: context.organizationId }] }));
      } catch {
        // Includes ResourceExists and lost acknowledgements: only read the exact
        // deterministic name/version. Never PutSecretValue, overwrite or resend.
        return read(context, content);
      }
      if (!created || !validArn(created.ARN, secretName) || created.Name !== secretName || created.VersionId !== context.dispatchId)
        return fail('ENROLLMENT_RESPONSE_CREATE_RECEIPT_INVALID');
      return read(context, content, created.ARN);
    },
    async recoverResponse(contextValue: unknown) { return read(parseContext(contextValue)); },
  };
}
