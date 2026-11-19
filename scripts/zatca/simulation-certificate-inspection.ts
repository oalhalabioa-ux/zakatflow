import { execFile } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { inspectZatcaSigningCertificate } from '../../lib/zatca-signing-certificate';

export type SimulationNativeInspection = {
  state: 'AVAILABLE' | 'UNSUPPORTED' | 'UNAVAILABLE';
  engine?: string;
  issuerAccessUrls?: string[];
  crlDistributionUrls?: string[];
  policyOids?: string[];
};

// Fixed executable/arguments, bounded output/time, public certificate stdin only.
// No shell, temporary material, network, credential, private key or path override.
function command(args: string[], certificate?: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('/usr/bin/openssl', args, { timeout: 5000, maxBuffer: 16384, encoding: 'utf8' },
      (error, stdout) => error ? reject(new Error('QA_CERTIFICATE_ENGINE_UNAVAILABLE')) : resolve(stdout));
    // A missing executable can close stdin before end; do not expose raw errors.
    child.stdin?.on('error', () => {});
    child.stdin?.end(certificate);
  });
}

function diagnosticUrl(value: string): string | null {
  if (value.length > 2048 || !/^[\x21-\x7e]+$/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) return null;
    return value;
  } catch { return null; }
}

/** Discovery hints only: certificate URLs/issuer are UNTRUSTED and never fetched.
 * An available OpenSSL 3 binary is NOT a verified CA path/revocation result.
 */
export async function inspectSimulationNativeRuntime(certificate: Buffer): Promise<SimulationNativeInspection> {
  try {
    const version = /^OpenSSL (\d+\.\d+\.\d+)(?:\s|$)/.exec(await command(['version']));
    if (!version || !version[1].startsWith('3.')) return { state: 'UNSUPPORTED' };
    const output = await command(['x509', '-inform', 'DER', '-noout', '-ext',
      'authorityInfoAccess,crlDistributionPoints,certificatePolicies'], certificate);
    const access = new Set<string>(), crls = new Set<string>(), policies = new Set<string>();
    let section = '';
    for (const line of output.split(/\r?\n/)) {
      if (/^\S/.test(line)) section = line.trim();
      const uri = /(?:^|\s)URI:(\S+)$/.exec(line);
      const url = uri ? diagnosticUrl(uri[1]) : null;
      if (url && access.size < 8 && section.startsWith('Authority Information Access:')) access.add(url);
      if (url && crls.size < 8 && section.startsWith('X509v3 CRL Distribution Points:')) crls.add(url);
      const policy = /^\s*Policy: ([0-9]+(?:\.[0-9]+)+)\s*$/.exec(line);
      if (section.startsWith('X509v3 Certificate Policies:') && policy && policy[1].length <= 128 && policies.size < 8) policies.add(policy[1]);
    }
    return { state: 'AVAILABLE', engine: 'OpenSSL ' + version[1], issuerAccessUrls: [...access], crlDistributionUrls: [...crls], policyOids: [...policies] };
  } catch { return { state: 'UNAVAILABLE' }; }
}

/** Protected read-only public-certificate evidence; never return the certificate,
 * original token, subject/SAN, serial, credential, CSR, key material or native log.
 * Time/curve checks are distinct from PKIX trust, revocation and invoice acceptance.
 */
export async function inspectSimulationCertificate(
  der: Buffer, freshKmsKeyMatched: boolean | null,
  runtime: (certificate: Buffer) => Promise<SimulationNativeInspection> = inspectSimulationNativeRuntime,
  at = new Date(),
) {
  if (!Buffer.isBuffer(der) || der.length > 32768 || !Number.isFinite(at.getTime())) throw new Error('QA_CERTIFICATE_INSPECTION_INVALID');
  const bytes = Buffer.from(der), checkedAt = new Date(at.getTime());
  let cert: X509Certificate;
  try { cert = new X509Certificate(bytes); }
  catch { throw new Error('QA_CERTIFICATE_INSPECTION_INVALID'); }
  if (!cert.raw.equals(bytes)) throw new Error('QA_CERTIFICATE_INSPECTION_INVALID');
  const fingerprint = createHash('sha256').update(bytes).digest('hex');
  let timeKeyPreflight: 'PASSED' | 'EXPIRED' | 'NOT_YET_VALID' | 'REJECTED' = 'REJECTED';
  try { inspectZatcaSigningCertificate(bytes.toString('base64'), fingerprint, checkedAt); timeKeyPreflight = 'PASSED'; }
  catch (error) {
    if (error instanceof Error && error.message === 'SIGNING_CERTIFICATE_EXPIRED') timeKeyPreflight = 'EXPIRED';
    if (error instanceof Error && error.message === 'SIGNING_CERTIFICATE_NOT_YET_VALID') timeKeyPreflight = 'NOT_YET_VALID';
  }
  let nativeRuntime: SimulationNativeInspection;
  try { nativeRuntime = await runtime(Buffer.from(bytes)); }
  catch { nativeRuntime = { state: 'UNAVAILABLE' }; }
  const from = Date.parse(cert.validFrom), to = Date.parse(cert.validTo);
  return {
    stage: 'SIMULATION_CERTIFICATE_INSPECTION_ONLY' as const, checkedAt: checkedAt.toISOString(), fingerprintSha256: fingerprint,
    issuer: cert.issuer.slice(0, 2048).replace(/[\x00-\x1f\x7f]/g, ' '),
    validFrom: Number.isFinite(from) ? new Date(from).toISOString() : null,
    validTo: Number.isFinite(to) ? new Date(to).toISOString() : null,
    timeKeyPreflight, freshKmsKeyMatched, selfIssued: cert.checkIssued(cert),
    extendedKeyUsage: (cert.keyUsage ?? []).filter(oid => /^[0-9]+(?:\.[0-9]+)+$/.test(oid)).slice(0, 12),
    nativeRuntime, discoveryHintsTrusted: false as const, trustVerified: false as const, activationAllowed: false as const,
  };
}
