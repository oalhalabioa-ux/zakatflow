import { createHash, createPrivateKey, randomUUID, sign, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prepareSignedZatcaXml, type XadesPreparationOptions, type XadesPreparationSigner } from './zatca-xades-preparation';
import { prepareZatcaInvoiceHash } from './zatca-xml-hash';
import { buildUnsignedZatcaXml } from './zatca-phase2-xml';
import { calculateVatEInvoiceDraft, vatEInvoiceDraftSchema } from './vat-einvoice-draft';
import { createZatcaPreparationSnapshot, prepareReservedZatcaArtifact } from './zatca-reserved-preparation';

const draft = { organization_id: 'a800b1c2-df4a-4a79-9b91-4a451ce2858a', invoice_number: 'INV-2026-0001', invoice_category: 'STANDARD', issue_date: '2026-10-22', issue_time: '12:00', seller_name: 'شركة الاختبار', seller_vat_number: '312345678901233', seller_address: 'King Fahd Road', seller_building_number: '1234', seller_additional_number: '5678', seller_district: 'Olaya', seller_postal_code: '12345', seller_city: 'Riyadh', buyer_name: 'Customer LLC', buyer_vat_number: '312345678901233', buyer_address: 'Customer street', buyer_building_number: '4321', buyer_district: 'Olaya', buyer_city: 'Riyadh', buyer_postal_code: '54321', lines: [{ item_name: 'Consulting service', quantity: 2, unit_price: 100, tax_category: 'S', tax_rate: 15 }] };
const context = { invoiceUuid: 'a800b1c2-df4a-4a79-9b91-4a451ce2858b', invoiceCounter: '1', previousInvoiceHash: Buffer.alloc(32).toString('base64'), supplyDate: '2026-10-22', sellerId: { scheme: 'CRN', value: '1010000000' }, paymentMeansCode: '30' };
const algorithm = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256';
let directory: string;
let options: XadesPreparationOptions;
let signer: XadesPreparationSigner;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'zatca-xades-'));
  const run = (...args: string[]) => execFileSync('openssl', args, { cwd: directory, stdio: 'pipe' });
  run('req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp256k1', '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-days', '3', '-subj', '/C=SA/O=Synthetic Test Only/CN=Test Root', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  run('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp256k1', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/C=SA/O=Synthetic Test Only/CN=Test EGS');
  writeFileSync(join(directory, 'leaf.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n');
  run('x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-set_serial', '123456789', '-days', '2', '-extfile', 'leaf.ext', '-out', 'leaf.pem');
  const certificate = readFileSync(join(directory, 'leaf.pem'), 'utf8');
  const leaf = new X509Certificate(certificate);
  const root = new X509Certificate(readFileSync(join(directory, 'root.pem')));
  options = { certificate, expectedFingerprintSha256: createHash('sha256').update(leaf.raw).digest('hex'), issuerChainDerBase64: [root.raw.toString('base64')], signingTime: new Date(Date.parse(leaf.validFrom) + 60000), policy: { identifier: 'https://example.invalid/synthetic-test-policy', digestSha256Base64: createHash('sha256').update('synthetic test only').digest('base64') } };
  const privateKey = createPrivateKey(readFileSync(join(directory, 'leaf.key')));
  signer = async bytes => ({ signatureValue: sign('sha256', bytes, { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64'), algorithm });
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

function nativeVerify(xml: string) {
  const file = join(directory, 'signed.xml');
  writeFileSync(file, xml);
  return spawnSync('xmlsec1', ['--verify', '--crypto', 'openssl', '--trusted-pem', join(directory, 'root.pem'), '--id-attr:Id', 'http://uri.etsi.org/01903/v1.3.2#:SignedProperties', '--enabled-reference-uris', 'empty,same-doc', file], { encoding: 'utf8' });
}

describe('isolated XAdES signed XML preparation', () => {
  it('attaches a simplified QR while preserving both signed references and source-currency VAT', async () => {
    for (const document_type of ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']) {
      const input = { ...draft, invoice_category: 'SIMPLIFIED', currency: 'USD', exchange_rate: 3.75, document_type, ...(document_type === 'INVOICE' ? {} : { billing_reference: 'ORIGINAL-1', note_reason: 'Correction' }) };
      const result = await prepareSignedZatcaXml(input, context, { ...options, includeSimplifiedQr: true }, signer);
      expect(result.qrPayload).toBeTruthy();
      expect(result.xml).toContain('<cbc:ID>QR</cbc:ID>');
      expect((await prepareZatcaInvoiceHash(result.xml)).invoiceHashBase64).toBe(result.invoiceHashBase64);
      const bytes = Buffer.from(result.qrPayload!, 'base64');
      const values: Buffer[] = [];
      for (let i = 0; i < bytes.length;) { i++; const size = bytes[i++]; values.push(bytes.subarray(i, i + size)); i += size; }
      expect(values[3].toString()).toBe('230.00');
      expect(values[4].toString()).toBe('30.00');
      expect(values[5]).toEqual(Buffer.from(result.invoiceHashBase64, 'base64'));
      if (process.env.ZATCA_NATIVE_XMLSEC === '1') { const verified = nativeVerify(result.xml); expect(verified.status, verified.stderr).toBe(0); }
    }
  });
  it('defers standard QR to the clearance flow before contacting the signer', async () => {
    const callback = vi.fn(signer);
    await expect(prepareSignedZatcaXml(draft, context, { ...options, includeSimplifiedQr: true }, callback)).rejects.toThrow('STANDARD_QR_REQUIRES_CLEARANCE');
    expect(callback).not.toHaveBeenCalled();
  });

  it.runIf(process.env.ZATCA_NATIVE_XMLSEC === '1')('independently verifies both references and rejects modified financial data, signed properties and signature', async () => {
    const result = await prepareSignedZatcaXml(draft, context, options, signer);
    const good = nativeVerify(result.xml);
    expect(good.status, good.stderr).toBe(0);
    // Exit status is XMLSec's verification contract; success text differs
    // between 1.2 and 1.3. Tamper both reference targets below to exercise them.
    expect((result.xml.match(/<ds:Reference /g) || []).length).toBe(2);
    for (const xml of [result.xml.replace('230.00', '231.00'), result.xml.replace('synthetic-test-policy', 'changed-policy'), result.xml.replace(/(<ds:SignatureValue>)(.)/, (_, prefix: string, first: string) => prefix + (first === 'A' ? 'B' : 'A'))]) expect(nativeVerify(xml).status).not.toBe(0);
  });
  it.each(['STANDARD', 'SIMPLIFIED'])('prepares all three %s document types with stable invoice references', async invoice_category => {
    for (const document_type of ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']) {
      const input = { ...draft, invoice_category, document_type, ...(document_type === 'INVOICE' ? {} : { billing_reference: 'ORIGINAL-1', note_reason: 'Correction' }) };
      const result = await prepareSignedZatcaXml(input, context, options, signer);
      expect(result.stage).toBe('SIGNED_XML_PREPARATION_ONLY');
      if (process.env.ZATCA_NATIVE_XMLSEC === '1') expect(nativeVerify(result.xml).status).toBe(0);
      if (process.env.ZATCA_UBL_XSD) execFileSync('xmllint', ['--nonet', '--schema', process.env.ZATCA_UBL_XSD, '--noout', '-'], { input: result.xml, stdio: ['pipe', 'pipe', 'pipe'] });
      const unsigned = buildUnsignedZatcaXml(input, context);
      expect(result.invoiceHashBase64).toBe((await prepareZatcaInvoiceHash(unsigned.xml)).invoiceHashBase64);
      expect(result.xml).toContain('SigningCertificateV2');
      expect(result.xml).toContain('URI="#xadesSignedProperties"');
      expect(result.xml).not.toContain('<cbc:ID>QR</cbc:ID>');
      expect(result.xml).toContain('<cbc:PayableAmount currencyID="SAR">230.00</cbc:PayableAmount>');
    }
  });
  it('binds policy and timestamp to SignedInfo and rejects a signature reused after either changes', async () => {
    let signature: Awaited<ReturnType<XadesPreparationSigner>>;
    await prepareSignedZatcaXml(draft, context, options, async bytes => { signature = await signer(bytes); return signature; });
    for (const change of [{ ...options, signingTime: new Date(options.signingTime.getTime() + 1000) }, { ...options, policy: { ...options.policy, identifier: 'https://example.invalid/other' } }]) await expect(prepareSignedZatcaXml(draft, context, change, async () => signature!)).rejects.toThrow('INVALID_XADES_SIGNATURE');
  });
  it('rejects invalid signer results and propagates signing failure without a partial result', async () => {
    for (const response of [{ signatureValue: Buffer.alloc(64).toString('base64'), algorithm }, { signatureValue: 'bad', algorithm }, { signatureValue: Buffer.alloc(64).toString('base64'), algorithm: 'wrong' }]) await expect(prepareSignedZatcaXml(draft, context, options, async () => response)).rejects.toThrow('INVALID_XADES_SIGNATURE');
    await expect(prepareSignedZatcaXml(draft, context, options, async () => { throw new Error('KMS_UNAVAILABLE'); })).rejects.toThrow('KMS_UNAVAILABLE');
  });
  it('rejects missing, duplicate, malformed and unrelated issuer chains before signing', async () => {
    const callback = vi.fn(signer);
    for (const issuerChainDerBase64 of [[], ['bad'], [...options.issuerChainDerBase64, ...options.issuerChainDerBase64], [new X509Certificate(options.certificate).raw.toString('base64')]]) await expect(prepareSignedZatcaXml(draft, context, { ...options, issuerChainDerBase64 }, callback)).rejects.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });
  it('requires an explicit valid policy and a matching current certificate before signing', async () => {
    const callback = vi.fn(signer);
    for (const policy of [{ identifier: 'javascript:bad', digestSha256Base64: options.policy.digestSha256Base64 }, { ...options.policy, digestSha256Base64: 'bad' }]) await expect(prepareSignedZatcaXml(draft, context, { ...options, policy }, callback)).rejects.toThrow('INVALID_SIGNATURE_POLICY');
    await expect(prepareSignedZatcaXml(draft, context, { ...options, expectedFingerprintSha256: '0'.repeat(64) }, callback)).rejects.toThrow('SIGNING_CERTIFICATE_PIN_MISMATCH');
    expect(callback).not.toHaveBeenCalled();
  });
  it('never accepts an arbitrary pre-signed XML document in place of a draft', async () => {
    const callback = vi.fn(signer);
    await expect(prepareSignedZatcaXml('<Invoice/>', context, options, callback)).rejects.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });
});

// Reuse the independently verified ephemeral test CA/leaf fixture above. These
// tests bind saved financial data and allocated chain values to the real signer.
function boundFixture() {
  const scope = { organizationId: draft.organization_id, environment: 'SIMULATION',
    unitId: 'a800b1c2-df4a-4a79-9b91-4a451ce2858c', connectionId: 'a800b1c2-df4a-4a79-9b91-4a451ce2858d',
    documentId: 'a800b1c2-df4a-4a79-9b91-4a451ce2858e', invoiceUuid: context.invoiceUuid };
  const invoice = vatEInvoiceDraftSchema.parse({ ...draft, connection_id: scope.connectionId,
    invoice_category: 'SIMPLIFIED', currency: 'USD', exchange_rate: 3.75 });
  const calculated = calculateVatEInvoiceDraft(invoice);
  const snapshot = createZatcaPreparationSnapshot({ documentId: scope.documentId, invoiceUuid: scope.invoiceUuid,
    status: 'DRAFT', draft: invoice,
    context: { supplyDate: context.supplyDate, sellerId: context.sellerId, paymentMeansCode: context.paymentMeansCode },
    savedTotals: calculated.totals, savedLineAmounts: calculated.lines.map(l => ({ line_number: l.line_number,
      line_extension_amount: l.line_extension_amount, tax_amount: l.tax_amount, gross_amount: l.gross_amount })) }, scope);
  return { scope, reservation: { reservation_id: 'a800b1c2-df4a-4a79-9b91-4a451ce2858f',
    organization_id: scope.organizationId, environment: scope.environment, unit_id: scope.unitId,
    document_id: scope.documentId, invoice_uuid: scope.invoiceUuid, counter: '9007199254740993',
    previous_hash: Buffer.alloc(32, 7).toString('base64'), snapshot_digest: 'a'.repeat(64), snapshot,
    state: 'RESERVED', invoice_hash: null, prepared_xml: null } };
}

describe('reservation-bound signed artifact preparation', () => {
  it('binds saved USD totals, bigint counter, PIH and UUID to verified XML and private finalize arguments', async () => {
    const { scope, reservation } = boundFixture();
    const result = await prepareReservedZatcaArtifact(reservation, scope, { ...options, includeSimplifiedQr: true }, signer);
    expect(result.stage).toBe('RESERVATION_BOUND_PREPARATION_ONLY');
    expect(result.xml).toContain('<cbc:UUID>9007199254740993</cbc:UUID>');
    expect(result.xml).toContain(reservation.previous_hash);
    expect(result.xml).toContain('<cbc:PayableAmount currencyID="USD">230.00</cbc:PayableAmount>');
    expect(result.xml).toContain('<cbc:TaxAmount currencyID="SAR">112.50</cbc:TaxAmount>');
    const expected = buildUnsignedZatcaXml(reservation.snapshot.draft, { ...reservation.snapshot.context,
      invoiceUuid: reservation.invoice_uuid, invoiceCounter: reservation.counter, previousInvoiceHash: reservation.previous_hash });
    expect(result.invoiceHashBase64).toBe((await prepareZatcaInvoiceHash(expected.xml)).invoiceHashBase64);
    expect(result.finalizeArguments).toEqual({ p_org: scope.organizationId, p_environment: scope.environment,
      p_unit: scope.unitId, p_reservation: reservation.reservation_id, p_snapshot_digest: reservation.snapshot_digest,
      p_invoice_hash: result.invoiceHashBase64, p_prepared_xml: result.xml });
    if (process.env.ZATCA_NATIVE_XMLSEC === '1') {
      const verified = nativeVerify(result.xml); expect(verified.status, verified.stderr).toBe(0);
    }
  });
  it('captures reservation and signer configuration before asynchronous hashing/signing', async () => {
    const { scope, reservation } = boundFixture();
    const supplied = { ...options, policy: { ...options.policy }, issuerChainDerBase64: [...options.issuerChainDerBase64], signingTime: new Date(options.signingTime) };
    const pending = prepareReservedZatcaArtifact(reservation, scope, supplied, signer);
    reservation.snapshot.draft.lines[0].unit_price = 999;
    reservation.counter = '42'; reservation.snapshot_digest = 'b'.repeat(64);
    supplied.policy.identifier = 'https://example.invalid/changed-after-call';
    supplied.issuerChainDerBase64.length = 0; supplied.signingTime.setTime(0);
    const result = await pending;
    expect(result.xml).toContain('<cbc:UUID>9007199254740993</cbc:UUID>');
    expect(result.xml).toContain('<cbc:PayableAmount currencyID="USD">230.00</cbc:PayableAmount>');
    expect(result.xml).not.toContain('changed-after-call');
    expect(result.finalizeArguments.p_snapshot_digest).toBe('a'.repeat(64));
    if (process.env.ZATCA_NATIVE_XMLSEC === '1') expect(nativeVerify(result.xml).status).toBe(0);
  });
  it('returns no artifact/finalization result on signer failure', async () => {
    const { scope, reservation } = boundFixture();
    await expect(prepareReservedZatcaArtifact(reservation, scope, options, async () => { throw new Error('KMS_UNAVAILABLE'); })).rejects.toThrow('KMS_UNAVAILABLE');
    expect(reservation.state).toBe('RESERVED');
    expect(reservation.prepared_xml).toBeNull();
  });
  it('rejects a certificate pin mismatch before contacting the signing callback', async () => {
    const { scope, reservation } = boundFixture(); const callback = vi.fn(signer);
    await expect(prepareReservedZatcaArtifact(reservation, scope, { ...options, expectedFingerprintSha256: '0'.repeat(64) }, callback)).rejects.toThrow('SIGNING_CERTIFICATE_PIN_MISMATCH');
    expect(callback).not.toHaveBeenCalled();
  });
});

it.runIf(process.env.ZATCA_LEDGER_SQL_QA === '1')('round-trips a real PostgreSQL reservation through verified signing and atomic finalization', async () => {
  if (process.env.ZATCA_LEDGER_DISPOSABLE_QA !== '1' || process.env.PGDATABASE !== 'zatca_ledger_qa') throw new Error('DISPOSABLE_LEDGER_QA_REQUIRED');
  const query = (statement: string) => execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  expect(query('select current_database()')).toBe('zatca_ledger_qa');
  const quoted = (value: string) => "'" + value.replace(/'/g, "''") + "'";
  const { scope, reservation: template } = boundFixture();
  const args = [scope.organizationId, scope.environment, scope.unitId];
  query('insert into zatca_preparation.units(organization_id,environment,unit_id,last_counter) values (' + args.map(quoted).join(',') + ',9007199254740992)');
  const reserve = (document: string, invoice: string, snapshot: unknown) => JSON.parse(query("select to_jsonb(r)||jsonb_build_object('counter',r.counter::text) from zatca_preparation.reserve(" + [...args, document, invoice, JSON.stringify(snapshot)].map(quoted).join(',') + ') r'));
  const reservation = reserve(scope.documentId, scope.invoiceUuid, template.snapshot);
  expect(reservation.counter).toBe('9007199254740993');
  const artifact = await prepareReservedZatcaArtifact(reservation, scope, { ...options, includeSimplifiedQr: true }, signer);
  const verified = nativeVerify(artifact.xml); expect(verified.status, verified.stderr).toBe(0);
  const a = artifact.finalizeArguments;
  const statement = "select to_jsonb(r)||jsonb_build_object('counter',r.counter::text) from zatca_preparation.finalize(" + [a.p_org, a.p_environment, a.p_unit, a.p_reservation, a.p_snapshot_digest, a.p_invoice_hash, a.p_prepared_xml].map(quoted).join(',') + ') r';
  const saved = JSON.parse(query(statement));
  expect(saved.prepared_xml).toBe(artifact.xml);
  expect(saved.invoice_hash).toBe(artifact.invoiceHashBase64);
  expect(saved.snapshot).toEqual(template.snapshot);
  expect(saved.state).toBe('PREPARED');
  expect(JSON.parse(query(statement))).toEqual(saved);
  const nextSnapshot = structuredClone(template.snapshot);
  nextSnapshot.scope.documentId = randomUUID(); nextSnapshot.scope.invoiceUuid = randomUUID();
  nextSnapshot.draft.invoice_number += '-NEXT';
  const next = reserve(nextSnapshot.scope.documentId, nextSnapshot.scope.invoiceUuid, nextSnapshot);
  expect(next.counter).toBe('9007199254740994');
  expect(next.previous_hash).toBe(artifact.invoiceHashBase64);
});
