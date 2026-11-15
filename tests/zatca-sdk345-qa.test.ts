import { createHash, generateKeyPairSync, randomUUID, sign, verify, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prepareZatcaInvoiceHash } from '../lib/zatca-xml-hash';
import { certificateSignatureDer } from '../lib/zatca-phase2-qr';
import { prepareZatcaSdk345QaDocument } from './helpers/zatca-sdk345-qa-profile';

const draft = {
  organization_id: 'a800b1c2-df4a-4a79-9b91-4a451ce2858a',
  invoice_number: 'SYNTHETIC-QA-0001', invoice_category: 'SIMPLIFIED',
  issue_date: '2026-11-15', issue_time: '12:00', seller_name: 'شركة اختبار يقين',
  seller_vat_number: '399999999900003', seller_address: 'King Fahd Road', seller_building_number: '1234',
  seller_district: 'Olaya', seller_additional_number: '5678', seller_postal_code: '12345', seller_city: 'Riyadh',
  lines: [{ item_name: 'Consulting service', quantity: 2, unit_price: 100, tax_category: 'S', tax_rate: 15 }],
};
const context = {
  invoiceCounter: '1', previousInvoiceHash: Buffer.from(createHash('sha256').update('0').digest('hex')).toString('base64'),
  supplyDate: '2026-11-15', sellerId: { scheme: 'CRN', value: '1010000000' }, paymentMeansCode: '30',
};
let dir: string;
let certificate: string, key: Buffer, cert: X509Certificate, signingTime: Date, fingerprintSha256: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'zatca-sdk345-qa-'));
  const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  openssl('req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp256k1',
    '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-days', '2', '-subj', '/C=SA/O=Yaqeen QA/CN=Synthetic QA Root',
    '-addext', 'basicConstraints=critical,CA:TRUE');
  openssl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp256k1', '-nodes',
    '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/C=SA/O=Yaqeen QA/CN=Synthetic QA EGS');
  openssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-set_serial', '99331',
    '-days', '1', '-out', 'leaf.pem');
  certificate = readFileSync(join(dir, 'leaf.pem'), 'utf8');
  key = readFileSync(join(dir, 'leaf.key'));
  cert = new X509Certificate(certificate);
  signingTime = new Date(Date.parse(cert.validFrom) + 1000);
  fingerprintSha256 = createHash('sha256').update(cert.raw).digest('hex');
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});
const fixture = () => ({ certificate, fingerprintSha256, signingTime });
const signer = async (hash: Buffer) => sign('sha256', hash, key);

describe('synthetic SDK 3.4.5 interoperability probe', () => {
  it.each(['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'])('binds %s XML, signature and QR to the invoice hash', async document_type => {
    const props = document_type === 'INVOICE' ? {} : { billing_reference: 'SYNTHETIC-ORIGINAL', note_reason: 'QA correction' };
    const uuid = randomUUID();
    const result = await prepareZatcaSdk345QaDocument({ ...draft, document_type, ...props }, { ...context, invoiceUuid: uuid }, fixture(), signer);
    const { xml, invoiceHashBase64, qrPayload } = result;
    expect(result.uuid).toBe(uuid);
    expect(result.stage).toBe('SDK_345_SYNTHETIC_QA_ONLY');
    const before = (await prepareZatcaInvoiceHash(xml)).invoiceHashBase64;
    const after = (await prepareZatcaInvoiceHash(xml.replace('Consulting service', 'Modified service'))).invoiceHashBase64;
    const signatureBase64 = /<ds:SignatureValue>([^<]+)</.exec(xml)![1];
    const signature = Buffer.from(signatureBase64, 'base64');
    expect(before).toBe(invoiceHashBase64);
    expect(verify('sha256', Buffer.from(before, 'base64'), cert.publicKey, signature)).toBe(true);
    expect(verify('sha256', Buffer.from(after, 'base64'), cert.publicKey, signature)).toBe(false);

    const bytes = Buffer.from(qrPayload, 'base64');
    const values: Buffer[] = [];
    for (let i = 0; i < bytes.length;) {
      expect(bytes[i++]).toBe(values.length + 1);
      const size = bytes[i++];
      expect(bytes.length - i).toBeGreaterThanOrEqual(size);
      values.push(bytes.subarray(i, i + size));
      i += size;
    }
    expect(values.slice(0, 7).map(v => v.toString('utf8'))).toEqual([
      draft.seller_name, draft.seller_vat_number, '2026-11-15T12:00:00', '230.00', '30.00', before, signatureBase64,
    ]);
    expect(values[7]).toEqual(cert.publicKey.export({ format: 'der', type: 'spki' }));
    expect(values[8]).toEqual(certificateSignatureDer(cert.raw));
  });

  it('rejects a non-test VAT or an unmatched certificate before returning XML', async () => {
    const callback = vi.fn(signer);
    const c = { ...context, invoiceUuid: randomUUID() };
    await expect(prepareZatcaSdk345QaDocument({ ...draft, seller_vat_number: '312345678901233' }, c, fixture(), callback))
      .rejects.toThrow('QA_DUMMY_SIMPLIFIED_DOCUMENT_REQUIRED');
    await expect(prepareZatcaSdk345QaDocument(draft, c, { ...fixture(), fingerprintSha256: '0'.repeat(64) }, callback))
      .rejects.toThrow('SIGNING_CERTIFICATE_PIN_MISMATCH');
    expect(callback).not.toHaveBeenCalled();
    const wrong = generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey;
    await expect(prepareZatcaSdk345QaDocument(draft, c, fixture(), async h => sign('sha256', h, wrong)))
      .rejects.toThrow('QA_SDK_SIGNATURE_KEY_MISMATCH');
  });
});
