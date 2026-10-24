import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { KMSClient } from '@aws-sdk/client-kms';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createZatcaKmsSigner } from './zatca-kms-signer';
import { inspectZatcaSigningCertificate } from './zatca-signing-certificate';
import { prepareReservedZatcaArtifact, zatcaPreparationScopeSchema } from './zatca-reserved-preparation';

const bindingSchema = zatcaPreparationScopeSchema.omit({ documentId: true, invoiceUuid: true }).extend({
  version: z.literal('ZATCA_SAVED_SIGNER_V1'),
  kmsKeyArn: z.string().max(2048), secretArn: z.string().max(2048),
  secretVersionId: z.string().regex(/^[\x21-\x7e]{32,64}$/),
  certificateFingerprintSha256: z.string().regex(/^[a-f0-9]{64}$/),
  issuerChainDerBase64: z.array(z.string().min(1).max(32768)).min(1).max(5),
  policy: z.object({ identifier: z.string().url().max(2048).refine(v => v.startsWith('https://')),
    digestSha256Base64: z.string().regex(/^[A-Za-z0-9+/]{43}=$/), }).strict(),
  includeSimplifiedQr: z.boolean(),
}).strict();
const secretSchema = z.object({ binarySecurityToken: z.string().min(1).max(32768), secret: z.string().min(1).max(8192) }).strict();
type Clients = { secrets: Pick<SecretsManagerClient, 'send'>; kms: Pick<KMSClient, 'send'> };

/** Server-only preparation primitive; NEVER bind these inputs to request JSON.
 * A future authorized backend must load the binding/pins/version/policy from its
 * saved onboarding registry and expected scope from verified authorization.
 * No registry writer/endpoint/issuance or full certificate trust decision exists here.
 */
export async function createStoredZatcaPreparation(
  bindingInput: unknown, expectedScope: unknown, clients: Clients, clock: () => Date = () => new Date(),
) {
  let binding: z.infer<typeof bindingSchema>;
  try { binding = bindingSchema.parse(bindingInput); }
  catch { throw new Error('STORED_SIGNER_BINDING_INVALID'); }
  const scope = zatcaPreparationScopeSchema.parse(expectedScope);
  for (const key of ['organizationId', 'environment', 'unitId', 'connectionId'] as const) {
    if (binding[key] !== scope[key]) throw new Error('STORED_SIGNER_SCOPE_MISMATCH');
  }
  const key = /^arn:aws:kms:([a-z0-9-]+):(\d{12}):key\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(binding.kmsKeyArn);
  const secret = /^arn:aws:secretsmanager:([a-z0-9-]+):(\d{12}):secret:(.+)$/.exec(binding.secretArn);
  const path = `zakatflow/fatoora/${scope.organizationId}/${scope.environment.toLowerCase()}/${scope.connectionId}-`;
  if (!key || !secret || key[1] !== secret[1] || key[2] !== secret[2]
      || !secret[3].startsWith(path) || !/^[A-Za-z0-9]{6}$/.test(secret[3].slice(path.length))) throw new Error('STORED_SIGNER_REFERENCE_INVALID');
  // Capture dependencies too: callers cannot swap transports mid-preparation.
  const secrets = clients.secrets, kms = clients.kms;
  const now = () => { const at = new Date(clock().getTime()); if (!Number.isFinite(at.getTime())) throw new Error('INVALID_CERTIFICATE_CHECK_TIME'); return at; };
  async function loadCurrent() {
    let response;
    try {
      response = await secrets.send(new GetSecretValueCommand({ SecretId: binding.secretArn,
        VersionId: binding.secretVersionId, VersionStage: 'AWSCURRENT' }));
    } catch { throw new Error('STORED_SIGNER_SECRET_UNAVAILABLE'); }
    if (response.ARN !== binding.secretArn || response.VersionId !== binding.secretVersionId
        || !Array.isArray(response.VersionStages) || !response.VersionStages.includes('AWSCURRENT')) throw new Error('STORED_SIGNER_SECRET_VERSION_MISMATCH');
    if (typeof response.SecretString !== 'string' || Buffer.byteLength(response.SecretString, 'utf8') > 65536
        || response.SecretBinary !== undefined) throw new Error('STORED_SIGNER_SECRET_INVALID');
    let token: string;
    try { token = secretSchema.parse(JSON.parse(response.SecretString)).binarySecurityToken; }
    catch { throw new Error('STORED_SIGNER_SECRET_INVALID'); }
    // Supported credential codec is exactly canonical base64 DER. Do not guess
    // nested encodings/PEM wrappers or rewrite authority credentials to pass.
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(token)) throw new Error('STORED_SIGNER_SECRET_INVALID');
    const certificate = inspectZatcaSigningCertificate(token, binding.certificateFingerprintSha256, now());
    return { certificate, contentDigest: createHash('sha256').update(response.SecretString).digest('hex') };
  }
  const material = await loadCurrent();
  return {
    stage: 'STORED_SIGNER_PREPARATION_ONLY' as const,
    async prepare(reservation: unknown) {
      const options = { certificate: material.certificate.certificateDerBase64,
        expectedFingerprintSha256: binding.certificateFingerprintSha256,
        issuerChainDerBase64: [...binding.issuerChainDerBase64], policy: { ...binding.policy },
        includeSimplifiedQr: binding.includeSimplifiedQr, signingTime: now() };
      const artifact = await prepareReservedZatcaArtifact(reservation, scope, options, async bytes => {
        const fresh = await loadCurrent();
        if (fresh.contentDigest !== material.contentDigest) throw new Error('STORED_SIGNER_SECRET_CONTENT_CHANGED');
        let signature;
        try {
          const signer = await createZatcaKmsSigner(kms, binding.kmsKeyArn, fresh.certificate.publicKeySpki);
          signature = await signer.signCanonicalSignedInfo(bytes);
        } catch (error) {
          const validation = new Set(['INVALID_KMS_KEY_ARN', 'INVALID_ZATCA_KEY_CURVE', 'INVALID_KMS_SIGNING_KEY',
            'KMS_CERTIFICATE_KEY_MISMATCH', 'INVALID_SIGNED_INFO_SIZE', 'INVALID_KMS_SIGNATURE_RESPONSE',
            'INVALID_ECDSA_DER_SIGNATURE', 'KMS_SIGNATURE_VERIFICATION_FAILED']);
          throw new Error(error instanceof Error && validation.has(error.message)
            ? 'STORED_SIGNER_KEY_OR_SIGNATURE_INVALID' : 'STORED_SIGNER_KMS_UNAVAILABLE');
        }
        const after = await loadCurrent();
        if (after.contentDigest !== material.contentDigest) throw new Error('STORED_SIGNER_SECRET_CONTENT_CHANGED');
        return signature;
      });
      return { ...artifact, credentialReference: { version: binding.version, secretVersionId: binding.secretVersionId,
        certificateFingerprintSha256: binding.certificateFingerprintSha256 } };
    },
  };
}
