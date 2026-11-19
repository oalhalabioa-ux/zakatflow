import { execFile } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { inspectZatcaSigningCertificate } from './zatca-signing-certificate';

const execute = promisify(execFile);
const base64 = (max: number) => z.string().min(4).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const pin = z.string().regex(/^[a-f0-9]{64}$/);
const environment = z.enum(['SIMULATION', 'PRODUCTION']);
const inputSchema = z.object({ environment, certificateDerBase64: base64(32768), expectedFingerprintSha256: pin,
  issuerChainDerBase64: z.array(base64(32768)).min(1).max(5),
  crlsDerBase64: z.array(base64(1024 * 1024)).min(1).max(6),
}).strict();
const trustSchema = z.object({ version: z.literal('ZATCA_CERTIFICATE_TRUST_V1'), environment,
  anchors: z.array(z.object({ certificateDerBase64: base64(32768), fingerprintSha256: pin }).strict()).min(1).max(5),
}).strict();
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function decode(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('CERTIFICATE_PATH_ENCODING_INVALID');
  return bytes;
}
function certificate(value: string): X509Certificate {
  const bytes = decode(value);
  try { const cert = new X509Certificate(bytes); if (cert.raw.equals(bytes)) return cert; }
  catch { /* Do not expose certificate content/native parser diagnostics. */ }
  throw new Error('CERTIFICATE_PATH_CERTIFICATE_INVALID');
}
function pem(label: string, bytes: Uint8Array) {
  return `-----BEGIN ${label}-----\n${Buffer.from(bytes).toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END ${label}-----\n`;
}
// X509Certificate.keyUsage exposes EXTENDED key usages. Inspect the actual
// KeyUsage DER extension too; sslclient alone can allow keyAgreement-only keys.
function certificateTree(bytes: Buffer) {
  type Node = { tag: number; start: number; end: number };
  const invalid = () => new Error('CERTIFICATE_PATH_DER_INVALID');
  const node = (offset: number, limit: number): Node => {
    const tag = bytes[offset++]; if (tag === undefined || offset >= limit || (tag & 31) === 31) throw invalid();
    let length = bytes[offset++];
    if (length & 128) {
      const count = length & 127;
      if (!count || count > 3 || offset + count > limit || bytes[offset] === 0) throw invalid();
      length = 0; for (let i = 0; i < count; i++) length = length * 256 + bytes[offset++];
      if (length < 128) throw invalid();
    }
    if (offset + length > limit) throw invalid();
    return { tag, start: offset, end: offset + length };
  };
  const children = (parent: Node) => {
    const nodes: Node[] = []; let offset = parent.start;
    while (offset < parent.end) { const child = node(offset, parent.end); nodes.push(child); offset = child.end; }
    return nodes;
  };
  const root = node(0, bytes.length);
  if (root.tag !== 0x30 || root.end !== bytes.length) throw invalid();
  const tbs = children(root)[0]; if (!tbs || tbs.tag !== 0x30) throw invalid();
  return { root, tbs, node, children };
}
function requireStrongCertificateSignature(bytes: Buffer, leaf: boolean) {
  const { root, children } = certificateTree(bytes);
  const algorithm = children(root)[1];
  if (!algorithm || algorithm.tag !== 0x30) throw new Error('CERTIFICATE_PATH_SIGNATURE_ALGORITHM_INVALID');
  const oid = children(algorithm)[0];
  const value = oid?.tag === 0x06 ? bytes.subarray(oid.start, oid.end).toString('hex') : '';
  const allowed = leaf ? ['2a8648ce3d040302'] : [
    '2a8648ce3d040302', '2a8648ce3d040303', '2a8648ce3d040304',
    '2a864886f70d01010b', '2a864886f70d01010c', '2a864886f70d01010d',
  ];
  if (!allowed.includes(value)) throw new Error('CERTIFICATE_PATH_SIGNATURE_ALGORITHM_INVALID');
}
function requireDigitalSignatureUsage(bytes: Buffer) {
  const { tbs, node, children } = certificateTree(bytes);
  const invalid = () => new Error('CERTIFICATE_PATH_KEY_USAGE_INVALID');
  const extensions = children(tbs).filter(n => n.tag === 0xa3); if (extensions.length !== 1) throw invalid();
  const wrapper = children(extensions[0]); if (wrapper.length !== 1 || wrapper[0].tag !== 0x30) throw invalid();
  const usages = children(wrapper[0]).map(ext => {
    if (ext.tag !== 0x30) throw invalid();
    const fields = children(ext); if (fields[0]?.tag !== 0x06) throw invalid();
    return { fields, oid: bytes.subarray(fields[0].start, fields[0].end).toString('hex') };
  }).filter(ext => ext.oid === '551d0f');
  if (usages.length !== 1) throw invalid();
  const [oid, critical, value] = usages[0].fields;
  if (!oid || usages[0].fields.length !== 3 || critical.tag !== 0x01 || critical.end - critical.start !== 1
      || bytes[critical.start] !== 255 || value.tag !== 0x04) throw invalid();
  const bits = node(value.start, value.end);
  if (bits.tag !== 0x03 || bits.end !== value.end || bits.end - bits.start < 2 || bits.end - bits.start > 3) throw invalid();
  const unused = bytes[bits.start], flags = bytes[bits.start + 1];
  if (unused > 7 || (bytes[bits.end - 1] & ((1 << unused) - 1)) !== 0
      || !(flags & 0x80) || (flags & 0x04)) throw invalid();
}

