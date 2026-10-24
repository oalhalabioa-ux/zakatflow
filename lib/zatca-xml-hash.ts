import { createHash } from 'node:crypto';

const namespaces = {
  i: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
};

/** Hash preparation only; no invoice issuance/acceptance or financial mutations.
 * Apply the ZATCA invoice reference exclusions then Canonical XML 1.1 without
 * comments. Preserve whitespace text nodes: reformatting an invoice changes it.
 */
export async function prepareZatcaInvoiceHash(xml: string) {
  if (typeof xml !== 'string' || !xml.length || Buffer.byteLength(xml, 'utf8') > 2 * 1024 * 1024) throw new Error('INVALID_INVOICE_XML_SIZE');
  // This module accepts invoice XML, never DTDs, entity definitions or PIs. Block
  // before parsing; also disable external entities/network in the XML parser.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || /<\?/.test(xml.replace(/^\uFEFF?<\?xml\s[^?]*\?>/, ''))) throw new Error('UNSAFE_INVOICE_XML');
  const declaration = /^\uFEFF?<\?xml\s[^?]*\?>/.exec(xml)?.[0];
  if (declaration && (!/version\s*=\s*(['"])1\.0\1/.test(declaration) || /encoding\s*=\s*(['"])(?!UTF-8\1)[^'"]+\1/i.test(declaration))) throw new Error('INVALID_INVOICE_XML');
  const { XmlDocument, ParseOption, XmlC14NMode } = await import('libxml2-wasm');
  let doc;
  try { doc = XmlDocument.fromString(xml, { option: ParseOption.XML_PARSE_NONET | ParseOption.XML_PARSE_NO_XXE }); }
  catch { throw new Error('INVALID_INVOICE_XML'); }
  try {
    if (doc.dtd || doc.find('//*[contains(name(),":") and namespace-uri()=""] | //@*[contains(name(),":") and namespace-uri()=""]').length || doc.root.name !== 'Invoice' || doc.root.namespaceUri !== namespaces.i
        || doc.find('//i:Invoice', namespaces).length !== 1) throw new Error('INVALID_INVOICE_XML');
    const excluded = doc.find('//ext:UBLExtensions | //cac:Signature | //cac:AdditionalDocumentReference[cbc:ID="QR"]', namespaces);
    // Remove deeper nodes first so a malicious nested exclusion cannot leave a
    // dangling native node reference when its parent is removed.
    const depth = (node: (typeof excluded)[number]) => { let count = 0; for (let p = node.parent; p; p = p.parent) count++; return count; };
    excluded.map(node => ({ node, depth: depth(node) })).sort((a, b) => b.depth - a.depth).forEach(({ node }) => node.remove());
    const canonicalXml = doc.canonicalizeToString({ mode: XmlC14NMode.XML_C14N_1_1, withComments: false });
    return {
      stage: 'HASH_PREPARATION_ONLY' as const,
      canonicalXml,
      invoiceHashBase64: createHash('sha256').update(canonicalXml, 'utf8').digest('base64'),
    };
  } finally { doc.dispose(); }
}
