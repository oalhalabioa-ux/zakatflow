import { createHash, verify, X509Certificate } from 'node:crypto';
import { vatEInvoiceDraftSchema } from '../../lib/vat-einvoice-draft';
import { inspectZatcaSigningCertificate } from '../../lib/zatca-signing-certificate';
import { ecdsaDerToXmlSignature } from '../../lib/zatca-kms-signer';
import { certificateSignatureDer } from '../../lib/zatca-phase2-qr';
import { buildUnsignedZatcaXml } from '../../lib/zatca-phase2-xml';
import { prepareZatcaInvoiceHash } from '../../lib/zatca-xml-hash';

const ds = 'http://www.w3.org/2000/09/xmldsig#', xades = 'http://uri.etsi.org/01903/v1.3.2#';
const c14n = 'http://www.w3.org/2006/12/xml-c14n11', sha256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ecdsa = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256', ubl = 'urn:oasis:names:specification:ubl:';
const hexHash = (value: string) => createHash('sha256').update(value).digest('hex');
const encodedHexHash = (value: string) => Buffer.from(hexHash(value)).toString('base64');

/** Isolated Simulation experiment following the authority's procedural signing
 * guide (invoice-hash ECDSA/DER, serialized properties, text QR tags6/7).
 * This profile is restricted to isolated QA and does not approve application issuance.
 * The separate KMS integrity receipt binds ALL emitted XML including properties;
 * it is stored privately, not embedded XMLDSig/SignedInfo compliance evidence.
 * The backend must first verify original CSR, certificate, unit and current key identity.
 */
