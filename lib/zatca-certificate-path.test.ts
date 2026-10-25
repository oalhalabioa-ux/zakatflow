import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyZatcaCertificatePath } from './zatca-certificate-path';

let directory: string, at: Date;
const run = (...args: string[]) => execFileSync('/usr/bin/openssl', args, { cwd: directory, stdio: 'pipe' });
const path = (name: string) => join(directory, name);
const fingerprint = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function cert(name: string) { return new X509Certificate(readFileSync(path(`${name}.pem`))); }
function csr(name: string, curve = 'prime256v1') {
  run('req', '-new', '-newkey', 'ec', '-pkeyopt', `ec_paramgen_curve:${curve}`, '-nodes',
    '-keyout', path(`${name}.key`), '-out', path(`${name}.csr`), '-subj', `/C=SA/O=Synthetic Path QA/CN=${name}`);
}
function config(name: string) {
  writeFileSync(path(`${name}.index`), ''); writeFileSync(path(`${name}.serial`), '1000\n'); writeFileSync(path(`${name}.crlnumber`), '1000\n');
  const text = `[ca]\ndefault_ca=issuer\n[issuer]\ncertificate=${path(`${name}.pem`)}\nprivate_key=${path(`${name}.key`)}\ndatabase=${path(`${name}.index`)}\nserial=${path(`${name}.serial`)}\ncrlnumber=${path(`${name}.crlnumber`)}\nnew_certs_dir=${directory}\ndefault_md=sha256\ndefault_days=2\ndefault_crl_days=1\npolicy=names\nunique_subject=no\ncrl_extensions=crl_ext\n[names]\ncountryName=optional\norganizationName=optional\ncommonName=supplied\n[ca_ext]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n[crl_ext]\nauthorityKeyIdentifier=keyid:always\n`;
  writeFileSync(path(`${name}.cnf`), text);
}
function issue(name: string, issuer: string, extra = '', usage = 'critical,digitalSignature', eku = 'clientAuth', digest = 'sha256') {
  csr(name, 'secp256k1');
  const extensions = `[leaf]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=${usage}\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n${eku ? `extendedKeyUsage=${eku}\n` : ''}${extra}\n`;
  writeFileSync(path(`${name}.ext`), extensions);
  run('ca', '-batch', '-notext', '-config', path(`${issuer}.cnf`), '-in', path(`${name}.csr`), '-out', path(`${name}.pem`),
    '-extfile', path(`${name}.ext`), '-extensions', 'leaf', '-md', digest);
  return cert(name);
}
function timestamp(date: Date) { return date.toISOString().replace(/[-:TZ]/g, '').slice(0, 14) + 'Z'; }
function crl(issuer: string, output: string, offsetLast = -60, offsetNext = 3600, digest = 'sha256') {
  run('ca', '-gencrl', '-config', path(`${issuer}.cnf`), '-out', path(`${output}.pem`),
    '-md', digest, '-crl_lastupdate', timestamp(new Date(at.getTime() + offsetLast * 1000)), '-crl_nextupdate', timestamp(new Date(at.getTime() + offsetNext * 1000)));
  return run('crl', '-in', path(`${output}.pem`), '-outform', 'DER').toString('base64');
}
let goodRootCrl: string, goodIssuerCrl: string, revokedRootCrl: string, revokedLeafCrl: string;
let expiredCrl: string, futureCrl: string, badSignatureCrl: string, weakCrl: string;
function fixture(leaf = 'leaf') {
  const c = cert(leaf), root = cert('root');
  return {
    input: { environment: 'SIMULATION' as const, certificateDerBase64: c.raw.toString('base64'), expectedFingerprintSha256: fingerprint(c.raw),
      issuerChainDerBase64: [cert('issuer').raw.toString('base64'), root.raw.toString('base64')], crlsDerBase64: [goodRootCrl, goodIssuerCrl] },
    trust: { version: 'ZATCA_CERTIFICATE_TRUST_V1', environment: 'SIMULATION',
      anchors: [{ certificateDerBase64: root.raw.toString('base64'), fingerprintSha256: fingerprint(root.raw) }] },
  };
}
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'zatca-path-fixture-'));
  run('req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-keyout', path('root.key'), '-out', path('root.pem'), '-days', '3', '-subj', '/C=SA/O=Synthetic Path QA/CN=Root',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:1', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-addext', 'subjectKeyIdentifier=hash');
  config('root'); csr('issuer');
  run('ca', '-batch', '-notext', '-config', path('root.cnf'), '-in', path('issuer.csr'), '-out', path('issuer.pem'), '-extensions', 'ca_ext');
  config('issuer');
  issue('directLeaf', 'root'); issue('leaf', 'issuer'); issue('revoked', 'issuer'); issue('wrongUsage', 'issuer', '', 'critical,keyEncipherment');
  issue('agreementOnly', 'issuer', '', 'critical,keyAgreement'); issue('noncriticalUsage', 'issuer', '', 'digitalSignature');
  issue('wrongPurpose', 'issuer', '', 'critical,digitalSignature', 'serverAuth'); issue('missingEku', 'issuer', '', 'critical,digitalSignature', '');
  issue('weakSignature', 'issuer', '', 'critical,digitalSignature', 'clientAuth', 'sha1');
  issue('unknownCritical', 'issuer', '1.2.3.4=critical,DER:01:01:FF');
  run('req', '-new', '-x509', '-key', path('root.key'), '-out', path('limitedRoot.pem'), '-days', '3',
    '-subj', '/C=SA/O=Synthetic Path QA/CN=Root', '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-addext', 'subjectKeyIdentifier=hash');
  run('ca', '-batch', '-notext', '-config', path('root.cnf'), '-in', path('issuer.csr'), '-out', path('expiredIssuer.pem'),
    '-extensions', 'ca_ext', '-startdate', timestamp(new Date(Date.now() - 2 * 86400000)), '-enddate', timestamp(new Date(Date.now() - 86400000)));
  writeFileSync(path('constrained.ext'), '[ca_ext]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\nnameConstraints=critical,permitted;DNS:.allowed.invalid\n');
  run('ca', '-batch', '-notext', '-config', path('root.cnf'), '-in', path('issuer.csr'), '-out', path('constrainedIssuer.pem'),
    '-extensions', 'ca_ext', '-extfile', path('constrained.ext'));
  issue('badDns', 'issuer', 'subjectAltName=DNS:blocked.invalid');
  at = new Date(Date.now() + 60_000);
  goodRootCrl = crl('root', 'root-good'); goodIssuerCrl = crl('issuer', 'issuer-good');
  weakCrl = crl('issuer', 'issuer-weak', -60, 3600, 'sha1');
  expiredCrl = crl('issuer', 'issuer-expired', -3600, -30); futureCrl = crl('issuer', 'issuer-future', 3600, 7200);
  run('ca', '-config', path('issuer.cnf'), '-revoke', path('revoked.pem')); revokedLeafCrl = crl('issuer', 'issuer-revoked');
  run('ca', '-config', path('root.cnf'), '-revoke', path('issuer.pem')); revokedRootCrl = crl('root', 'root-revoked');
  const corrupt = Buffer.from(goodIssuerCrl, 'base64'); corrupt[corrupt.length - 1] ^= 1; badSignatureCrl = corrupt.toString('base64');
}, 30_000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

