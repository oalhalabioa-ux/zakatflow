import { GetPublicKeyCommand, SignCommand, type KMSClient } from '@aws-sdk/client-kms';
import { CreateSecretCommand, DescribeSecretCommand, GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { z } from 'zod';
import { createZatcaCsr } from '../../lib/vat-zatca-csr';
import { inspectZatcaOriginalCsr, inspectZatcaOnboardingIdentity, zatcaSavedUnitIdentitySchema } from '../../lib/zatca-onboarding-identity';
import { ecdsaDerToXmlSignature } from '../../lib/zatca-kms-signer';
import { createZatcaEnrollmentResponseStager } from '../../lib/zatca-enrollment-response-staging';
import { createZatcaSimulationComplianceTransport, decodeZatcaComplianceCertificate, simulationOtpSchema } from '../../lib/zatca-simulation-compliance';
import { inspectSimulationCertificate } from './simulation-certificate-inspection';
import { inspectZatcaSigningCertificate } from '../../lib/zatca-signing-certificate';
import { createStandardComplianceQa, standardQaSampleSchema } from './standard-compliance-qa';

const account = '701899214938', region = 'eu-north-1';
export const simulationQaSigningKey = `arn:aws:kms:${region}:${account}:key/ab50c7e0-2251-4ae3-967d-5d14866b80d4`;
export const simulationQaRole = `arn:aws:iam::${account}:role/yaqeen-fatoora-qa-preview`;
const text = z.string().min(1).max(500).refine(v => v === v.trim() && !/[\x00-\x1f\x7f]/.test(v));
export const simulationQaUnitSchema = z.object({
  organizationId: z.string().uuid(), connectionId: z.string().uuid(), enrollmentId: z.string().uuid(),
  commonName: text, taxpayerVatNumber: z.string().regex(/^3[0-9]{13}3$/), legalName: text, branchName: text,
  branchLocation: text, industry: text, email: z.string().email().max(254).regex(/^[\x21-\x7e]+$/),
  egsSerialNumber: text.refine(v => /^1-[^|]+\|2-[^|]+\|3-[^|]+$/.test(v)), invoiceType: z.enum(['1000','0100','1100']),
}).strict();
const configSchema = z.object({ unit: simulationQaUnitSchema, sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  encryptionKeyArn: z.string().regex(/^arn:aws:kms:eu-north-1:701899214938:key\/[a-f0-9-]{36}$/),
  standardSample: standardQaSampleSchema.optional(),
}).strict();
const originalSchema = z.object({ version: z.literal('YAQEEN_SIMULATION_QA_ORIGINAL_V1'),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/), profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
  createOnlyFenceVerified: z.literal(true),
  csrPem: z.string().min(1).max(32768), savedUnit: zatcaSavedUnitIdentitySchema,
}).strict();
const intentSchema = z.object({ version: z.literal('YAQEEN_SIMULATION_QA_INTENT_V1'),
  dispatchId: z.string().uuid(), originalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
}).strict();
const fail = (code: string): never => { throw new Error(code); };
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const notFound = (error: unknown) => error instanceof Error && error.name === 'ResourceNotFoundException';

/** QA-only target check; platform-owned runtime claims are not accepted from HTTP.
 * STS validates their signature through the AWS credential provider. The preview
 * must additionally retain Vercel Authentication on every generated URL.
 */
export function assertSimulationQaTarget(env: Record<string,string|undefined>) {
  if (env.VERCEL_ENV !== 'preview' || env.FATOORA_QA_AWS_REGION !== region
    || env.FATOORA_QA_AWS_ROLE_ARN !== simulationQaRole || env.FATOORA_QA_KMS_KEY_ARN !== simulationQaSigningKey)
    fail('QA_TARGET_REQUIRED');
  let claims: Record<string,unknown>;
  try { claims = JSON.parse(Buffer.from(env.VERCEL_OIDC_TOKEN!.split('.')[1], 'base64url').toString('utf8')); }
  catch { return fail('QA_IDENTITY_REQUIRED'); }
  if (claims.sub !== 'owner:oalhalabioa-9334:project:yaqeen-fatoora-qa:environment:preview'
    || claims.iss !== 'https://oidc.vercel.com/oalhalabioa-9334' || claims.aud !== 'https://vercel.com/oalhalabioa-9334')
    fail('QA_IDENTITY_REQUIRED');
}

