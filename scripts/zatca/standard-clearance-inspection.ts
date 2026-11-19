import { prepareZatcaInvoiceHash } from '../../lib/zatca-xml-hash';
import { inspectSimulationCertificateDiscovery } from './simulation-certificate-discovery';
import type { XmlElement } from 'libxml2-wasm';

/** Read-only diagnostic of already saved XML. No financial values, raw XML,
 * certificate bytes, digest or taxpayer identity is returned. Expanded-content
 * equivalence is explanatory only; it never replaces canonical hash validation.
 */
export async function inspectStandardClearedDocument(xml: string, original: { xml: string; uuid: string; invoiceHash: string }) {
  const base = { stage: 'RETURNED_STANDARD_DOCUMENT_INSPECTION_ONLY', xmlParsed: false,
    canonicalInvoiceHashMatched: false, expandedContentMatched: false, uuidMatched: false,
    embeddedInvoiceHashMatched: false, stampCount: 0, signatureValueCount: 0, certificateCount: 0,
    qrCount: 0, qrCharacters: 0, stampStructurePresent: false,
    authorityCertificateDiscovery: null as ReturnType<typeof inspectSimulationCertificateDiscovery> | null,
    failureCode: 'XML_REJECTED' as string | null, authorityStampVerified: false, trustVerified: false, activationAllowed: false };
  try {
    const returnedHash = await prepareZatcaInvoiceHash(xml), originalHash = await prepareZatcaInvoiceHash(original.xml);
    const { XmlDocument, ParseOption, XmlElement, XmlText, XmlCData, XmlComment } = await import('libxml2-wasm');
    const options = { option: ParseOption.XML_PARSE_NONET | ParseOption.XML_PARSE_NO_XXE };
    const doc = XmlDocument.fromString(xml, options);
    try {
      const ns = { i: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
        cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
        cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
        ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2', ds: 'http://www.w3.org/2000/09/xmldsig#' };
      const uuid = doc.find('/i:Invoice/cbc:UUID', ns), stamps = doc.find('/i:Invoice/ext:UBLExtensions//ds:Signature', ns);
      const signatures = doc.find('/i:Invoice/ext:UBLExtensions//ds:Signature/ds:SignatureValue', ns);
      const certs = doc.find('/i:Invoice/ext:UBLExtensions//ds:Signature/ds:KeyInfo/ds:X509Data/ds:X509Certificate', ns);
      const qr = doc.find('/i:Invoice/cac:AdditionalDocumentReference[cbc:ID="QR"]/cac:Attachment/cbc:EmbeddedDocumentBinaryObject', ns);
      const references = doc.find('/i:Invoice/ext:UBLExtensions//ds:Signature/ds:SignedInfo/ds:Reference[@Id="invoiceSignedData"]/ds:DigestValue', ns);
      const checked = { ...base, xmlParsed: true, canonicalInvoiceHashMatched: returnedHash.invoiceHashBase64 === original.invoiceHash,
        uuidMatched: uuid.length === 1 && uuid[0].content === original.uuid, stampCount: stamps.length,
        signatureValueCount: signatures.length, certificateCount: certs.length, qrCount: qr.length,
        qrCharacters: qr.length === 1 ? qr[0].content.trim().length : 0,
        embeddedInvoiceHashMatched: references.length === 1 && references[0].content.trim() === original.invoiceHash };
      checked.stampStructurePresent = stamps.length === 1 && signatures.length === 1 && !!signatures[0].content.trim()
        && certs.length > 0 && certs.length <= 5 && certs.every(c => !!c.content.trim())
        && qr.length === 1 && checked.qrCharacters > 0 && checked.qrCharacters <= 700;
      if (certs.length === 1) {
        try { checked.authorityCertificateDiscovery = inspectSimulationCertificateDiscovery(Buffer.from(certs[0].content.replace(/\s/g, ''), 'base64')); }
        catch { /* Optional metadata must not replace the actual match result. */ }
      }
      const shape = (canonicalXml: string) => {
        const d = XmlDocument.fromString(canonicalXml, options); let count = 0;
        try {
          const walk = (e: XmlElement, depth: number): unknown => {
            if (++count > 4096 || depth > 64) throw Error();
            const children = []; let hasElements = false;
            for (let n = e.firstChild; n; n = n.next) if (n instanceof XmlElement) hasElements = true;
            for (let n = e.firstChild; n; n = n.next) {
              if (n instanceof XmlElement) children.push(walk(n, depth + 1));
              else if (n instanceof XmlText || n instanceof XmlCData) {
                if (!hasElements || n.content.trim()) children.push(['text', n.content]);
              } else if (!(n instanceof XmlComment)) throw Error();
            }
            const attrs = e.attrs.map(a => [a.namespaceUri, a.name, a.content]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
            return [e.namespaceUri, e.name, attrs, children];
          };
          return JSON.stringify(walk(d.root, 0));
        } finally { d.dispose(); }
      };
      try { checked.expandedContentMatched = shape(returnedHash.canonicalXml) === shape(originalHash.canonicalXml); }
      catch { /* Explanatory diagnostic only, never a hash-validation fallback. */ }
      checked.failureCode = !checked.canonicalInvoiceHashMatched ? 'CANONICAL_HASH_DIFFERENT'
        : !checked.uuidMatched ? 'UUID_DIFFERENT' : !checked.stampStructurePresent ? 'STAMP_STRUCTURE_INCOMPLETE' : null;
      return checked;
    } finally { doc.dispose(); }
  } catch { return base; }
}
