import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prepareZatcaInvoiceHash } from './zatca-xml-hash';

const ns = 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"';
const document = (content: string) => `<Invoice ${ns}>${content}</Invoice>`;

describe('ZATCA invoice reference hash preparation', () => {
  it('matches a reference vector independently checked with native xmllint C14N 1.1', async () => {
    const xml = document('<cbc:ID b="2" a="1">يقين &amp; الأعمال</cbc:ID><cbc:Note/>');
    const result = await prepareZatcaInvoiceHash(xml);
    const independent = `<Invoice ${ns}><cbc:ID a="1" b="2">يقين &amp; الأعمال</cbc:ID><cbc:Note></cbc:Note></Invoice>`;
    expect(result.canonicalXml).toBe(independent);
    expect(result.invoiceHashBase64).toBe(createHash('sha256').update(independent).digest('base64'));
    expect(result.canonicalXml).toContain('<cbc:Note></cbc:Note>');
  });
  it('excludes extension, signature and QR trees but keeps ICV and PIH', async () => {
    const content = '<cbc:ID>one</cbc:ID><cac:AdditionalDocumentReference><cbc:ID>ICV</cbc:ID><cbc:UUID>9</cbc:UUID></cac:AdditionalDocumentReference><cac:AdditionalDocumentReference><cbc:ID>PIH</cbc:ID><cbc:UUID>previous</cbc:UUID></cac:AdditionalDocumentReference>';
    const unsigned = await prepareZatcaInvoiceHash(document(content));
    const stamped = await prepareZatcaInvoiceHash(document('<ext:UBLExtensions><ext:UBLExtension>signature material</ext:UBLExtension></ext:UBLExtensions>' + content + '<cac:Signature>metadata</cac:Signature><cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cbc:UUID>qr data</cbc:UUID></cac:AdditionalDocumentReference>'));
    expect(stamped).toEqual(unsigned);
    expect(stamped.canonicalXml).toContain('previous');
    expect(stamped.canonicalXml).toContain('>9<');
  });
  it('resolves exclusions by namespace URI, not literal prefixes', async () => {
    const first = document('<ext:UBLExtensions/><cbc:ID>same</cbc:ID>');
    expect(await prepareZatcaInvoiceHash(first.replaceAll('ext:', 'e:').replace('xmlns:ext=', 'xmlns:e='))).toMatchObject({
      canonicalXml: expect.not.stringContaining('UBLExtensions'),
    });
  });
  it('does not exclude similarly named elements in unrelated namespaces', async () => {
    const xml = document('<Signature>retain</Signature><cac:AdditionalDocumentReference><cbc:ID>QR-extra</cbc:ID></cac:AdditionalDocumentReference>');
    const result = await prepareZatcaInvoiceHash(xml);
    expect(result.canonicalXml).toContain('retain');
    expect(result.canonicalXml).toContain('QR-extra');
  });
  it('preserves significant whitespace and changes hash for changed financial data', async () => {
    const first = await prepareZatcaInvoiceHash(document('<cbc:ID>100</cbc:ID>'));
    for (const content of ['<cbc:ID>101</cbc:ID>', '\n<cbc:ID>100</cbc:ID>']) expect((await prepareZatcaInvoiceHash(document(content))).invoiceHashBase64).not.toBe(first.invoiceHashBase64);
  });
  it('omits comments and normalizes CRLF through XML parsing', async () => {
    const a = await prepareZatcaInvoiceHash(document('\n<cbc:ID>same</cbc:ID>'));
    const b = await prepareZatcaInvoiceHash(document('\r\n<!-- comment --><cbc:ID>same</cbc:ID>'));
    expect(a).toEqual(b);
  });
  it('handles nested excluded elements without invalid native references', async () => {
    const xml = document('<ext:UBLExtensions><cac:Signature><cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID></cac:AdditionalDocumentReference></cac:Signature></ext:UBLExtensions><cbc:ID>one</cbc:ID>');
    expect(await prepareZatcaInvoiceHash(xml)).toEqual(await prepareZatcaInvoiceHash(document('<cbc:ID>one</cbc:ID>')));
  });
  it.each([
    '<!DOCTYPE Invoice SYSTEM "https://example.com/dtd">',
    '<!DOCTYPE Invoice [<!ENTITY x SYSTEM "file:///etc/passwd">]>',
    '<?xml-stylesheet href="https://example.com/style"?>',
  ])('rejects unsafe XML before parsing %s', async (prefix) => {
    await expect(prepareZatcaInvoiceHash(prefix + document(''))).rejects.toThrow('UNSAFE_INVOICE_XML');
  });
  it.each(['<Invoice/>', '<bad>', document('<i:Invoice xmlns:i="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>'), document('<unknown:ID/>'), document('<cbc:ID unknown:attr="x"/>'), document('&undefined;'), '<?xml version="1.1"?>' + document(''), '<?xml version="1.0" encoding="UTF-16"?>' + document('')])('rejects malformed or ambiguous invoice XML %s', async (xml) => {
    await expect(prepareZatcaInvoiceHash(xml)).rejects.toThrow('INVALID_INVOICE_XML');
  });
  it('rejects empty and excessive input', async () => {
    for (const xml of ['', 'a'.repeat(2 * 1024 * 1024 + 1)]) await expect(prepareZatcaInvoiceHash(xml)).rejects.toThrow('INVALID_INVOICE_XML_SIZE');
  });
  it('accepts the XML declaration emitted by the preparation builder', async () => {
    expect((await prepareZatcaInvoiceHash('<?xml version="1.0" encoding="UTF-8"?>' + document('<cbc:ID>one</cbc:ID>'))).stage).toBe('HASH_PREPARATION_ONLY');
  });
});
