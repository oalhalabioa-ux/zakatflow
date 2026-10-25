import { createHash, createPublicKey, timingSafeEqual, verify, X509Certificate } from 'node:crypto';
import { z } from 'zod';
import { inspectZatcaSigningCertificate } from './zatca-signing-certificate';
import { ecdsaDerToXmlSignature } from './zatca-kms-signer';
import { verifyZatcaCertificatePath } from './zatca-certificate-path';

const text = z.string().min(1).max(500).refine(v => v === v.trim() && !/[\x00-\x1f\x7f]/.test(v));
const base64 = z.string().min(4).max(32768).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const pin = z.string().regex(/^[a-f0-9]{64}$/);
export const zatcaSavedUnitIdentitySchema = z.object({
  organizationId: z.string().uuid(), connectionId: z.string().uuid(), unitId: z.string().uuid(),
  environment: z.enum(['SIMULATION', 'PRODUCTION']), profile: z.literal('ZAKATFLOW_SAN_DIRECTORY_V1'),
  csrSha256: pin, kmsPublicKeySpkiBase64: base64,
  taxpayerVatNumber: z.string().regex(/^3[0-9]{13}3$/), commonName: text, branchName: text,
  legalName: text, egsSerialNumber: text.refine(v => /^1-[^|]+\|2-[^|]+\|3-[^|]+$/.test(v)),
  invoiceType: z.enum(['1000', '0100', '1100']), branchLocation: text, industry: text,
  email: z.string().email().max(254).regex(/^[\x21-\x7e]+$/),
}).strict();
const materialSchema = z.object({ certificateDerBase64: base64, csrPem: z.string().min(1).max(32768) }).strict();
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const fail = (code = 'ONBOARDING_IDENTITY_DER_INVALID'): never => { throw new Error(code); };
function decode(value: string) {
  const bytes = Buffer.from(value, 'base64'); if (bytes.toString('base64') !== value) fail('ONBOARDING_IDENTITY_ENCODING_INVALID');
  return bytes;
}
function reader(bytes: Buffer) {
  type Node = { tag: number; header: number; start: number; end: number };
  const node = (header: number, limit: number): Node => {
    let offset = header; const tag = bytes[offset++];
    if (tag === undefined || (tag & 31) === 31 || offset >= limit) return fail();
    let length = bytes[offset++];
    if (length & 128) {
      const count = length & 127;
      if (!count || count > 3 || offset + count > limit || bytes[offset] === 0) return fail();
      length = 0; for (let i = 0; i < count; i++) length = length * 256 + bytes[offset++];
      if (length < 128) return fail();
    }
    if (offset + length > limit) return fail(); return { tag, header, start: offset, end: offset + length };
  };
  const children = (parent: Node) => {
    const result: Node[] = []; let offset = parent.start;
    while (offset < parent.end) { const child = node(offset, parent.end); result.push(child); offset = child.end; if (result.length > 100) fail(); }
    return result;
  };
  const exact = (tag: number) => { const root = node(0, bytes.length); if (root.tag !== tag || root.end !== bytes.length) return fail(); return root; };
  const raw = (n: Node) => bytes.subarray(n.header, n.end);
  const value = (n: Node) => bytes.subarray(n.start, n.end);
  const oid = (n: Node) => { if (n.tag !== 6) return fail(); return value(n).toString('hex'); };
  const string = (n: Node) => {
    const content = value(n); let result: string;
    if (n.tag === 0x0c) result = new TextDecoder('utf-8', { fatal: true }).decode(content);
    else if (n.tag === 0x13 || n.tag === 0x16) {
      if (content.some(byte => byte > 127)) return fail('ONBOARDING_IDENTITY_STRING_INVALID'); result = content.toString('ascii');
      if (n.tag === 0x13 && !/^[A-Za-z0-9 '()+,\-./:=?]*$/.test(result)) return fail('ONBOARDING_IDENTITY_STRING_INVALID');
    } else return fail('ONBOARDING_IDENTITY_STRING_INVALID');
    if (!result || result.length > 500 || result !== result.trim() || /[\x00-\x1f\x7f]/.test(result)) return fail('ONBOARDING_IDENTITY_STRING_INVALID');
    return result;
  };
  const name = (n: Node) => {
    if (n.tag !== 0x30) return fail(); const values = new Map<string, string>();
    for (const rdn of children(n)) {
      if (rdn.tag !== 0x31) return fail(); const attributes = children(rdn); if (!attributes.length) return fail();
      for (let i = 0; i < attributes.length; i++) {
        const attribute = attributes[i]; if (attribute.tag !== 0x30 || (i > 0 && Buffer.compare(raw(attributes[i - 1]), raw(attribute)) > 0)) return fail();
        const fields = children(attribute); if (fields.length !== 2) return fail(); const key = oid(fields[0]);
        if (values.has(key)) return fail('ONBOARDING_IDENTITY_DUPLICATE_ATTRIBUTE'); values.set(key, string(fields[1]));
      }
    }
    return values;
  };
  const extensions = (n: Node) => {
    if (n.tag !== 0x30) return fail(); const values = new Map<string, Buffer>();
    for (const extension of children(n)) {
      if (extension.tag !== 0x30) return fail(); const fields = children(extension);
      if (fields.length !== 2 && fields.length !== 3) return fail(); const key = oid(fields[0]);
      if (values.has(key)) return fail('ONBOARDING_IDENTITY_DUPLICATE_EXTENSION');
      if (fields.length === 3 && (fields[1].tag !== 1 || !value(fields[1]).equals(Buffer.from([255])))) return fail();
      const content = fields.at(-1)!; if (content.tag !== 4) return fail(); values.set(key, Buffer.from(value(content)));
    }
    return values;
  };
  return { node, children, exact, raw, value, oid, string, name, extensions };
}
function directoryName(extensions: Map<string, Buffer>) {
  const bytes = extensions.get('551d11'); if (!bytes) return fail('ONBOARDING_IDENTITY_SAN_REQUIRED');
  const r = reader(bytes), names = r.children(r.exact(0x30));
  if (names.length !== 1 || names[0].tag !== 0xa4) return fail('ONBOARDING_IDENTITY_SAN_AMBIGUOUS');
  const wrapped = r.children(names[0]); if (wrapped.length !== 1) return fail(); return r.name(wrapped[0]);
}
function equalMap(actual: Map<string, string>, expected: Map<string, string>, certificate = false) {
  // Authority may omit the requester's email. All taxpayer/unit identity fields
  // remain mandatory; unknown/mixed profiles and duplicate attributes fail closed.
  if (certificate && !actual.has('2a864886f70d010901')) expected.delete('2a864886f70d010901');
  if (actual.size !== expected.size || [...expected].some(([key, value]) => actual.get(key) !== value)) fail('ONBOARDING_IDENTITY_SAVED_UNIT_MISMATCH');
}
// Versioned flat-string identity receipt: ASCII-sorted keys, each UTF-8 key/value
// prefixed by an unsigned 32-bit big-endian byte length. PostgreSQL reproduces
// this without depending on JSON whitespace/locale or JavaScript string lengths.
function identityDigest(value: z.infer<typeof zatcaSavedUnitIdentitySchema>) {
  const chunks: Buffer[] = [];
  for (const key of Object.keys(value).sort()) for (const field of [key, value[key as keyof typeof value]]) {
    const bytes = Buffer.from(field, 'utf8'), size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
    chunks.push(size, bytes);
  }
  return digest(Buffer.concat(chunks));
}
function inspectOriginalCsr(csrPemValue: unknown, savedUnitValue: unknown) {
  const csrPem = z.string().min(1).max(32768).parse(csrPemValue), expected = zatcaSavedUnitIdentitySchema.parse(savedUnitValue);
  if (expected.unitId !== expected.connectionId) return fail('ONBOARDING_IDENTITY_SCOPE_MISMATCH');
  const pem = /^-----BEGIN CERTIFICATE REQUEST-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END CERTIFICATE REQUEST-----\r?\n?$/.exec(csrPem);
  if (!pem) return fail('ONBOARDING_IDENTITY_CSR_INVALID');
  const csr = decode(pem[1].replace(/[\r\n]/g, ''));
  if (digest(csr) !== expected.csrSha256) return fail('ONBOARDING_IDENTITY_CSR_DIGEST_MISMATCH');
  const r = reader(csr), outer = r.children(r.exact(0x30));
  if (outer.length !== 3 || outer[0].tag !== 0x30 || outer[1].tag !== 0x30 || outer[2].tag !== 3) return fail();
  const algorithm = r.children(outer[1]);
  if (algorithm.length !== 1 || r.oid(algorithm[0]) !== '2a8648ce3d040302') return fail('ONBOARDING_IDENTITY_CSR_SIGNATURE_INVALID');
  const fields = r.children(outer[0]);
  if (fields.length !== 4 || fields[0].tag !== 2 || !r.value(fields[0]).equals(Buffer.from([0])) || fields[2].tag !== 0x30 || fields[3].tag !== 0xa0) return fail();
  const spki = Buffer.from(r.raw(fields[2]));
  const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });
  const savedSpki = decode(expected.kmsPublicKeySpkiBase64);
  if (publicKey.asymmetricKeyType !== 'ec' || publicKey.asymmetricKeyDetails?.namedCurve !== 'secp256k1'
      || !publicKey.export({ format: 'der', type: 'spki' }).equals(spki)) return fail('ONBOARDING_IDENTITY_KEY_INVALID');
  if (spki.length !== savedSpki.length || !timingSafeEqual(spki, savedSpki)) return fail('ONBOARDING_IDENTITY_KEY_MISMATCH');
  const signature = r.value(outer[2]); if (signature[0] !== 0) return fail('ONBOARDING_IDENTITY_CSR_SIGNATURE_INVALID');
  try { ecdsaDerToXmlSignature(signature.subarray(1)); }
  catch { return fail('ONBOARDING_IDENTITY_CSR_SIGNATURE_INVALID'); }
  if (!verify('sha256', r.raw(outer[0]), publicKey, signature.subarray(1))) return fail('ONBOARDING_IDENTITY_CSR_SIGNATURE_INVALID');
  const attributes = r.children(fields[3]);
  if (attributes.length !== 1 || attributes[0].tag !== 0x30) return fail();
  const request = r.children(attributes[0]);
  if (request.length !== 2 || r.oid(request[0]) !== '2a864886f70d01090e' || request[1].tag !== 0x31) return fail();
  const extensionSets = r.children(request[1]); if (extensionSets.length !== 1) return fail();
  const csrExtensions = r.extensions(extensionSets[0]);
  if (csrExtensions.size !== 2 || !csrExtensions.has('2b0601040182371402')) return fail('ONBOARDING_IDENTITY_CSR_PROFILE_INVALID');
  const templateReader = reader(csrExtensions.get('2b0601040182371402')!);
  const template = templateReader.string(templateReader.exact(0x13));
  if (template !== (expected.environment === 'SIMULATION' ? 'PREZATCA-Code-Signing' : 'ZATCA-Code-Signing')) return fail('ONBOARDING_IDENTITY_ENVIRONMENT_MISMATCH');
  const subject = () => new Map([['550406', 'SA'], ['55040b', expected.branchName], ['55040a', expected.legalName],
    ['550403', expected.environment === 'SIMULATION' ? 'PREZATCA-Code-Signing' : expected.commonName], ['2a864886f70d010901', expected.email]]);
  const san = () => new Map([['550405', expected.egsSerialNumber], ['0992268993f22c640101', expected.taxpayerVatNumber],
    ['55040c', expected.invoiceType], ['55041a', expected.branchLocation], ['55040f', expected.industry]]);
  equalMap(r.name(fields[1]), subject()); equalMap(directoryName(csrExtensions), san());
  return { expected, spki, subject, san, template, csr };
}

