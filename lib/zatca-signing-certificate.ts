import { createHash, timingSafeEqual, X509Certificate } from 'node:crypto';

/** Certificate parsing/time/key preflight only; NOT PKIX trust or revocation validation.
 * Pin must come from the authorized EGS unit's saved onboarding certificate, never
 * from the request supplying the certificate. Real issuance still requires a trust
 * path to the configured ZATCA environment and a fresh revocation result.
 */
export function inspectZatcaSigningCertificate(
  input: string,
  expectedFingerprintSha256: string,
  at: Date = new Date(),
) {
  if (!Number.isFinite(at.getTime())) throw new Error('INVALID_CERTIFICATE_CHECK_TIME');
  if (!/^[a-fA-F0-9]{64}$/.test(expectedFingerprintSha256)) throw new Error('INVALID_CERTIFICATE_PIN');
  if (typeof input !== 'string' || input.length > 32768) throw new Error('INVALID_SIGNING_CERTIFICATE');
  const value = input.trim();
  // Accept exactly one PEM certificate or canonical base64 DER. Do not silently
  // accept the first certificate in a bundle, private keys, or trailing DER bytes.
  const pem = /^-----BEGIN CERTIFICATE-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END CERTIFICATE-----$/.exec(value);
  const base64 = pem ? pem[1].replace(/[\r\n]/g, '') : value;
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('INVALID_SIGNING_CERTIFICATE');
  const der = Buffer.from(base64, 'base64');
  if (der.toString('base64') !== base64) throw new Error('INVALID_SIGNING_CERTIFICATE');
  let certificate: X509Certificate;
  try { certificate = new X509Certificate(der); }
  catch { throw new Error('INVALID_SIGNING_CERTIFICATE'); }
  if (!der.equals(certificate.raw)) throw new Error('INVALID_SIGNING_CERTIFICATE');
  const fingerprint = createHash('sha256').update(der).digest();
  if (!timingSafeEqual(fingerprint, Buffer.from(expectedFingerprintSha256, 'hex'))) throw new Error('SIGNING_CERTIFICATE_PIN_MISMATCH');
  const validFrom = Date.parse(certificate.validFrom);
  const validTo = Date.parse(certificate.validTo);
  if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || validFrom >= validTo) throw new Error('INVALID_CERTIFICATE_VALIDITY');
  if (at.getTime() < validFrom) throw new Error('SIGNING_CERTIFICATE_NOT_YET_VALID');
  if (at.getTime() > validTo) throw new Error('SIGNING_CERTIFICATE_EXPIRED');
  if (certificate.ca) throw new Error('SIGNING_CERTIFICATE_IS_CA');
  const publicKey = certificate.publicKey;
  if (publicKey.asymmetricKeyType !== 'ec' || publicKey.asymmetricKeyDetails?.namedCurve !== 'secp256k1') throw new Error('INVALID_ZATCA_KEY_CURVE');
  if (!/^[a-fA-F0-9]+$/.test(certificate.serialNumber) || BigInt(`0x${certificate.serialNumber}`) <= BigInt(0)) throw new Error('INVALID_CERTIFICATE_SERIAL');
  return {
    stage: 'CERTIFICATE_PREFLIGHT_ONLY' as const,
    fingerprintSha256: fingerprint.toString('hex'),
    certificateDigestBase64: fingerprint.toString('base64'),
    certificateDerBase64: der.toString('base64'),
    publicKeySpki: publicKey.export({ format: 'der', type: 'spki' }),
    serialNumberDecimal: BigInt(`0x${certificate.serialNumber}`).toString(10),
    validFrom: new Date(validFrom).toISOString(),
    validTo: new Date(validTo).toISOString(),
  };
}
