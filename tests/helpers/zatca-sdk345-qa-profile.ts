import { createHash, verify, X509Certificate } from 'node:crypto';
import { vatEInvoiceDraftSchema } from '../../lib/vat-einvoice-draft';
import { ecdsaDerToXmlSignature } from '../../lib/zatca-kms-signer';
import { certificateSignatureDer } from '../../lib/zatca-phase2-qr';
import { buildUnsignedZatcaXml } from '../../lib/zatca-phase2-xml';
import { inspectZatcaSigningCertificate } from '../../lib/zatca-signing-certificate';
import { prepareZatcaInvoiceHash } from '../../lib/zatca-xml-hash';

const ds = 'http://www.w3.org/2000/09/xmldsig#';
const xades = 'http://uri.etsi.org/01903/v1.3.2#';
const c14n = 'http://www.w3.org/2006/12/xml-c14n11';
const sha256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ecdsa = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256';
const ubl = 'urn:oasis:names:specification:ubl:';
const hashAsHexText = (text: string) =>
  Buffer.from(createHash('sha256').update(text, 'utf8').digest('hex'), 'ascii').toString('base64');

function fixtureIssuer(certificate: X509Certificate) {
  // This probe handles only simple fixture DNs, where Node and the SDK can
  // represent the same issuer without escaping, OID mapping or multi-valued RDNs.
  const parts = certificate.issuer.split('\n');
  if (!parts.length || parts.some(part => !/^(CN|O|OU|C|L|ST)=[A-Za-z0-9 ._-]+$/.test(part))) {
    throw new Error('QA_UNSUPPORTED_ISSUER_NAME');
  }
  return parts.reverse().join(', ');
}

function signatureProperties(at: string, certDigest: string, issuer: string, serial: string, detached: boolean) {
  const ns = detached ? ` xmlns:ds="${ds}"` : '';
  // The Java 3.4.5 verifier hashes the serialized detached subtree (including
  // whitespace and namespace declarations), not canonical XML.
  return [
    `<xades:SignedProperties${detached ? ` xmlns:xades="${xades}"` : ''} Id="xadesSignedProperties">`,
    '  <xades:SignedSignatureProperties>',
    `    <xades:SigningTime>${at}</xades:SigningTime>`,
    '    <xades:SigningCertificate><xades:Cert>',
    `      <xades:CertDigest><ds:DigestMethod${ns} Algorithm="${sha256}"/><ds:DigestValue${ns}>${certDigest}</ds:DigestValue></xades:CertDigest>`,
    `      <xades:IssuerSerial><ds:X509IssuerName${ns}>${issuer}</ds:X509IssuerName><ds:X509SerialNumber${ns}>${serial}</ds:X509SerialNumber></xades:IssuerSerial>`,
    '    </xades:Cert></xades:SigningCertificate>',
    '  </xades:SignedSignatureProperties>',
    '</xades:SignedProperties>',
  ].join('\n');
}

/** Synthetic compatibility probe for Java SDK 3.4.5 only.
 * This shape deliberately differs from the ETSI-oriented XAdES preparer.
 * Never use it for live issuance, tenant credentials or arbitrary input XML.
 * The callback signs the 32 decoded invoice-hash bytes with SHA-256/ECDSA
 * and returns ASN.1 DER. Pin and local verification do not establish CA trust.
 */
