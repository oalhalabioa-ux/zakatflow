import { verify, X509Certificate } from 'node:crypto';
import { prepareZatcaInvoiceHash } from '../../lib/zatca-xml-hash';
import { inspectSimulationCertificateDiscovery } from './simulation-certificate-discovery';
import type { XmlC14NMode, XmlElement, XmlNode } from 'libxml2-wasm';

const signatureNamespace = 'http://www.w3.org/2000/09/xmldsig#';
const exclusiveNamespace = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const canonicalModes = {
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315': [0, false],
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315#WithComments': [0, true],
  [exclusiveNamespace]: [1, false],
  [exclusiveNamespace + 'WithComments']: [1, true],
  'http://www.w3.org/2006/12/xml-c14n11': [2, false],
  'http://www.w3.org/2006/12/xml-c14n11#WithComments': [2, true],
} satisfies Record<string, [typeof XmlC14NMode[keyof typeof XmlC14NMode], boolean]>;

function decodeXmlBase64(value: string, maxCharacters: number) {
  if (value.length > maxCharacters) return null;
  const clean = value.replace(/[ \t\r\n]/g, '');
  if (!clean) return null;
  const bytes = Buffer.from(clean, 'base64');
  return bytes.toString('base64') === clean ? bytes : null;
}

/** Report comparisons only. Never expose QR contents or use them to grant trust. */
function inspectQr(payload: string, signatureValue: string, returnedHash: string, submittedHash: string) {
  const bytes = decodeXmlBase64(payload, 700);
  if (!bytes) return null;
  const tags = new Map<number, Buffer>();
  for (let offset = 0; offset < bytes.length;) {
    if (bytes.length - offset < 2) return null;
    const tag = bytes[offset++];
    const size = bytes[offset++];
    if (!tag || !size || tags.has(tag) || offset + size > bytes.length) return null;
    tags.set(tag, bytes.subarray(offset, offset + size));
    offset += size;
  }

  const compare = (value: Buffer | undefined, expected: Buffer | null) => {
    if (!value) return 'MISSING' as const;
    if (!expected) return 'UNAVAILABLE' as const;
    if (value.equals(expected)) return 'BINARY_MATCH' as const;
    if (value.equals(Buffer.from(expected.toString('base64'), 'ascii'))) return 'BASE64_TEXT_MATCH' as const;
    return 'MISMATCH' as const;
  };
  return {
    tag6ReturnedHash: compare(tags.get(6), decodeXmlBase64(returnedHash, 64)),
    tag6SubmittedHash: compare(tags.get(6), decodeXmlBase64(submittedHash, 64)),
    tag7XmlSignature: compare(tags.get(7), decodeXmlBase64(signatureValue, 4096)),
  };
}