/** Backend-only offline path/revocation preflight. Trust anchors must come from
 * protected deployment configuration, never the certificate response/request.
 * Requires packaged Linux /usr/bin/openssl 3.x; no shell, system trust fallback,
 * AIA/CRL fetching, private keys, caller-selected executable or file paths.
 * This is not ZATCA VAT/EGS identity, certificate-policy or authority approval.
 */
async function verifyPath(inputValue: unknown, configuredTrust: unknown, at: Date) {
  let input: z.infer<typeof inputSchema>, trust: z.infer<typeof trustSchema>;
  try { input = inputSchema.parse(inputValue); trust = trustSchema.parse(configuredTrust); }
  catch { throw new Error('CERTIFICATE_PATH_INPUT_INVALID'); }
  const checkedAt = new Date(at.getTime());
  if (!Number.isFinite(checkedAt.getTime()) || checkedAt.getTime() < 0) throw new Error('INVALID_CERTIFICATE_CHECK_TIME');
  if (trust.environment !== input.environment) throw new Error('CERTIFICATE_PATH_ENVIRONMENT_MISMATCH');
  const inspected = inspectZatcaSigningCertificate(input.certificateDerBase64, input.expectedFingerprintSha256, checkedAt);
  const leaf = certificate(input.certificateDerBase64);
  requireDigitalSignatureUsage(leaf.raw); requireStrongCertificateSignature(leaf.raw, true);
  if (!leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.2')) throw new Error('CERTIFICATE_PATH_CLIENT_AUTH_REQUIRED');
  const issuers = input.issuerChainDerBase64.map(certificate);
  const anchors = trust.anchors.map(anchor => {
    const cert = certificate(anchor.certificateDerBase64);
    if (hash(cert.raw) !== anchor.fingerprintSha256 || !cert.ca || !cert.checkIssued(cert) || !cert.verify(cert.publicKey))
      throw new Error('CERTIFICATE_PATH_ANCHOR_INVALID');
    return cert;
  });
  for (const cert of [...issuers, ...anchors]) requireStrongCertificateSignature(cert.raw, false);
  const pins = [leaf, ...issuers].map(cert => hash(cert.raw));
  if (new Set(pins).size !== pins.length || new Set(anchors.map(cert => hash(cert.raw))).size !== anchors.length)
    throw new Error('CERTIFICATE_PATH_DUPLICATE_CERTIFICATE');
  let child = leaf;
  for (const issuer of issuers) {
    if (!issuer.ca || !child.checkIssued(issuer) || !child.verify(issuer.publicKey)) throw new Error('CERTIFICATE_PATH_CHAIN_INVALID');
    child = issuer;
  }
  const anchor = anchors.find(cert => cert.raw.equals(child.raw));
  if (!anchor) throw new Error('CERTIFICATE_PATH_ANCHOR_NOT_CONFIGURED');
  const crls = input.crlsDerBase64.map(decode);
  // CRL CertificateList has the same outer signed-container layout. Reject weak
  // CRL signature algorithms explicitly rather than delegating that policy.
  for (const crl of crls) {
    try { requireStrongCertificateSignature(crl, false); }
    catch { throw new Error('CERTIFICATE_PATH_OR_REVOCATION_REJECTED'); }
  }
  if (new Set(crls.map(hash)).size !== crls.length) throw new Error('CERTIFICATE_PATH_DUPLICATE_CRL');
  let directory: string | undefined;
  let engine: string;
  try {
    try {
      const version = await execute('/usr/bin/openssl', ['version'], { timeout: 5000, maxBuffer: 4096 });
      const match = /^OpenSSL (3\.\d+\.\d+)(?:\s|$)/.exec(version.stdout);
      if (!match) throw new Error(); engine = `OpenSSL ${match[1]}`;
    } catch { throw new Error('CERTIFICATE_PATH_ENGINE_UNAVAILABLE'); }
    directory = await mkdtemp(join(tmpdir(), 'zatca-path-')); await chmod(directory, 0o700);
    const files = { leaf: join(directory, 'leaf.pem'), anchor: join(directory, 'anchor.pem'),
      issuers: join(directory, 'issuers.pem'), crls: join(directory, 'crls.pem') };
    const writes = await Promise.allSettled([
      writeFile(files.leaf, pem('CERTIFICATE', leaf.raw), { mode: 0o600 }),
      writeFile(files.anchor, pem('CERTIFICATE', anchor.raw), { mode: 0o600 }),
      writeFile(files.issuers, issuers.slice(0, -1).map(cert => pem('CERTIFICATE', cert.raw)).join(''), { mode: 0o600 }),
      writeFile(files.crls, crls.map(crl => pem('X509 CRL', crl)).join(''), { mode: 0o600 }),
    ]);
    if (writes.some(result => result.status === 'rejected')) throw new Error('CERTIFICATE_PATH_ENGINE_UNAVAILABLE');
    const args = ['verify', '-no-CAfile', '-no-CApath', '-no-CAstore', '-trusted', files.anchor,
      '-x509_strict', '-check_ss_sig', '-auth_level', '2', '-purpose', 'sslclient', '-verify_depth', '5',
      '-attime', Math.floor(checkedAt.getTime() / 1000).toString(), '-crl_check_all', '-CRLfile', files.crls];
    if (issuers.length > 1) args.push('-untrusted', files.issuers);
    args.push(files.leaf);
    try { await execute('/usr/bin/openssl', args, { timeout: 15000, maxBuffer: 65536 }); }
    catch { throw new Error('CERTIFICATE_PATH_OR_REVOCATION_REJECTED'); }
  } catch (error) {
    const allowed = ['CERTIFICATE_PATH_ENGINE_UNAVAILABLE', 'CERTIFICATE_PATH_OR_REVOCATION_REJECTED'];
    throw new Error(error instanceof Error && allowed.includes(error.message) ? error.message : 'CERTIFICATE_PATH_ENGINE_UNAVAILABLE');
  } finally {
    if (directory) {
      try { await rm(directory, { recursive: true, force: true }); }
      catch { throw new Error('CERTIFICATE_PATH_CLEANUP_FAILED'); }
    }
  }
  return { stage: 'CERTIFICATE_PATH_CHECK_ONLY' as const, environment: input.environment,
    certificateFingerprintSha256: inspected.fingerprintSha256, anchorFingerprintSha256: hash(anchor.raw),
    issuerFingerprintsSha256: pins.slice(1), crlFingerprintsSha256: crls.map(hash),
    checkedAt: checkedAt.toISOString(), engine };
}


/** Sanitize unexpected Node/filesystem/engine failures as well as verification failures. */
export async function verifyZatcaCertificatePath(inputValue: unknown, configuredTrust: unknown, at: Date = new Date()) {
  const safeCodes = new Set([
    'CERTIFICATE_PATH_INPUT_INVALID', 'CERTIFICATE_PATH_ENCODING_INVALID', 'CERTIFICATE_PATH_CERTIFICATE_INVALID',
    'CERTIFICATE_PATH_DER_INVALID', 'CERTIFICATE_PATH_KEY_USAGE_INVALID', 'CERTIFICATE_PATH_SIGNATURE_ALGORITHM_INVALID',
    'CERTIFICATE_PATH_ENVIRONMENT_MISMATCH', 'CERTIFICATE_PATH_CLIENT_AUTH_REQUIRED', 'CERTIFICATE_PATH_ANCHOR_INVALID',
    'CERTIFICATE_PATH_DUPLICATE_CERTIFICATE', 'CERTIFICATE_PATH_CHAIN_INVALID', 'CERTIFICATE_PATH_ANCHOR_NOT_CONFIGURED',
    'CERTIFICATE_PATH_DUPLICATE_CRL', 'CERTIFICATE_PATH_ENGINE_UNAVAILABLE', 'CERTIFICATE_PATH_OR_REVOCATION_REJECTED',
    'CERTIFICATE_PATH_CLEANUP_FAILED', 'INVALID_CERTIFICATE_CHECK_TIME', 'INVALID_CERTIFICATE_PIN',
    'INVALID_SIGNING_CERTIFICATE', 'SIGNING_CERTIFICATE_PIN_MISMATCH', 'INVALID_CERTIFICATE_VALIDITY',
    'SIGNING_CERTIFICATE_NOT_YET_VALID', 'SIGNING_CERTIFICATE_EXPIRED', 'SIGNING_CERTIFICATE_IS_CA',
    'INVALID_ZATCA_KEY_CURVE', 'INVALID_CERTIFICATE_SERIAL',
  ]);
  try { return await verifyPath(inputValue, configuredTrust, at); }
  catch (error) { throw new Error(error instanceof Error && safeCodes.has(error.message) ? error.message : 'CERTIFICATE_PATH_INPUT_INVALID'); }
}
