import { createHash, createPublicKey, verify, X509Certificate } from 'node:crypto';
import { buildUnsignedZatcaXml } from './zatca-phase2-xml';
import { inspectZatcaSigningCertificate } from './zatca-signing-certificate';
import { prepareZatcaInvoiceHash } from './zatca-xml-hash';

const ds = 'http://www.w3.org/2000/09/xmldsig#';
const c14n = 'http://www.w3.org/2006/12/xml-c14n11';
const sha256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ecdsa = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256';
const xades = 'http://uri.etsi.org/01903/v1.3.2#';
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('base64');
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));

export interface XadesPreparationOptions {
  certificate: string;
  expectedFingerprintSha256: string;
  /** Ordered issuer certificates through root, canonical base64 DER, no leaf. */
  issuerChainDerBase64: string[];
  /** Trusted server clock in a future live integration; supplied explicitly for tests. */
  signingTime: Date;
  /** Approved configuration, not invented defaults or user-request policy values. */
  policy: { identifier: string; digestSha256Base64: string };
}
export type XadesPreparationSigner = (canonicalSignedInfo: Uint8Array) => Promise<{ signatureValue: string; algorithm: string }>;

async function canonicalElement(xml: string, xpath: string) {
  const { XmlDocument, XmlC14NMode, ParseOption } = await import('libxml2-wasm');
  const doc = XmlDocument.fromString(xml, { option: ParseOption.XML_PARSE_NONET | ParseOption.XML_PARSE_NO_XXE });
  try {
    const nodes = doc.find(xpath, { ds, xades });
    if (nodes.length !== 1) throw new Error('XADES_ELEMENT_AMBIGUOUS');
    return nodes[0].canonicalizeToString({ mode: XmlC14NMode.XML_C14N_1_1, withComments: false });
  } finally { doc.dispose(); }
}

/** Internal cryptographic preparation ONLY. Never submit or mark as issued.
 * Chain linkage checks below are NOT full PKIX/profile/identity/revocation checks
 * and the supplied policy/root is NOT a trust decision. No production caller.
 * No QR, chain allocation, financial write or authority request is performed.
 */