export async function prepareZatcaSdk345QaDocument(
  input: unknown,
  context: unknown,
  fixture: { certificate: string; fingerprintSha256: string; signingTime: Date },
  signInvoiceHash: (hash: Buffer) => Promise<Uint8Array>,
) {
  const draft = vatEInvoiceDraftSchema.strict().parse(input);
  if (draft.invoice_category !== 'SIMPLIFIED' || draft.seller_vat_number !== '399999999900003') {
    throw new Error('QA_DUMMY_SIMPLIFIED_DOCUMENT_REQUIRED');
  }
  const at = new Date(fixture.signingTime.getTime());
  const leaf = inspectZatcaSigningCertificate(fixture.certificate, fixture.fingerprintSha256, at);
  const cert = new X509Certificate(Buffer.from(leaf.certificateDerBase64, 'base64'));
  const issuer = fixtureIssuer(cert);
  const issuerSignature = certificateSignatureDer(cert.raw);
  const unsigned = buildUnsignedZatcaXml(draft, context);
  const { invoiceHashBase64 } = await prepareZatcaInvoiceHash(unsigned.xml);
  const hash = Buffer.from(invoiceHashBase64, 'base64');
  const signature = Buffer.from(await signInvoiceHash(Buffer.from(hash)));
  ecdsaDerToXmlSignature(signature); // Enforce canonical, bounded ASN.1 DER.
  if (!verify('sha256', hash, cert.publicKey, signature)) throw new Error('QA_SDK_SIGNATURE_KEY_MISMATCH');
  const signatureBase64 = signature.toString('base64');
  const certDigest = hashAsHexText(leaf.certificateDerBase64);
  const stampTime = at.toISOString().slice(0, 19);
  const serial = leaf.serialNumberDecimal;
  const propDigest = hashAsHexText(signatureProperties(stampTime, certDigest, issuer, serial, true));
  const props = signatureProperties(stampTime, certDigest, issuer, serial, false);

  const transform = (xpath: string) => `<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>${xpath}</ds:XPath></ds:Transform>`;
  const transforms = [
    'not(//ancestor-or-self::ext:UBLExtensions)',
    'not(//ancestor-or-self::cac:Signature)',
    "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])",
  ].map(transform).join('') + `<ds:Transform Algorithm="${c14n}"/>`;
  const digest = (value: string) => `<ds:DigestMethod Algorithm="${sha256}"/><ds:DigestValue>${value}</ds:DigestValue>`;
  const refs = `<ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms>${transforms}</ds:Transforms>${digest(invoiceHashBase64)}</ds:Reference><ds:Reference Type="${ds}SignatureProperties" URI="#xadesSignedProperties">${digest(propDigest)}</ds:Reference>`;
  const signatureXml = `<ds:Signature xmlns:ds="${ds}" Id="signature"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="${c14n}"/><ds:SignatureMethod Algorithm="${ecdsa}"/>${refs}</ds:SignedInfo><ds:SignatureValue>${signatureBase64}</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${leaf.certificateDerBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="${xades}" Target="signature">${props}</xades:QualifyingProperties></ds:Object></ds:Signature>`;
  const signatureId = `${ubl}signature:Invoice`;
  const signatureMethod = `${ubl}dsig:enveloped:xades`;
  // Keep these namespace declarations inside the excluded subtree to preserve the invoice hash.
  const extension = `<ext:UBLExtensions xmlns:ext="${ubl}schema:xsd:CommonExtensionComponents-2"><ext:UBLExtension><ext:ExtensionURI>${signatureMethod}</ext:ExtensionURI><ext:ExtensionContent><sig:UBLDocumentSignatures xmlns:sig="${ubl}schema:xsd:CommonSignatureComponents-2" xmlns:sac="${ubl}schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="${ubl}schema:xsd:SignatureBasicComponents-2"><sac:SignatureInformation><cbc:ID>${ubl}signature:1</cbc:ID><sbc:ReferencedSignatureID>${signatureId}</sbc:ReferencedSignatureID>${signatureXml}</sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`;

  const issueTime = draft.issue_time.length === 5 ? draft.issue_time + ':00' : draft.issue_time;
  const textFields = [draft.seller_name, draft.seller_vat_number, `${draft.issue_date}T${issueTime}`,
    unsigned.totals.tax_inclusive_amount, unsigned.totals.tax_total_amount, invoiceHashBase64, signatureBase64];
  const qrPayload = Buffer.concat([...textFields.map(value => Buffer.from(value, 'utf8')), leaf.publicKeySpki, issuerSignature]
    .map((bytes, i) => {
      if (bytes.length > 255) throw new Error('QA_QR_FIELD_TOO_LONG');
      return Buffer.concat([Buffer.from([i + 1, bytes.length]), bytes]);
    })).toString('base64');
  if (qrPayload.length > 700) throw new Error('QA_QR_PAYLOAD_TOO_LONG');
  const qr = `<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qrPayload}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`;
  const marker = `<cac:Signature><cbc:ID>${signatureId}</cbc:ID><cbc:SignatureMethod>${signatureMethod}</cbc:SignatureMethod></cac:Signature>`;
  const rootEnd = unsigned.xml.indexOf('>', unsigned.xml.indexOf('<Invoice ')) + 1;
  const xml = (unsigned.xml.slice(0, rootEnd) + extension + unsigned.xml.slice(rootEnd))
    .replace('<cac:AccountingSupplierParty>', qr + marker + '<cac:AccountingSupplierParty>');
  if ((await prepareZatcaInvoiceHash(xml)).invoiceHashBase64 !== invoiceHashBase64) throw new Error('QA_SDK_INVOICE_HASH_CHANGED');
  return { xml, invoiceHashBase64, uuid: unsigned.invoiceUuid, qrPayload, stage: 'SDK_345_SYNTHETIC_QA_ONLY' as const };
}