export async function prepareSimulationProceduralDocument(input: unknown, context: unknown,
  options: { certificate: string; fingerprint: string; signingTime: Date; scopeDigest: string; purpose?: 'REPORTING' },
  sign: (bytes: Buffer) => Promise<Uint8Array>,
) {
  const draft = vatEInvoiceDraftSchema.strict().parse(input), at = new Date(options.signingTime.getTime()), scopeDigest = options.scopeDigest;
  if (draft.invoice_category !== 'SIMPLIFIED' || !/^[a-f0-9]{64}$/.test(scopeDigest)) throw Error('QA_PROCEDURAL_CONTEXT_INVALID');
  const leaf = inspectZatcaSigningCertificate(options.certificate, options.fingerprint, at);
  const cert = new X509Certificate(Buffer.from(leaf.certificateDerBase64, 'base64'));
  const issuerParts = cert.issuer.split('\n');
  if (options.purpose === 'REPORTING') {
    // Match the SDK serialization for simple DNs. Reject unfamiliar encodings.
    if (issuerParts.some(part => !/^(CN|O|OU|C|L|ST|DC)=[A-Za-z0-9 ._-]+$/.test(part)))
      throw Error('QA_PROCEDURAL_UNSUPPORTED_ISSUER');
  } else if (cert.issuer !== 'CN=eInvoicing') {
    throw Error('QA_PROCEDURAL_INTERIM_REQUIRED');
  }
  const issuer = issuerParts.reverse().join(', ');
  const unsigned = buildUnsignedZatcaXml(draft, context);
  const invoiceHash = (await prepareZatcaInvoiceHash(unsigned.xml)).invoiceHashBase64;
  const signed = async (bytes: Buffer) => {
    const snapshot = Buffer.from(bytes), signature = Buffer.from(await sign(Buffer.from(snapshot)));
    ecdsaDerToXmlSignature(signature);
    if (!verify('sha256', snapshot, cert.publicKey, signature)) throw Error('QA_PROCEDURAL_SIGNATURE_INVALID');
    return signature.toString('base64');
  };
  const invoiceSignature = await signed(Buffer.from(invoiceHash, 'base64'));
  const time = at.toISOString().slice(0, 19), certDigest = encodedHexHash(leaf.certificateDerBase64);
  const properties = (detached: boolean) => {
    const ns = detached ? ` xmlns:ds="${ds}"` : '';
    // Match the procedural guide/SDK sample's expanded subtree and indentation.
    // Legacy serialized-properties hashing is whitespace-sensitive, not C14N.
    const line = (spaces: number, value: string) => ' '.repeat(spaces) + value;
    return [`<xades:SignedProperties${detached ? ` xmlns:xades="${xades}"` : ''} Id="xadesSignedProperties">`,
      line(36, '<xades:SignedSignatureProperties>'), line(40, `<xades:SigningTime>${time}</xades:SigningTime>`),
      line(40, '<xades:SigningCertificate>'), line(44, '<xades:Cert>'), line(48, '<xades:CertDigest>'),
      line(52, `<ds:DigestMethod${ns} Algorithm="${sha256}"/>`), line(52, `<ds:DigestValue${ns}>${certDigest}</ds:DigestValue>`),
      line(48, '</xades:CertDigest>'), line(48, '<xades:IssuerSerial>'),
      line(52, `<ds:X509IssuerName${ns}>${issuer}</ds:X509IssuerName>`), line(52, `<ds:X509SerialNumber${ns}>${leaf.serialNumberDecimal}</ds:X509SerialNumber>`),
      line(48, '</xades:IssuerSerial>'), line(44, '</xades:Cert>'), line(40, '</xades:SigningCertificate>'),
      line(36, '</xades:SignedSignatureProperties>'), line(32, '</xades:SignedProperties>')].join('\n');
  };
  const transform = (value: string) => `<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>${value}</ds:XPath></ds:Transform>`;
  const transforms = ['not(//ancestor-or-self::ext:UBLExtensions)', 'not(//ancestor-or-self::cac:Signature)',
    "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])"].map(transform).join('') + `<ds:Transform Algorithm="${c14n}"/>`;
  const digest = (value: string) => `<ds:DigestMethod Algorithm="${sha256}"/><ds:DigestValue>${value}</ds:DigestValue>`;
  const refs = `<ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms>${transforms}</ds:Transforms>${digest(invoiceHash)}</ds:Reference><ds:Reference Type="${ds}SignatureProperties" URI="#xadesSignedProperties">${digest(encodedHexHash(properties(true)))}</ds:Reference>`;
  const signature = `<ds:Signature xmlns:ds="${ds}" Id="signature"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="${c14n}"/><ds:SignatureMethod Algorithm="${ecdsa}"/>${refs}</ds:SignedInfo><ds:SignatureValue>${invoiceSignature}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${leaf.certificateDerBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="${xades}" Target="signature">${properties(false)}</xades:QualifyingProperties></ds:Object></ds:Signature>`;
  const method = `${ubl}dsig:enveloped:xades`, signatureId = `${ubl}signature:Invoice`;
  const extension = `<ext:UBLExtensions xmlns:ext="${ubl}schema:xsd:CommonExtensionComponents-2"><ext:UBLExtension><ext:ExtensionURI>${method}</ext:ExtensionURI><ext:ExtensionContent><sig:UBLDocumentSignatures xmlns:sig="${ubl}schema:xsd:CommonSignatureComponents-2" xmlns:sac="${ubl}schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="${ubl}schema:xsd:SignatureBasicComponents-2"><sac:SignatureInformation><cbc:ID>${ubl}signature:1</cbc:ID><sbc:ReferencedSignatureID>${signatureId}</sbc:ReferencedSignatureID>${signature}</sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`;
  const issueTime = draft.issue_time.length === 5 ? draft.issue_time + ':00' : draft.issue_time;
  const values: Buffer[] = [draft.seller_name, draft.seller_vat_number, `${draft.issue_date}T${issueTime}`,
    unsigned.totals.tax_inclusive_amount, unsigned.totals.tax_total_amount, invoiceHash, invoiceSignature].map(v => Buffer.from(v));
  values.push(leaf.publicKeySpki, certificateSignatureDer(cert.raw));
  const qr = Buffer.concat(values.map((value, i) => {
    if (value.length > 255) throw Error('QA_PROCEDURAL_QR_TOO_LONG');
    return Buffer.concat([Buffer.from([i + 1, value.length]), value]);
  })).toString('base64');
  // Preserve the complete saved identity; reject rather than truncate it when
  // the published QR700 bound or one-byte TLV length cannot accommodate it.
  if (qr.length > 700) throw Error('QA_PROCEDURAL_QR_TOO_LONG');
  const metadata = `<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qr}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference><cac:Signature><cbc:ID>${signatureId}</cbc:ID><cbc:SignatureMethod>${method}</cbc:SignatureMethod></cac:Signature>`;
  const rootEnd = unsigned.xml.indexOf('>', unsigned.xml.indexOf('<Invoice ')) + 1;
  const xml = (unsigned.xml.slice(0, rootEnd) + extension + unsigned.xml.slice(rootEnd)).replace('<cac:AccountingSupplierParty>', metadata + '<cac:AccountingSupplierParty>');
  if ((await prepareZatcaInvoiceHash(xml)).invoiceHashBase64 !== invoiceHash) throw Error('QA_PROCEDURAL_HASH_CHANGED');
  const integrityMessage = JSON.stringify({ version: 'SIMULATION_PROCEDURAL_INTEGRITY_V1', scopeDigest,
    certificateFingerprint: leaf.fingerprintSha256, xmlSha256: hexHash(xml), invoiceHash });
  const integritySignature = await signed(Buffer.from(integrityMessage));
  return { xml, invoiceHash, invoiceSignature, integritySignature, qrCharacters: qr.length };
}