export async function prepareSignedZatcaXml(
  draft: unknown, context: unknown, options: XadesPreparationOptions, sign: XadesPreparationSigner,
) {
  const at = new Date(options.signingTime.getTime());
  const leaf = inspectZatcaSigningCertificate(options.certificate, options.expectedFingerprintSha256, at);
  const policy = { ...options.policy };
  if (!/^https:\/\/[^\s<>"'\u0000-\u001f]+$/.test(policy.identifier) || policy.identifier.length > 2048
      || Buffer.from(policy.digestSha256Base64, 'base64').length !== 32
      || Buffer.from(policy.digestSha256Base64, 'base64').toString('base64') !== policy.digestSha256Base64) throw new Error('INVALID_SIGNATURE_POLICY');
  if (!Array.isArray(options.issuerChainDerBase64) || !options.issuerChainDerBase64.length || options.issuerChainDerBase64.length > 5) throw new Error('CERTIFICATE_CHAIN_REQUIRED');
  const certificates = [leaf.certificateDerBase64, ...options.issuerChainDerBase64];
  const seen = new Set<string>([leaf.fingerprintSha256]);
  let child = new X509Certificate(Buffer.from(leaf.certificateDerBase64, 'base64'));
  for (const encoded of certificates.slice(1)) {
    if (typeof encoded !== 'string' || encoded.length > 32768) throw new Error('INVALID_CERTIFICATE_CHAIN');
    const der = Buffer.from(encoded, 'base64');
    let issuer: X509Certificate;
    try { issuer = new X509Certificate(der); } catch { throw new Error('INVALID_CERTIFICATE_CHAIN'); }
    const fingerprint = createHash('sha256').update(der).digest('hex');
    const from = Date.parse(issuer.validFrom), to = Date.parse(issuer.validTo);
    if (der.toString('base64') !== encoded || !der.equals(issuer.raw) || seen.has(fingerprint)
        || !issuer.ca || !Number.isFinite(from) || !Number.isFinite(to) || from >= to || at.getTime() < from || at.getTime() > to
        || !child.checkIssued(issuer) || !child.verify(issuer.publicKey)) throw new Error('INVALID_CERTIFICATE_CHAIN');
    seen.add(fingerprint);
    child = issuer;
  }
  if (!child.checkIssued(child) || !child.verify(child.publicKey)) throw new Error('CERTIFICATE_CHAIN_ROOT_REQUIRED');
  const prepared = buildUnsignedZatcaXml(draft, context);
  const invoiceHash = (await prepareZatcaInvoiceHash(prepared.xml)).invoiceHashBase64;
  const transform = (xpath: string) => `<ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116"><ds:XPath>${xpath}</ds:XPath></ds:Transform>`;
  const hashElement = (value: string) => `<ds:DigestMethod Algorithm="${sha256}"/><ds:DigestValue>${value}</ds:DigestValue>`;
  const signedInfo = (propertiesHash: string) => `<ds:SignedInfo><ds:CanonicalizationMethod Algorithm="${c14n}"/><ds:SignatureMethod Algorithm="${ecdsa}"/><ds:Reference Id="invoiceSignedData" URI=""><ds:Transforms>${transform('not(ancestor-or-self::ext:UBLExtensions)')}${transform('not(ancestor-or-self::cac:Signature)')}${transform("not(ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])")}<ds:Transform Algorithm="${c14n}"/></ds:Transforms>${hashElement(invoiceHash)}</ds:Reference><ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#xadesSignedProperties"><ds:Transforms><ds:Transform Algorithm="${c14n}"/></ds:Transforms>${hashElement(propertiesHash)}</ds:Reference></ds:SignedInfo>`;
  const properties = `<xades:SignedProperties Id="xadesSignedProperties"><xades:SignedSignatureProperties><xades:SigningTime>${at.toISOString().replace('.000Z', 'Z')}</xades:SigningTime><xades:SigningCertificateV2>${certificates.map(encoded => `<xades:Cert><xades:CertDigest>${hashElement(digest(Buffer.from(encoded, 'base64')))}</xades:CertDigest></xades:Cert>`).join('')}</xades:SigningCertificateV2><xades:SignaturePolicyIdentifier><xades:SignaturePolicyId><xades:SigPolicyId><xades:Identifier>${escape(policy.identifier)}</xades:Identifier></xades:SigPolicyId><xades:SigPolicyHash>${hashElement(policy.digestSha256Base64)}</xades:SigPolicyHash></xades:SignaturePolicyId></xades:SignaturePolicyIdentifier></xades:SignedSignatureProperties><xades:SignedDataObjectProperties><xades:DataObjectFormat ObjectReference="#invoiceSignedData"><xades:MimeType>text/xml</xades:MimeType></xades:DataObjectFormat></xades:SignedDataObjectProperties></xades:SignedProperties>`;
  const envelope = (propertiesHash: string, signature: string) => `<ext:UBLExtensions xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtension><ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI><ext:ExtensionContent><sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2"><sac:SignatureInformation xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2"><cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID><sbc:ReferencedSignatureID xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID><ds:Signature xmlns:ds="${ds}" Id="signature">${signedInfo(propertiesHash)}<ds:SignatureValue>${signature}</ds:SignatureValue><ds:KeyInfo><ds:X509Data>${certificates.map(encoded => `<ds:X509Certificate>${encoded}</ds:X509Certificate>`).join('')}</ds:X509Data></ds:KeyInfo><ds:Object><xades:QualifyingProperties xmlns:xades="${xades}" Target="#signature">${properties}</xades:QualifyingProperties></ds:Object></ds:Signature></sac:SignatureInformation></sig:UBLDocumentSignatures></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>`;
  const metadata = '<cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID><cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod></cac:Signature>';
  // Input is created above by our strict UBL builder, not arbitrary XML. Preserve
  // root namespace declarations and all original whitespace exactly.
  const openingEnd = prepared.xml.indexOf('>', prepared.xml.indexOf('<Invoice ')) + 1;
  const assemble = (propertiesHash: string, signature: string) => (
    prepared.xml.slice(0, openingEnd) + envelope(propertiesHash, signature) + prepared.xml.slice(openingEnd)
  ).replace('<cac:AccountingSupplierParty>', metadata + '<cac:AccountingSupplierParty>');
  const propertiesHash = digest(await canonicalElement(assemble('', ''), '//xades:SignedProperties'));
  const canonicalSignedInfo = await canonicalElement(assemble(propertiesHash, ''), '//ds:SignedInfo');
  const result = await sign(Buffer.from(canonicalSignedInfo, 'utf8'));
  const signature = Buffer.from(result.signatureValue, 'base64');
  if (result.algorithm !== ecdsa || signature.length !== 64 || signature.toString('base64') !== result.signatureValue
      || !verify('sha256', Buffer.from(canonicalSignedInfo), { key: createPublicKey({ key: leaf.publicKeySpki, format: 'der', type: 'spki' }), dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('INVALID_XADES_SIGNATURE');
  const xml = assemble(propertiesHash, result.signatureValue);
  if ((await prepareZatcaInvoiceHash(xml)).invoiceHashBase64 !== invoiceHash
      || digest(await canonicalElement(xml, '//xades:SignedProperties')) !== propertiesHash
      || await canonicalElement(xml, '//ds:SignedInfo') !== canonicalSignedInfo) throw new Error('XADES_REFERENCE_CHANGED');
  return { xml, invoiceHashBase64: invoiceHash, stage: 'SIGNED_XML_PREPARATION_ONLY' as const };
}