/** Original signed CSR consistency only: not proof of live KMS ownership or CA acceptance. */
export function inspectZatcaOriginalCsr(csrPem: unknown, savedUnit: unknown) {
  try {
    const { expected, spki, csr } = inspectOriginalCsr(csrPem, savedUnit);
    return { stage: 'ORIGINAL_CSR_PREFLIGHT_ONLY' as const, csrDerBase64: csr.toString('base64'),
      csrSha256: expected.csrSha256, publicKeySpkiSha256: digest(spki), expectedIdentitySha256: identityDigest(expected) };
  } catch { return fail('ORIGINAL_CSR_INVALID'); }
}

function inspect(materialValue: unknown, savedUnitValue: unknown, at: Date) {
  const material = materialSchema.parse(materialValue);
  const { expected, spki, subject, san, template } = inspectOriginalCsr(material.csrPem, savedUnitValue);
  const der = decode(material.certificateDerBase64), certificate = new X509Certificate(der);
  if (!certificate.raw.equals(der)) return fail('ONBOARDING_IDENTITY_CERTIFICATE_INVALID');
  const certificatePin = digest(der);
  // Derived candidate pin is evidence only, never an independent trust anchor.
  inspectZatcaSigningCertificate(material.certificateDerBase64, certificatePin, at);
  if (!certificate.publicKey.export({ type: 'spki', format: 'der' }).equals(spki)) return fail('ONBOARDING_IDENTITY_KEY_MISMATCH');
  const c = reader(der), certOuter = c.children(c.exact(0x30));
  if (certOuter.length !== 3 || certOuter[0].tag !== 0x30) return fail();
  const tbs = c.children(certOuter[0]);
  if (tbs[0]?.tag !== 0xa0) return fail('ONBOARDING_IDENTITY_CERTIFICATE_INVALID');
  const version = c.children(tbs[0]);
  if (version.length !== 1 || version[0].tag !== 2 || !c.value(version[0]).equals(Buffer.from([2])) || tbs.length !== 8 || tbs[7].tag !== 0xa3) return fail('ONBOARDING_IDENTITY_CERTIFICATE_INVALID');
  equalMap(c.name(tbs[5]), subject(), true);
  const wrappedExtensions = c.children(tbs[7]); if (wrappedExtensions.length !== 1) return fail();
  const certExtensions = c.extensions(wrappedExtensions[0]); equalMap(directoryName(certExtensions), san());
  const certificateTemplate = certExtensions.get('2b0601040182371402');
  if (certificateTemplate) { const tr = reader(certificateTemplate); if (tr.string(tr.exact(0x13)) !== template) return fail('ONBOARDING_IDENTITY_ENVIRONMENT_MISMATCH'); }
  return { stage: 'ONBOARDING_IDENTITY_PREFLIGHT_ONLY' as const, scope: { organizationId: expected.organizationId,
    environment: expected.environment, unitId: expected.unitId, connectionId: expected.connectionId }, profile: expected.profile,
    certificateFingerprintSha256: certificatePin, csrSha256: expected.csrSha256, publicKeySpkiSha256: digest(spki), expectedIdentitySha256: identityDigest(expected) };
}

