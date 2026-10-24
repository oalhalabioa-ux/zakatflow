import { X509Certificate } from 'node:crypto';
import { z } from 'zod';
import { ecdsaDerToXmlSignature } from './zatca-kms-signer';

const fields = z.object({
  sellerName: z.string().trim().min(1).max(200),
  sellerVatNumber: z.string().regex(/^3\d{13}3$/),
  timestamp: z.iso.datetime({ offset: true }),
  totalWithVat: z.string().max(30).regex(/^(0|[1-9]\d*)\.\d{2}$/),
  vatTotal: z.string().max(30).regex(/^(0|[1-9]\d*)\.\d{2}$/),
}).strict();
export type SimplifiedQrTextFields = z.infer<typeof fields>;

/** Extract the certificate's outer signature BIT STRING; not a trust check.
 * X509Certificate validates the encoding first. All DER lengths are bounded and
 * canonical; certificate signature is ECDSA DER, not the XMLDSig r||s value.
 */
export function certificateSignatureDer(certificateDer: Uint8Array): Buffer {
  const bytes = Buffer.from(certificateDer);
  if (!bytes.length || bytes.length > 32768) throw new Error('INVALID_QR_CERTIFICATE');
  try { if (!new X509Certificate(bytes).raw.equals(bytes)) throw new Error(); }
  catch { throw new Error('INVALID_QR_CERTIFICATE'); }
  const node = (offset: number, tag: number) => {
    if (bytes[offset++] !== tag || offset >= bytes.length) throw new Error('INVALID_QR_CERTIFICATE');
    let length = bytes[offset++];
    if (length & 0x80) {
      const count = length & 0x7f;
      if (!count || count > 4 || offset + count > bytes.length || !bytes[offset]) throw new Error('INVALID_QR_CERTIFICATE');
      length = 0;
      for (let i = 0; i < count; i++) length = length * 256 + bytes[offset++];
      if (length < 128) throw new Error('INVALID_QR_CERTIFICATE');
    }
    if (offset + length > bytes.length) throw new Error('INVALID_QR_CERTIFICATE');
    return { start: offset, end: offset + length };
  };
  const root = node(0, 0x30);
  const tbs = node(root.start, 0x30);
  const algorithm = node(tbs.end, 0x30);
  const signature = node(algorithm.end, 0x03);
  if (root.end !== bytes.length || signature.end !== root.end || bytes[signature.start] !== 0) throw new Error('INVALID_QR_CERTIFICATE');
  const der = bytes.subarray(signature.start + 1, signature.end);
  ecdsaDerToXmlSignature(der); // Reject unsupported/noncanonical certificate signature encodings.
  return Buffer.from(der);
}

/** Simplified documents only. Nine TLV fields, raw binary for tags 6-9, then
 * base64 once. Cryptographic inputs must come from the same verified XML/unit.
 * This is preparation, not certificate trust, SDK approval or authority acceptance.
 * SPKI/SignatureValue/certificate-signature interoperability remains an SDK gate.
 */
export function prepareSimplifiedPhaseTwoQr(
  text: SimplifiedQrTextFields,
  crypto: { invoiceHash: Uint8Array; xmlSignature: Uint8Array; certificateDer: Uint8Array },
) {
  const input = fields.parse(text);
  if (BigInt(input.vatTotal.replace('.', '')) > BigInt(input.totalWithVat.replace('.', ''))) throw new Error('QR_AMOUNT_INCONSISTENT');
  const hash = Buffer.from(crypto.invoiceHash), signature = Buffer.from(crypto.xmlSignature);
  if (hash.length !== 32 || signature.length !== 64) throw new Error('INVALID_QR_CRYPTO_LENGTH');
  const der = Buffer.from(crypto.certificateDer);
  const caSignature = certificateSignatureDer(der);
  const publicKey = new X509Certificate(der).publicKey;
  if (publicKey.asymmetricKeyType !== 'ec' || publicKey.asymmetricKeyDetails?.namedCurve !== 'secp256k1') throw new Error('INVALID_ZATCA_KEY_CURVE');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const values: Buffer[] = [input.sellerName, input.sellerVatNumber, input.timestamp, input.totalWithVat, input.vatTotal].map(v => Buffer.from(v, 'utf8'));
  values.push(hash, signature, spki, caSignature);
  const payload = Buffer.concat(values.map((value, index) => {
    if (value.length > 255) throw new Error('QR_FIELD_TOO_LONG');
    return Buffer.concat([Buffer.from([index + 1, value.length]), value]);
  })).toString('base64');
  if (payload.length > 700) throw new Error('QR_PAYLOAD_TOO_LONG');
  return { payload, stage: 'QR_PREPARATION_ONLY' as const };
}