/** Isolated, single-owner Simulation diagnostic, NOT application organization
 * onboarding. No SQL/Auth/customer/financial rows are read or changed. Unit scope
 * comes exclusively from private preview configuration. Encrypted Secrets Manager
 * objects preserve the original and a create-only dispatch fence. No deletion,
 * overwrite, activation, recovery resend or Production API exists here.
 */
export function createSimulationQa(clients: { kms: Pick<KMSClient,'send'>; secrets: Pick<SecretsManagerClient,'send'>; transport: typeof fetch }, protectedConfig: unknown) {
  let config: z.infer<typeof configSchema>;
  try { config = configSchema.parse(protectedConfig); }
  catch { return fail('QA_CONFIGURATION_INVALID'); }
  if (config.encryptionKeyArn === simulationQaSigningKey) fail('QA_CONFIGURATION_INVALID');
  const unit = config.unit, base = `zakatflow/fatoora-enrollment/${unit.organizationId}/simulation/${unit.connectionId}/${unit.enrollmentId}`;
  const originalName = base + '/original-csr', intentName = base + '/dispatch-once', probeName = base + '/storage-fence-probe';
  const profileDigest = sha(JSON.stringify({ unit, signingKeyArn: simulationQaSigningKey, encryptionKeyArn: config.encryptionKeyArn }));
  const send = clients.secrets.send.bind(clients.secrets), kmsSend = clients.kms.send.bind(clients.kms);
  const stager = createZatcaEnrollmentResponseStager(clients.secrets, { region, accountId: account, encryptionKeyArn: config.encryptionKeyArn });
  const submit = createZatcaSimulationComplianceTransport(clients.transport);
  function arnMatches(arn: unknown, name: string): arn is string {
    const prefix = `arn:aws:secretsmanager:${region}:${account}:secret:${name}-`;
    return typeof arn === 'string' && arn.startsWith(prefix) && /^[A-Za-z0-9]{6}$/.test(arn.slice(prefix.length));
  }
  async function read(name: string, version?: string): Promise<{ content: string; version: string; arn: string } | null> {
    let metadata;
    try { metadata = await send(new DescribeSecretCommand({ SecretId: name })); }
    catch (error) { if (notFound(error)) return null; return fail('QA_PRIVATE_STORAGE_UNAVAILABLE'); }
    if (!metadata || !arnMatches(metadata.ARN, name) || metadata.Name !== name || metadata.KmsKeyId !== config.encryptionKeyArn
      || metadata.DeletedDate !== undefined || metadata.OwningService !== undefined || metadata.RotationEnabled === true
      || metadata.ReplicationStatus?.length) fail('QA_PRIVATE_STORAGE_INVALID');
    let saved;
    try { saved = await send(new GetSecretValueCommand({ SecretId: metadata.ARN, ...(version ? { VersionId: version } : {}) })); }
    catch { return fail('QA_PRIVATE_STORAGE_UNAVAILABLE'); }
    if (!saved || saved.ARN !== metadata.ARN || saved.Name !== name || typeof saved.VersionId !== 'string'
      || (version && saved.VersionId !== version) || saved.SecretBinary !== undefined
      || typeof saved.SecretString !== 'string' || Buffer.byteLength(saved.SecretString) > 65536) fail('QA_PRIVATE_STORAGE_INVALID');
    return { content: saved.SecretString!, version: saved.VersionId!, arn: saved.ARN! };
  }
  async function publicKey() {
    let key;
    try { key = await kmsSend(new GetPublicKeyCommand({ KeyId: simulationQaSigningKey })); }
    catch { return fail('QA_SIGNING_KEY_UNAVAILABLE'); }
    if (key.KeyId !== simulationQaSigningKey || key.KeySpec !== 'ECC_SECG_P256K1' || key.KeyUsage !== 'SIGN_VERIFY'
      || !key.SigningAlgorithms?.includes('ECDSA_SHA_256') || !key.PublicKey) fail('QA_SIGNING_KEY_INVALID');
    const spki = Buffer.from(key.PublicKey!);
    const parsed = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    if (parsed.asymmetricKeyType !== 'ec' || parsed.asymmetricKeyDetails?.namedCurve !== 'secp256k1') fail('QA_SIGNING_KEY_INVALID');
    return spki;
  }
  async function verifyCreateOnlyFence() {
    const content = JSON.stringify({ version: 'YAQEEN_SIMULATION_QA_FENCE_PROBE_V1', profileDigest });
    let saved = await read(probeName, unit.enrollmentId);
    if (!saved) {
      try { await send(new CreateSecretCommand({ Name: probeName, KmsKeyId: config.encryptionKeyArn,
        ClientRequestToken: unit.enrollmentId, SecretString: content,
        Description: 'Isolated QA CreateSecret uniqueness proof. No OTP or credentials.',
        Tags: [{ Key: 'application', Value: 'zakatflow' }, { Key: 'purpose', Value: 'qa-enrollment-fence-probe' }] })); }
      catch { /* Recover the exact first probe after an uncertain acknowledgement. */ }
      saved = await read(probeName, unit.enrollmentId);
    }
    if (!saved || saved.content !== content) return fail('QA_STORAGE_FENCE_UNVERIFIED');
    // Before an OTP is requested, verify the real account rejects an existing
    // name with a DIFFERENT token AND body. Success/unknown outcomes fail closed.
    // The probe contains no CSR/credentials and is never an authority intent.
    try {
      await send(new CreateSecretCommand({ Name: probeName, KmsKeyId: config.encryptionKeyArn,
        ClientRequestToken: randomUUID(), SecretString: JSON.stringify({ probeNonce: randomUUID() }) }));
    } catch (error) {
      if (error instanceof Error && error.name === 'ResourceExistsException') return;
      return fail('QA_STORAGE_FENCE_UNVERIFIED');
    }
    return fail('QA_STORAGE_FENCE_UNVERIFIED');
  }
  async function sign(bytes: Buffer, spki: Buffer) {
    let result;
    try { result = await kmsSend(new SignCommand({ KeyId: simulationQaSigningKey, Message: createHash('sha256').update(bytes).digest(),
      MessageType: 'DIGEST', SigningAlgorithm: 'ECDSA_SHA_256' })); }
    catch { return fail('QA_SIGNING_KEY_UNAVAILABLE'); }
    if (result.KeyId !== simulationQaSigningKey || result.SigningAlgorithm !== 'ECDSA_SHA_256' || !result.Signature) fail('QA_CSR_SIGNATURE_INVALID');
    const signature = Buffer.from(result.Signature!);
    try { ecdsaDerToXmlSignature(signature); }
    catch { return fail('QA_CSR_SIGNATURE_INVALID'); }
    if (!verify('sha256', bytes, createPublicKey({ key: spki, format: 'der', type: 'spki' }), signature)) fail('QA_CSR_SIGNATURE_INVALID');
    return signature;
  }
  async function original() {
    const saved = await read(originalName, unit.enrollmentId); if (!saved) return null;
    let value: z.infer<typeof originalSchema>;
    try { value = originalSchema.parse(JSON.parse(saved.content)); }
    catch { return fail('QA_ORIGINAL_INVALID'); }
    if (JSON.stringify(value) !== saved.content || value.profileDigest !== profileDigest) fail('QA_ORIGINAL_CHANGED');
    const expected = { organizationId: unit.organizationId, connectionId: unit.connectionId, unitId: unit.connectionId,
      environment: 'SIMULATION', profile: 'ZAKATFLOW_SAN_DIRECTORY_V2', csrSha256: value.savedUnit.csrSha256,
      kmsPublicKeySpkiBase64: value.savedUnit.kmsPublicKeySpkiBase64, ...Object.fromEntries(Object.entries(unit)
        .filter(([key]) => !['organizationId','connectionId','enrollmentId'].includes(key))) };
    if (JSON.stringify(zatcaSavedUnitIdentitySchema.parse(expected)) !== JSON.stringify(value.savedUnit)) fail('QA_ORIGINAL_CHANGED');
    try { inspectZatcaOriginalCsr(value.csrPem, value.savedUnit); }
    catch { return fail('QA_ORIGINAL_INVALID'); }
    return { value, digest: sha(saved.content) };
  }
  async function intent(digest: string) {
    const saved = await read(intentName); if (!saved) return null;
    let value: z.infer<typeof intentSchema>;
    try { value = intentSchema.parse(JSON.parse(saved.content)); }
    catch { return fail('QA_INTENT_INVALID'); }
    if (saved.version !== value.dispatchId || value.originalDigest !== digest || JSON.stringify(value) !== saved.content) fail('QA_INTENT_INVALID');
    return value;
  }
  const scope = (digest: string, dispatchId: string) => ({ organizationId: unit.organizationId, connectionId: unit.connectionId,
    environment: 'SIMULATION', enrollmentId: unit.enrollmentId, enrollmentDigest: digest, dispatchId, kmsKeyArn: simulationQaSigningKey });
  async function resultStatus(saved: NonNullable<Awaited<ReturnType<typeof original>>>, dispatch: z.infer<typeof intentSchema>) {
    const context = scope(saved.digest, dispatch.dispatchId);
    try {
      const receipt = await stager.recoverResponse(context);
      const response = await read(base + '/' + dispatch.dispatchId, dispatch.dispatchId);
      if (!response || sha(response.content) !== receipt.reference.responseSha256) return fail('QA_RESPONSE_INVALID');
      let identityMatched = false;
      let certificateInspection: Awaited<ReturnType<typeof inspectSimulationCertificate>> | null = null;
      try {
        const envelope = JSON.parse(response.content);
        const certificateDer = decodeZatcaComplianceCertificate(envelope.response.binarySecurityToken);
        const certificateDerBase64 = certificateDer.toString('base64');
        inspectZatcaOnboardingIdentity({ csrPem: saved.value.csrPem, certificateDerBase64 }, saved.value.savedUnit);
        identityMatched = true;
        let freshKmsKeyMatched: boolean | null = null;
        try { freshKmsKeyMatched = (await publicKey()).toString('base64') === saved.value.savedUnit.kmsPublicKeySpkiBase64; }
        catch { /* A readable saved response is not lost when KMS is unavailable. */ }
        try { certificateInspection = await inspectSimulationCertificate(certificateDer, freshKmsKeyMatched); }
        catch { /* Preserve quarantine/readback even when optional inspection fails. */ }
      } catch { /* Preserve quarantined response for review; never activate. */ }
      return { state: 'RESPONSE_QUARANTINED' as const, identityMatched, trustVerified: false, activationAllowed: false,
        responseDigest: receipt.reference.responseSha256, certificateInspection,
        standardCompliance: config.standardSample ? await standard.status().catch(() => ({ stage: 'STANDARD_COMPLIANCE_QA_ONLY', state: 'BLOCKED', activationAllowed: false })) : null };
    } catch { return { state: 'RECONCILIATION_REQUIRED' as const, activationAllowed: false }; }
  }
  async function status() {
    const saved = await original();
    const common = { environment: 'SIMULATION', diagnosticOnly: true, sourceSha: config.sourceSha, csrSha256: null as string | null,
      company: { legalName: unit.legalName, vatNumber: unit.taxpayerVatNumber, branchName: unit.branchName,
        branchLocation: unit.branchLocation, industry: unit.industry, unitName: unit.commonName, email: unit.email }, activationAllowed: false };
    if (!saved) return { ...common, state: 'NOT_PREPARED' as const };
    const dispatch = await intent(saved.digest);
    if (dispatch) return { ...common, ...(await resultStatus(saved, dispatch)), csrSha256: saved.value.savedUnit.csrSha256 };
    const spki = await publicKey();
    if (spki.toString('base64') !== saved.value.savedUnit.kmsPublicKeySpkiBase64) fail('QA_SIGNING_KEY_CHANGED');
    return { ...common, state: 'READY_FOR_OTP' as const, csrSha256: saved.value.savedUnit.csrSha256 };
  }
  const standard = createStandardComplianceQa({
    async load() {
      const saved = await original(); if (!saved) fail('QA_STANDARD_CONTEXT_UNAVAILABLE');
      const dispatch = await intent(saved!.digest); if (!dispatch) fail('QA_STANDARD_CONTEXT_UNAVAILABLE');
      const receipt = await stager.recoverResponse(scope(saved!.digest, dispatch!.dispatchId));
      const response = await read(base + '/' + dispatch!.dispatchId, dispatch!.dispatchId);
      if (!response || sha(response.content) !== receipt.reference.responseSha256) fail('QA_STANDARD_CONTEXT_UNAVAILABLE');
      const credential = JSON.parse(response!.content).response;
      const der = decodeZatcaComplianceCertificate(credential.binarySecurityToken);
      inspectZatcaOnboardingIdentity({ csrPem: saved!.value.csrPem, certificateDerBase64: der.toString('base64') }, saved!.value.savedUnit);
      inspectZatcaSigningCertificate(der.toString('base64'), sha(der));
      if ((await publicKey()).toString('base64') !== saved!.value.savedUnit.kmsPublicKeySpkiBase64) fail('QA_STANDARD_CONTEXT_UNAVAILABLE');
      return { organizationId: unit.organizationId, legalName: unit.legalName, vatNumber: unit.taxpayerVatNumber,
        originalDigest: saved!.digest, responseDigest: receipt.reference.responseSha256, token: credential.binarySecurityToken, secret: credential.secret };
    },
    read: name => read(base + '/' + name),
    async create(name, version, content) {
      const fullName = base + '/' + name;
      const ack = await send(new CreateSecretCommand({ Name: fullName, KmsKeyId: config.encryptionKeyArn, ClientRequestToken: version,
        SecretString: content, Description: 'Isolated unsigned STANDARD Simulation compliance diagnostic only.',
        Tags: [{ Key: 'application', Value: 'zakatflow' }, { Key: 'purpose', Value: 'qa-standard-compliance' }] }));
      if (!ack || ack.Name !== fullName || ack.VersionId !== version || !arnMatches(ack.ARN, fullName)) fail('QA_STANDARD_STORAGE_UNAVAILABLE');
      return { version: ack.VersionId! };
    }, assertCreateOnly: verifyCreateOnlyFence, transport: clients.transport,
  }, config.standardSample, config.sourceSha);
  return {
    status,
    prepareStandardCompliance: () => standard.prepare(),
    submitStandardCompliance: (input: unknown) => standard.submit(input),
    async prepareOriginal() {
      if (await original()) return status();
      const spki = await publicKey();
      await verifyCreateOnlyFence();
      const csrPem = await createZatcaCsr({ environment: 'SIMULATION', commonName: unit.commonName, taxpayerVatNumber: unit.taxpayerVatNumber,
        branchName: unit.branchName, organizationName: unit.legalName, serialNumber: unit.egsSerialNumber,
        invoiceType: unit.invoiceType, registeredAddress: unit.branchLocation, businessCategory: unit.industry, email: unit.email }, spki, bytes => sign(bytes, spki));
      const csrDer = Buffer.from(csrPem.replace(/-----[^\n]+-----/g, '').replace(/\s/g, ''), 'base64');
      const { enrollmentId: _enrollmentId, ...identity } = unit;
      const savedUnit = zatcaSavedUnitIdentitySchema.parse({ ...identity, unitId: unit.connectionId,
        environment: 'SIMULATION', profile: 'ZAKATFLOW_SAN_DIRECTORY_V2', csrSha256: sha(csrDer), kmsPublicKeySpkiBase64: spki.toString('base64') });
      const value = originalSchema.parse({ version: 'YAQEEN_SIMULATION_QA_ORIGINAL_V1', sourceSha: config.sourceSha,
        profileDigest, createOnlyFenceVerified: true, csrPem, savedUnit });
      inspectZatcaOriginalCsr(csrPem, savedUnit);
      try { await send(new CreateSecretCommand({ Name: originalName, KmsKeyId: config.encryptionKeyArn, ClientRequestToken: unit.enrollmentId,
        SecretString: JSON.stringify(value), Description: 'Isolated Simulation QA original CSR. Not active credentials.',
        Tags: [{ Key: 'application', Value: 'zakatflow' }, { Key: 'purpose', Value: 'qa-enrollment-original' }] })); }
      catch { /* Read the exact existing original after a race/lost acknowledgement. */ }
      if (!(await original())) fail('QA_PRIVATE_STORAGE_UNAVAILABLE');
      return status();
    },
    async submitOtp(input: unknown) {
      const parsed = z.object({ otp: simulationOtpSchema, csrSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(input);
      if (!parsed.success) fail('QA_OTP_INPUT_INVALID');
      const saved = await original();
      if (!saved || saved.value.savedUnit.csrSha256 !== parsed.data!.csrSha256) return fail('QA_ORIGINAL_CHANGED');
      if (await intent(saved.digest)) return status();
      const spki = await publicKey();
      if (spki.toString('base64') !== saved.value.savedUnit.kmsPublicKeySpkiBase64) fail('QA_SIGNING_KEY_CHANGED');
      await verifyCreateOnlyFence();
      // Fresh proof that signing is still allowed; domain-separated internal bytes,
      // never caller input, never a replacement/regenerated CSR.
      await sign(Buffer.from('YAQEEN_SIMULATION_QA_CLAIM_PROOF_V1\0' + saved.digest + '\0' + randomUUID()), spki);
      const dispatch = intentSchema.parse({ version: 'YAQEEN_SIMULATION_QA_INTENT_V1', dispatchId: randomUUID(),
        originalDigest: saved.digest, createdAt: new Date().toISOString() });
      try {
        // Fresh token AND content on every invocation: an idempotent old CreateSecret
        // acknowledgement cannot count as a new claim. SDK maxAttempts must be 1.
        const created = await send(new CreateSecretCommand({ Name: intentName, KmsKeyId: config.encryptionKeyArn,
          ClientRequestToken: dispatch.dispatchId, SecretString: JSON.stringify(dispatch),
          Description: 'Isolated Simulation QA one-shot intent. Do not delete/reset to retry.',
          Tags: [{ Key: 'application', Value: 'zakatflow' }, { Key: 'purpose', Value: 'qa-enrollment-intent' }] }));
        if (!created || !arnMatches(created.ARN, intentName) || created.Name !== intentName || created.VersionId !== dispatch.dispatchId)
          fail('QA_INTENT_INVALID');
        const acknowledged = await intent(saved.digest);
        if (!acknowledged || acknowledged.dispatchId !== dispatch.dispatchId) fail('QA_INTENT_INVALID');
      } catch { return fail('QA_RECONCILIATION_REQUIRED'); }
      try {
        const response = await submit({ environment: 'SIMULATION', csrPem: saved.value.csrPem, otp: parsed.data!.otp });
        await stager.stageResponse(scope(saved.digest, dispatch.dispatchId), response);
      } catch { return fail('QA_RECONCILIATION_REQUIRED'); }
      return status();
    },
  };
}