describe('offline configured certificate path and complete-chain CRL validation', () => {
  it('verifies the exact pinned leaf through its intermediate to the configured root with fresh signed CRLs', async () => {
    const f = fixture(); const result = await verifyZatcaCertificatePath(f.input, f.trust, at);
    expect(result.stage).toBe('CERTIFICATE_PATH_CHECK_ONLY'); expect(result.certificateFingerprintSha256).toBe(f.input.expectedFingerprintSha256);
    expect(result.anchorFingerprintSha256).toBe(f.trust.anchors[0].fingerprintSha256);
    expect(result.issuerFingerprintsSha256).toEqual(f.input.issuerChainDerBase64.map(value => fingerprint(Buffer.from(value, 'base64'))));
    expect(result.crlFingerprintsSha256).toEqual(f.input.crlsDerBase64.map(value => fingerprint(Buffer.from(value, 'base64'))));
    expect(result.engine).toMatch(/^OpenSSL 3\./); expect(result.checkedAt).toBe(at.toISOString());
  });
  it('verifies a leaf issued directly by the configured root without an intermediate file', async () => {
    const f = fixture('directLeaf'); f.input.issuerChainDerBase64 = [cert('root').raw.toString('base64')]; f.input.crlsDerBase64 = [goodRootCrl];
    expect((await verifyZatcaCertificatePath(f.input, f.trust, at)).stage).toBe('CERTIFICATE_PATH_CHECK_ONLY');
  });
  it('does not infer trust from a valid self-signed root supplied with the leaf', async () => {
    const f = fixture(), other = cert('limitedRoot');
    f.trust.anchors = [{ certificateDerBase64: other.raw.toString('base64'), fingerprintSha256: fingerprint(other.raw) }];
    await expect(verifyZatcaCertificatePath(f.input, f.trust, at)).rejects.toThrow('CERTIFICATE_PATH_ANCHOR_NOT_CONFIGURED');
  });
  it('requires independently configured trust for the same environment', async () => {
    const f = fixture(); f.trust.environment = 'PRODUCTION';
    await expect(verifyZatcaCertificatePath(f.input, f.trust, at)).rejects.toThrow('CERTIFICATE_PATH_ENVIRONMENT_MISMATCH');
  });
  it('rejects request-selected command/path overrides and absent trust configuration', async () => {
    const f = fixture();
    for (const input of [{ ...f.input, executable: '/bin/sh' }, { ...f.input, certificatePath: '/tmp/cert' }])
      await expect(verifyZatcaCertificatePath(input, f.trust, at)).rejects.toThrow('CERTIFICATE_PATH_INPUT_INVALID');
    await expect(verifyZatcaCertificatePath(f.input, { ...f.trust, anchors: [] }, at)).rejects.toThrow('CERTIFICATE_PATH_INPUT_INVALID');
  });
  it('rejects a wrong leaf pin', async () => {
    const f = fixture(); f.input.expectedFingerprintSha256 = '0'.repeat(64);
    await expect(verifyZatcaCertificatePath(f.input, f.trust, at)).rejects.toThrow('SIGNING_CERTIFICATE_PIN_MISMATCH');
  });
  it('rejects wrong anchor pins and a leaf/intermediate promoted to a root', async () => {
    const f = fixture();
    for (const c of [cert('leaf'), cert('issuer')]) await expect(verifyZatcaCertificatePath(f.input,
      { ...f.trust, anchors: [{ certificateDerBase64: c.raw.toString('base64'), fingerprintSha256: fingerprint(c.raw) }] }, at)).rejects.toThrow('CERTIFICATE_PATH_ANCHOR_INVALID');
    f.trust.anchors[0].fingerprintSha256 = '0'.repeat(64);
    await expect(verifyZatcaCertificatePath(f.input, f.trust, at)).rejects.toThrow('CERTIFICATE_PATH_ANCHOR_INVALID');
  });
  it.each(['reversed', 'missingIntermediate', 'missingRoot', 'duplicate', 'badSignature'])('rejects %s issuer chain', async mode => {
    const f = fixture();
    if (mode === 'reversed') f.input.issuerChainDerBase64.reverse();
    if (mode === 'missingIntermediate') f.input.issuerChainDerBase64.shift();
    if (mode === 'missingRoot') f.input.issuerChainDerBase64.pop();
    if (mode === 'duplicate') f.input.issuerChainDerBase64.push(f.input.issuerChainDerBase64[1]);
    if (mode === 'badSignature') { const bytes = Buffer.from(f.input.issuerChainDerBase64[0], 'base64'); bytes[bytes.length - 1] ^= 1; f.input.issuerChainDerBase64[0] = bytes.toString('base64'); }
    await expect(verifyZatcaCertificatePath(f.input, f.trust, at)).rejects.toThrow(/CERTIFICATE_PATH_(CHAIN_INVALID|ANCHOR_NOT_CONFIGURED|DUPLICATE_CERTIFICATE)/);
  });
  it.each(['wrongUsage', 'agreementOnly', 'noncriticalUsage', 'wrongPurpose', 'missingEku', 'weakSignature', 'unknownCritical'])('rejects unsupported %s leaf profile', async name => {
    const f = fixture(name);
    await expect(verifyZatcaCertificatePath(f.input, f.trust, at)).rejects.toThrow(/CERTIFICATE_PATH_(KEY_USAGE_INVALID|CLIENT_AUTH_REQUIRED|SIGNATURE_ALGORITHM_INVALID|OR_REVOCATION_REJECTED)/);
  });
  it('rejects an expired or not-yet-valid leaf and an invalid check time', async () => {
    const f = fixture(), c = cert('leaf');
    await expect(verifyZatcaCertificatePath(f.input, f.trust, new Date(Date.parse(c.validFrom) - 1000))).rejects.toThrow('SIGNING_CERTIFICATE_NOT_YET_VALID');
    await expect(verifyZatcaCertificatePath(f.input, f.trust, new Date(Date.parse(c.validTo) + 1000))).rejects.toThrow('SIGNING_CERTIFICATE_EXPIRED');
    await expect(verifyZatcaCertificatePath(f.input, f.trust, new Date(NaN))).rejects.toThrow('INVALID_CERTIFICATE_CHECK_TIME');
  });
  it('enforces the trust anchor path-length constraint', async () => {
    const f = fixture(), root = cert('limitedRoot'); f.input.issuerChainDerBase64[1] = root.raw.toString('base64');
    f.trust.anchors = [{ certificateDerBase64: root.raw.toString('base64'), fingerprintSha256: fingerprint(root.raw) }];
    await expect(verifyZatcaCertificatePath(f.input, f.trust, at)).rejects.toThrow('CERTIFICATE_PATH_OR_REVOCATION_REJECTED');
  });
  it('rejects an expired intermediate even when the leaf and root are valid', async () => {
    const f = fixture(); f.input.issuerChainDerBase64[0] = cert('expiredIssuer').raw.toString('base64');
    await expect(verifyZatcaCertificatePath(f.input, f.trust, at)).rejects.toThrow('CERTIFICATE_PATH_OR_REVOCATION_REJECTED');
  });
  it('enforces intermediate name constraints', async () => {
    const f = fixture('badDns'); f.input.issuerChainDerBase64[0] = cert('constrainedIssuer').raw.toString('base64');
    await expect(verifyZatcaCertificatePath(f.input, f.trust, at)).rejects.toThrow('CERTIFICATE_PATH_OR_REVOCATION_REJECTED');
  });
  it('rejects a revoked leaf even when its issuer is valid', async () => {
    const f = fixture('revoked'); f.input.crlsDerBase64 = [goodRootCrl, revokedLeafCrl];
    await expect(verifyZatcaCertificatePath(f.input, f.trust, at)).rejects.toThrow('CERTIFICATE_PATH_OR_REVOCATION_REJECTED');
  });
  it('checks intermediate revocation too, not just the leaf', async () => {
    const f = fixture(); f.input.crlsDerBase64 = [revokedRootCrl, goodIssuerCrl];
    await expect(verifyZatcaCertificatePath(f.input, f.trust, at)).rejects.toThrow('CERTIFICATE_PATH_OR_REVOCATION_REJECTED');
  });
  it.each(['missingRootCrl', 'missingLeafCrl', 'expired', 'future', 'badSignature', 'weakSignature', 'malformed'])('rejects %s CRL evidence', async mode => {
    const f = fixture();
    if (mode === 'missingRootCrl') f.input.crlsDerBase64 = [goodIssuerCrl];
    if (mode === 'missingLeafCrl') f.input.crlsDerBase64 = [goodRootCrl];
    if (mode === 'expired') f.input.crlsDerBase64 = [goodRootCrl, expiredCrl];
    if (mode === 'future') f.input.crlsDerBase64 = [goodRootCrl, futureCrl];
    if (mode === 'weakSignature') f.input.crlsDerBase64 = [goodRootCrl, weakCrl];
    if (mode === 'badSignature') f.input.crlsDerBase64 = [goodRootCrl, badSignatureCrl];
    if (mode === 'malformed') f.input.crlsDerBase64 = [Buffer.from('NOT_A_CRL_PRIVATE_MARKER').toString('base64')];
    const error = await verifyZatcaCertificatePath(f.input, f.trust, at).catch(error => error);
    expect(error.message).toBe('CERTIFICATE_PATH_OR_REVOCATION_REJECTED'); expect(error.cause).toBeUndefined();
    expect(String(error)).not.toContain('NOT_A_CRL_PRIVATE_MARKER'); expect(String(error)).not.toContain('/tmp/');
  });
  it('rejects duplicate CRLs and trust anchors', async () => {
    const f = fixture();
    await expect(verifyZatcaCertificatePath({ ...f.input, crlsDerBase64: [goodRootCrl, goodRootCrl] }, f.trust, at)).rejects.toThrow('CERTIFICATE_PATH_DUPLICATE_CRL');
    await expect(verifyZatcaCertificatePath(f.input, { ...f.trust, anchors: [f.trust.anchors[0], f.trust.anchors[0]] }, at)).rejects.toThrow('CERTIFICATE_PATH_DUPLICATE_CERTIFICATE');
  });
  it('rejects noncanonical/trailing DER, oversized inputs and private material wrappers', async () => {
    const f = fixture();
    for (const value of [f.input.certificateDerBase64 + '=', Buffer.concat([cert('leaf').raw, Buffer.from([0])]).toString('base64'),
      'A'.repeat(32772), '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----'])
      await expect(verifyZatcaCertificatePath({ ...f.input, certificateDerBase64: value }, f.trust, at)).rejects.toThrow();
  });
  it('captures caller arrays, configuration and time before asynchronous work', async () => {
    const f = fixture(), date = new Date(at); const pending = verifyZatcaCertificatePath(f.input, f.trust, date);
    f.input.issuerChainDerBase64.length = 0; f.input.crlsDerBase64.length = 0; f.trust.anchors.length = 0; date.setFullYear(1990);
    expect((await pending).checkedAt).toBe(at.toISOString());
  });
  it('cleans temporary certificate/CRL files after success and failure', async () => {
    const before = readdirSync(tmpdir()).filter(name => name.startsWith('zatca-path-') && !name.startsWith('zatca-path-fixture-')).sort();
    const f = fixture(); await verifyZatcaCertificatePath(f.input, f.trust, at);
    await verifyZatcaCertificatePath({ ...f.input, crlsDerBase64: [badSignatureCrl, goodRootCrl] }, f.trust, at).catch(() => {});
    expect(readdirSync(tmpdir()).filter(name => name.startsWith('zatca-path-') && !name.startsWith('zatca-path-fixture-')).sort()).toEqual(before);
  });
});