/** Trusted backend inputs only. Binds a certificate to the original saved CSR,
 * saved KMS public key and explicit current-application identity layout. Does not
 * validate CA trust, revocation, authority profile/policy or authorize activation.
 */
export function inspectZatcaOnboardingIdentity(material: unknown, savedUnit: unknown, at: Date = new Date()) {
  const safe = new Set(['ONBOARDING_IDENTITY_DER_INVALID','ONBOARDING_IDENTITY_ENCODING_INVALID','ONBOARDING_IDENTITY_STRING_INVALID',
    'ONBOARDING_IDENTITY_DUPLICATE_ATTRIBUTE','ONBOARDING_IDENTITY_DUPLICATE_EXTENSION','ONBOARDING_IDENTITY_SAN_REQUIRED',
    'ONBOARDING_IDENTITY_SAN_AMBIGUOUS','ONBOARDING_IDENTITY_SAVED_UNIT_MISMATCH','ONBOARDING_IDENTITY_SCOPE_MISMATCH',
    'ONBOARDING_IDENTITY_CSR_INVALID','ONBOARDING_IDENTITY_CSR_DIGEST_MISMATCH','ONBOARDING_IDENTITY_CSR_SIGNATURE_INVALID',
    'ONBOARDING_IDENTITY_KEY_INVALID','ONBOARDING_IDENTITY_KEY_MISMATCH','ONBOARDING_IDENTITY_CSR_PROFILE_INVALID',
    'ONBOARDING_IDENTITY_ENVIRONMENT_MISMATCH','ONBOARDING_IDENTITY_CERTIFICATE_INVALID',
    'INVALID_CERTIFICATE_CHECK_TIME','SIGNING_CERTIFICATE_NOT_YET_VALID','SIGNING_CERTIFICATE_EXPIRED','SIGNING_CERTIFICATE_IS_CA','INVALID_ZATCA_KEY_CURVE']);
  try { return inspect(material, savedUnit, new Date(at.getTime())); }
  catch (error) { throw new Error(error instanceof Error && safe.has(error.message) ? error.message : 'ONBOARDING_IDENTITY_INPUT_INVALID'); }
}


