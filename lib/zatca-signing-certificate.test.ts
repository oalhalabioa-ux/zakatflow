import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectZatcaSigningCertificate } from './zatca-signing-certificate';

let directory: string;
let pem: string;
let cert: X509Certificate;
let pin: string;
let at: Date;
function fixture(name: string, curve = 'secp256k1', ca = false) {
  const output = join(directory, `${name}.pem`);
  execFileSync('openssl', ['req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', `ec_paramgen_curve:${curve}`,
    '-nodes', '-keyout', join(directory, `${name}.key`), '-out', output, '-days', '2', '-set_serial', '0xFEDCBA98765432100123456789',
    '-subj', '/C=SA/O=Synthetic Test Only/CN=EGS Test', '-addext', `basicConstraints=critical,CA:${ca ? 'TRUE' : 'FALSE'}`,
    '-addext', ca ? 'keyUsage=critical,digitalSignature,keyCertSign,cRLSign' : 'keyUsage=critical,digitalSignature'], { stdio: 'pipe' });
  return readFileSync(output, 'utf8');
}
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'zatca-certificate-'));
  pem = fixture('leaf');
  cert = new X509Certificate(pem);
  pin = createHash('sha256').update(cert.raw).digest('hex');
  at = new Date(Date.parse(cert.validFrom) + 60000);
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

describe('ZATCA signing certificate preflight', () => {
  it('extracts exact public material from one pinned PEM certificate', () => {
    const result = inspectZatcaSigningCertificate(pem, pin, at);
    expect(result.stage).toBe('CERTIFICATE_PREFLIGHT_ONLY');
    expect(result.publicKeySpki).toEqual(cert.publicKey.export({ format: 'der', type: 'spki' }));
    expect(result.certificateDerBase64).toBe(cert.raw.toString('base64'));
    expect(result.serialNumberDecimal).toBe(BigInt('0xFEDCBA98765432100123456789').toString());
    // Independent CLI digest, not a second call to the implementation's hash helper.
    const digest = execFileSync('openssl', ['dgst', '-sha256', '-binary'], { input: cert.raw });
    expect(result.certificateDigestBase64).toBe(digest.toString('base64'));
  });
  it('accepts canonical base64 DER and uppercase pins', () => {
    expect(inspectZatcaSigningCertificate(cert.raw.toString('base64'), pin.toUpperCase(), at).fingerprintSha256).toBe(pin);
  });
  it('accepts a CRLF PEM', () => {
    expect(inspectZatcaSigningCertificate(pem.replace(/\n/g, '\r\n'), pin, at).fingerprintSha256).toBe(pin);
  });
  it('rejects a certificate from another unit', () => {
    expect(() => inspectZatcaSigningCertificate(pem, '0'.repeat(64), at)).toThrow('SIGNING_CERTIFICATE_PIN_MISMATCH');
  });
  it('rejects not-yet-valid and expired certificates with distinct errors', () => {
    expect(() => inspectZatcaSigningCertificate(pem, pin, new Date(Date.parse(cert.validFrom) - 1))).toThrow('SIGNING_CERTIFICATE_NOT_YET_VALID');
    expect(() => inspectZatcaSigningCertificate(pem, pin, new Date(Date.parse(cert.validTo) + 1))).toThrow('SIGNING_CERTIFICATE_EXPIRED');
  });
  it('accepts validity endpoints exactly', () => {
    for (const date of [cert.validFrom, cert.validTo]) expect(inspectZatcaSigningCertificate(pem, pin, new Date(date)).stage).toBe('CERTIFICATE_PREFLIGHT_ONLY');
  });
  it.each(['prime256v1', 'secp384r1'])('rejects a leaf using curve %s', (curve) => {
    const other = fixture(curve, curve);
    const otherCert = new X509Certificate(other);
    const fingerprint = createHash('sha256').update(otherCert.raw).digest('hex');
    expect(() => inspectZatcaSigningCertificate(other, fingerprint, new Date(Date.parse(otherCert.validFrom) + 1000))).toThrow('INVALID_ZATCA_KEY_CURVE');
  });
  it('rejects a CA certificate as the invoice signer', () => {
    const other = fixture('ca', 'secp256k1', true);
    const otherCert = new X509Certificate(other);
    expect(() => inspectZatcaSigningCertificate(other, createHash('sha256').update(otherCert.raw).digest('hex'), new Date(Date.parse(otherCert.validFrom) + 1000))).toThrow('SIGNING_CERTIFICATE_IS_CA');
  });
  it.each(['', 'AA==', 'not a certificate', '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----'])('rejects malformed certificate input %s', (input) => {
    expect(() => inspectZatcaSigningCertificate(input, pin, at)).toThrow('INVALID_SIGNING_CERTIFICATE');
  });
  it('rejects multiple PEM certificates and leading/trailing junk', () => {
    for (const input of [pem + pem, 'junk' + pem, pem + 'junk', 'A'.repeat(32769)]) expect(() => inspectZatcaSigningCertificate(input, pin, at)).toThrow('INVALID_SIGNING_CERTIFICATE');
  });
  it('rejects DER containing trailing bytes or noncanonical base64', () => {
    for (const input of [Buffer.concat([cert.raw, Buffer.from([0])]).toString('base64'), cert.raw.toString('base64') + '=', cert.raw.toString('base64') + '\nAA==']) expect(() => inspectZatcaSigningCertificate(input, pin, at)).toThrow('INVALID_SIGNING_CERTIFICATE');
  });
  it('rejects invalid pins and invalid evaluation times', () => {
    for (const fingerprint of ['', 'A'.repeat(63), 'g'.repeat(64)]) expect(() => inspectZatcaSigningCertificate(pem, fingerprint, at)).toThrow('INVALID_CERTIFICATE_PIN');
    expect(() => inspectZatcaSigningCertificate(pem, pin, new Date(NaN))).toThrow('INVALID_CERTIFICATE_CHECK_TIME');
  });
});