function inspectStamp(signature: XmlNode, certificateNodes: XmlNode[], originalHash: string, returnedHash: string) {
  const ns = { ds: signatureNamespace, ec: exclusiveNamespace };
  const signedInfo = signature.find('./ds:SignedInfo', ns);
  const references = signature.find('./ds:SignedInfo/ds:Reference', ns);
  const documentReferences = signature.find('./ds:SignedInfo/ds:Reference[@URI=""]', ns);
  const namedReferences = signature.find('./ds:SignedInfo/ds:Reference[@Id="invoiceSignedData"]', ns);
  const info = {
    referenceCount: references.length,
    emptyUriReferenceCount: documentReferences.length,
    namedInvoiceReferenceCount: namedReferences.length,
    selectedReference: 'UNAVAILABLE' as 'UNAVAILABLE' | 'EMPTY_URI' | 'NAMED_INVOICE',
    declaredDigest: 'UNAVAILABLE' as 'UNAVAILABLE' | 'SHA256' | 'UNSUPPORTED',
    referenceMatchesSubmittedHash: false,
    referenceMatchesReturnedHash: false,
    signatureMethod: 'UNAVAILABLE' as 'UNAVAILABLE' | 'ECDSA_SHA256' | 'RSA_SHA256' | 'UNSUPPORTED',
    canonicalSignedInfoSignature: 'NOT_CHECKED' as 'NOT_CHECKED' | 'MATCHED' | 'MISMATCHED',
    signedInfoMatchesXmlDsigEncoding: false,
    invoiceDigestSignatureMatches: false,
    matchingEmbeddedKeyCount: 0,
  };
  if (signedInfo.length !== 1) return info;
  const reference = documentReferences.length === 1 && (namedReferences.length === 0 || namedReferences.length === 1 && documentReferences[0].find('./@Id[.="invoiceSignedData"]', ns).length === 1)
    ? documentReferences[0]
    : documentReferences.length === 0 && namedReferences.length === 1 && !namedReferences[0].find('./@URI', ns).length ? namedReferences[0] : null;
  let digest: Buffer | null = null;
  if (reference) {
    info.selectedReference = documentReferences.length ? 'EMPTY_URI' : 'NAMED_INVOICE';
    const method = reference.find('./ds:DigestMethod/@Algorithm', ns);
    const digests = reference.find('./ds:DigestValue[not(*)]', ns);
    if (method.length === 1) info.declaredDigest = method[0].content === 'http://www.w3.org/2001/04/xmlenc#sha256' ? 'SHA256' : 'UNSUPPORTED';
    const candidate = digests.length === 1 && info.declaredDigest === 'SHA256' ? decodeXmlBase64(digests[0].content, 256) : null;
    if (candidate?.length === 32) {
      digest = candidate;
      info.referenceMatchesSubmittedHash = digest.toString('base64') === originalHash;
      info.referenceMatchesReturnedHash = digest.toString('base64') === returnedHash;
    }
  }

  const methods = signature.find('./ds:SignedInfo/ds:SignatureMethod[not(*)]/@Algorithm', ns);
  const algorithm = methods.length === 1 ? methods[0].content : '';
  const methodPrefix = 'http://www.w3.org/2001/04/xmldsig-more#';
  if (!algorithm) return info;
  info.signatureMethod = algorithm === methodPrefix + 'ecdsa-sha256' ? 'ECDSA_SHA256'
    : algorithm === methodPrefix + 'rsa-sha256' ? 'RSA_SHA256' : 'UNSUPPORTED';
  if (info.signatureMethod === 'UNSUPPORTED') return info;

  const values = signature.find('./ds:SignatureValue[not(*)]', ns);
  const value = values.length === 1 ? decodeXmlBase64(values[0].content, 4096) : null;
  if (!value || certificateNodes.length < 1 || certificateNodes.length > 5) return info;

  const canonicalization = signedInfo[0].find('./ds:CanonicalizationMethod', ns);
  const canonAlgorithm = signedInfo[0].find('./ds:CanonicalizationMethod/@Algorithm', ns);
  const canon = canonAlgorithm.length === 1 ? canonAlgorithm[0].content : '';
  const mode = Object.hasOwn(canonicalModes, canon) ? canonicalModes[canon as keyof typeof canonicalModes] : undefined;
  let signedBytes: Buffer | null = null;
  if (canonicalization.length === 1 && mode) {
    const children = canonicalization[0].find('./*', ns);
    const prefixList = canonicalization[0].find('./ec:InclusiveNamespaces/@PrefixList', ns);
    const prefixes = prefixList.length === 1 ? prefixList[0].content.trim().split(/\s+/).filter(Boolean) : [];
    if (!children.length || (mode[0] === 1 && children.length === 1 && prefixList.length === 1
        && prefixes.length <= 32 && prefixes.every(p => /^(?:#default|[A-Za-z_][\w.-]{0,63})$/.test(p)))) {
      signedBytes = Buffer.from(signedInfo[0].canonicalizeToString({
        mode: mode[0], withComments: mode[1], inclusiveNamespacePrefixes: prefixes,
      }));
    }
  }
  const testedKeys = new Set<string>();
  for (const node of certificateNodes) {
    const der = node.find('./*', ns).length ? null : decodeXmlBase64(node.content, 24576);
    if (!der) continue;
    try {
      const certificate = new X509Certificate(der);
      if (!certificate.raw.equals(der)) continue;
      const key = certificate.publicKey;
      const ec = info.signatureMethod === 'ECDSA_SHA256';
      if (key.asymmetricKeyType !== (ec ? 'ec' : 'rsa')) continue;
      const spki = key.export({ type: 'spki', format: 'der' }).toString('base64');
      if (testedKeys.has(spki)) continue;
      testedKeys.add(spki);
      const check = (bytes: Buffer, dsaEncoding: 'der' | 'ieee-p1363') => {
        try { return verify('sha256', bytes, { key, dsaEncoding }, value); }
        catch { return false; }
      };
      const xmlEncoding = signedBytes && (ec ? check(signedBytes, 'ieee-p1363') : check(signedBytes, 'der'));
      if (signedBytes && info.canonicalSignedInfoSignature === 'NOT_CHECKED') info.canonicalSignedInfoSignature = 'MISMATCHED';
      if (xmlEncoding || ec && signedBytes && check(signedBytes, 'der')) {
        info.canonicalSignedInfoSignature = 'MATCHED';
        info.signedInfoMatchesXmlDsigEncoding ||= Boolean(xmlEncoding);
        info.matchingEmbeddedKeyCount++;
      }
      if (digest && (check(digest, 'der') || ec && check(digest, 'ieee-p1363'))) info.invoiceDigestSignatureMatches = true;
    } catch { /* Malformed certificate or unsupported public key, no values returned. */ }
  }
  return info;
}

/** Read-only diagnostic of already saved XML. No financial values, raw XML,
 * certificate bytes, digest or taxpayer identity is returned. Expanded-content
 * equivalence is explanatory only; it never replaces canonical hash validation.
 */
export async function inspectStandardClearedDocument(xml: string, original: { xml: string; uuid: string; invoiceHash: string }) {
  const base = { stage: 'RETURNED_STANDARD_DOCUMENT_INSPECTION_ONLY', xmlParsed: false,
    canonicalInvoiceHashMatched: false, expandedContentMatched: false, uuidMatched: false,
    embeddedInvoiceHashMatched: false, stampCount: 0, signatureValueCount: 0, certificateCount: 0,
    qrCount: 0, qrCharacters: 0, stampStructurePresent: false,
    qrBinding: null as ReturnType<typeof inspectQr>,
    stampCryptography: null as ReturnType<typeof inspectStamp> | null,
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
        ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2', ds: signatureNamespace };
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
      if (qr.length === 1 && signatures.length === 1 && stamps.length === 1) {
        checked.qrBinding = inspectQr(qr[0].content.trim(), signatures[0].content,
          returnedHash.invoiceHashBase64, original.invoiceHash);
      }
      if (stamps.length === 1) {
        try { checked.stampCryptography = inspectStamp(stamps[0], certs, original.invoiceHash, returnedHash.invoiceHashBase64); }
        catch { /* Keep the independent document/structure checks available. */ }
      }
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