/** Combine original CSR/unit/key identity with independently configured CA/CRL
 * trust. Still a candidate: no permission grant, registry write or activation.
 */
export async function verifyZatcaOnboardingCandidate(
  materialValue: unknown, savedUnitValue: unknown, pathEvidenceValue: unknown,
  configuredTrust: unknown, at: Date = new Date(),
) {
  let material: z.infer<typeof materialSchema>, saved: z.infer<typeof zatcaSavedUnitIdentitySchema>;
  let evidence: { issuerChainDerBase64: string[]; crlsDerBase64: string[] };
  let checkedAt: Date;
  try {
    material = materialSchema.parse(materialValue); saved = zatcaSavedUnitIdentitySchema.parse(savedUnitValue);
    evidence = z.object({ issuerChainDerBase64: z.array(base64).min(1).max(5),
      crlsDerBase64: z.array(z.string().min(4).max(1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/)).min(1).max(6),
    }).strict().parse(pathEvidenceValue);
    checkedAt = new Date(at.getTime());
  } catch { return fail('ONBOARDING_CANDIDATE_INPUT_INVALID'); }
  const identity = inspectZatcaOnboardingIdentity(material, saved, checkedAt);
  const path = await verifyZatcaCertificatePath({ ...evidence, environment: identity.scope.environment,
    certificateDerBase64: material.certificateDerBase64, expectedFingerprintSha256: identity.certificateFingerprintSha256,
  }, configuredTrust, checkedAt);
  return { stage: 'ONBOARDING_CANDIDATE_ONLY' as const, identity, path };
}
