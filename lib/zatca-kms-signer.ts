import { GetPublicKeyCommand, SignCommand, type KMSClient } from '@aws-sdk/client-kms';
import { createHash, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

/** Convert KMS ASN.1 DER ECDSA to XMLDSig's fixed-width r || s representation. */
export function ecdsaDerToXmlSignature(signature: Uint8Array): Buffer {
  const der = Buffer.from(signature);
  const invalid = () => new Error('INVALID_ECDSA_DER_SIGNATURE');
  if (der.length < 8 || der.length > 72 || der[0] !== 0x30 || der[1] !== der.length - 2) throw invalid();
  let offset = 2;
  const integer = () => {
    if (der[offset++] !== 0x02) throw invalid();
    const length = der[offset++];
    if (!length || length > 33 || offset + length > der.length) throw invalid();
    let bytes = der.subarray(offset, offset + length);
    offset += length;
    if (bytes[0] & 0x80) throw invalid();
    if (bytes[0] === 0 && bytes.length > 1) {
      if (!(bytes[1] & 0x80)) throw invalid();
      bytes = bytes.subarray(1);
    }
    if (bytes.length > 32 || bytes.every((byte) => byte === 0)) throw invalid();
    const padded = Buffer.alloc(32);
    bytes.copy(padded, 32 - bytes.length);
    return padded;
  };
  const result = Buffer.concat([integer(), integer()]);
  if (offset !== der.length) throw invalid();
  return result;
}

/** Internal server primitive, not an HTTP endpoint or an invoice issuance operation.
 * Caller must authorize the tenant/unit and extract expectedPublicKeySpki from its
 * validated certificate. Caller supplies canonical SignedInfo bytes, not invoice XML.
 * Certificate trust/expiry, canonicalization, references and XAdES remain upstream.
 */
export async function createZatcaKmsSigner(
  client: Pick<KMSClient, 'send'>,
  keyArn: string,
  expectedPublicKeySpki: Uint8Array,
) {
  if (!/^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[0-9a-f-]{36}$/.test(keyArn)) throw new Error('INVALID_KMS_KEY_ARN');
  const expected = createPublicKey({ key: Buffer.from(expectedPublicKeySpki), format: 'der', type: 'spki' });
  if (expected.asymmetricKeyType !== 'ec' || expected.asymmetricKeyDetails?.namedCurve !== 'secp256k1') throw new Error('INVALID_ZATCA_KEY_CURVE');
  const key = await client.send(new GetPublicKeyCommand({ KeyId: keyArn }));
  if (key.KeyId !== keyArn || key.KeySpec !== 'ECC_SECG_P256K1' || key.KeyUsage !== 'SIGN_VERIFY'
      || !key.SigningAlgorithms?.includes('ECDSA_SHA_256') || !key.PublicKey) throw new Error('INVALID_KMS_SIGNING_KEY');
  const actual = createPublicKey({ key: Buffer.from(key.PublicKey), format: 'der', type: 'spki' });
  const expectedDer = expected.export({ type: 'spki', format: 'der' });
  const actualDer = actual.export({ type: 'spki', format: 'der' });
  if (expectedDer.length !== actualDer.length || !timingSafeEqual(expectedDer, actualDer)) throw new Error('KMS_CERTIFICATE_KEY_MISMATCH');

  return {
    async signCanonicalSignedInfo(canonicalSignedInfo: Uint8Array) {
      // Copy before awaiting transport, so callers cannot mutate bytes mid-signature.
      const bytes = Buffer.from(canonicalSignedInfo);
      if (!bytes.length || bytes.length > 1024 * 1024) throw new Error('INVALID_SIGNED_INFO_SIZE');
      const digest = createHash('sha256').update(bytes).digest();
      const result = await client.send(new SignCommand({
        KeyId: keyArn, Message: digest, MessageType: 'DIGEST', SigningAlgorithm: 'ECDSA_SHA_256',
      }));
      if (result.KeyId !== keyArn || result.SigningAlgorithm !== 'ECDSA_SHA_256' || !result.Signature) throw new Error('INVALID_KMS_SIGNATURE_RESPONSE');
      const der = Buffer.from(result.Signature);
      const xmlSignature = ecdsaDerToXmlSignature(der);
      if (!verify('sha256', bytes, expected, der)) throw new Error('KMS_SIGNATURE_VERIFICATION_FAILED');
      return { signatureValue: xmlSignature.toString('base64'), algorithm: 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256' as const };
    },
  };
}
