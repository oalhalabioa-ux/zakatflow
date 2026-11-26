import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST as createDraft } from '../app/api/vat/e-invoices/route';
import { POST as issueInvoice } from '../app/api/vat/e-invoices/issue/route';
import { createZatcaPhaseOneQrPayload } from '../lib/zatca-phase-one-qr';

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock('@/services/auth', () => auth);
vi.mock('@/services/organization-access', () => import('../services/organization-access'));
vi.mock('@/lib/vat-invoice-workflow', () => import('../lib/vat-invoice-workflow'));
vi.mock('@/lib/vat-einvoice-draft', () => import('../lib/vat-einvoice-draft'));

const org = 'a800b1c2-df4a-4a79-9b91-4a451ce2858a';
const otherOrg = 'fbbf790a-f237-4573-9527-573c28b644bb';
const owner = '73fadebb-0a50-4850-8583-49aca9d265d1';
const documentId = '5e80142f-9e89-4037-9bf7-742b1a89d190';
const invoiceId = '603468bd-5465-48de-8307-feaf521c75ae';
const otherInvoiceId = '27248a06-d089-4c5f-b849-c2723f2c0d08';
const origin = 'https://yaqeen-test.invalid/api/vat/e-invoices';
const draft = {
  organization_id: org, accounting_document_id: documentId, buyer_contact_id: null, invoice_number: 'QA-SIM-0001',
  invoice_category: 'SIMPLIFIED', document_type: 'INVOICE', issue_date: '2026-11-26', issue_time: '12:00:00',
  seller_name: 'Synthetic seller', seller_vat_number: '312345678901233', seller_address: 'Synthetic street',
  seller_building_number: '1234', seller_district: 'Synthetic district', seller_additional_number: '5678',
  seller_postal_code: '12345', seller_city: 'Riyadh',
  lines: [{ item_name: 'Synthetic item', quantity: 1, unit_price: 100, tax_category: 'S', tax_rate: 15 }],
};
type Row = Record<string, unknown>;
type Rows = Record<string, Row[]>;

function setup(role = 'OWNER') {
  const source = { id: documentId, organization_id: org, document_type: 'SALES', document_kind: 'INVOICE',
    document_number: draft.invoice_number, counterparty_contact_id: null, transaction_date: draft.issue_date,
    due_date: null, currency: 'SAR', net_amount: '100.00', tax_amount: '15.00', gross_amount: '115.00',
    exchange_rate: '1', zatca_status: 'NOT_ISSUED' };
  const rows: Rows = {
    organization_members: [{ organization_id: org, user_id: owner, role, status: 'ACTIVE' }],
    vat_documents: [source],
    currencies: [{ code: 'SAR', active: true }],
    vat_profiles: [{ organization_id: org, registration_status: 'REGISTERED', standard_rate: 15,
      tax_registration_number: draft.seller_vat_number, registered_name: 'Registered synthetic seller',
      seller_street: 'Synthetic street', seller_building_number: '1234', seller_district: 'Synthetic district',
      seller_additional_number: '5678', seller_city: 'Riyadh', seller_postal_code: '12345' }],
    vat_einvoices: [{ id: otherInvoiceId, organization_id: otherOrg, status: 'ISSUED' }],
    vat_einvoice_lines: [], audit_logs: [], liquidity_flows: [], financial_vat_source_bindings: [],
    financial_event_links: [], financial_events: [],
  };
  let loseRouteUpdate = false;
  const from = vi.fn((table: string) => {
    const data = rows[table];
    if (!data) throw Error('Unexpected table: ' + table);
    const filters: ((row: Row) => boolean)[] = [];
    let changed: Row | undefined;
    let inserted: Row[] | undefined;
    const selected = () => (inserted ?? data.filter(row => filters.every(filter => filter(row))));
    const run = () => {
      if (changed && loseRouteUpdate) {
        loseRouteUpdate = false;
        return { data: null, error: { message: 'synthetic update response lost' } };
      }
      const result = selected();
      if (changed) result.forEach(row => Object.assign(row, changed));
      return { data: structuredClone(result), error: null };
    };
    return {
      select() { return this; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return this; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return this; },
      order() { return this; },
      limit() { return this; },
      insert(payload: Row | Row[]) {
        inserted = (Array.isArray(payload) ? payload : [payload]).map(row =>
          table === 'vat_einvoices' ? { id: invoiceId, ...row } : row);
        data.push(...inserted);
        return this;
      },
      update(payload: Row) { changed = payload; return this; },
      maybeSingle: async () => ({ data: structuredClone(selected()[0] ?? null), error: null }),
      single: async () => ({ data: structuredClone(selected()[0]), error: null }),
      then: (resolve: (result: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(resolve),
    };
  });
  const rpc = vi.fn(async (name: string, args: Row) => {
    const invoice = rows.vat_einvoices.find(row => row.id === args.p_einvoice_id || row.id === args.p_invoice_id);
    if (!invoice || invoice.organization_id !== org) throw Error('Unexpected RPC scope');
    if (name === 'link_zatca_accounting_document' && args.p_document_id === documentId) {
      invoice.accounting_document_id = documentId;
      return { data: null, error: null };
    }
    if (name !== 'issue_vat_einvoice' || invoice.status !== 'DRAFT') throw Error('Unexpected issuance call');
    const qr_code = createZatcaPhaseOneQrPayload({
      sellerName: String(invoice.seller_name), sellerVatNumber: draft.seller_vat_number,
      issueDate: draft.issue_date, issueTime: draft.issue_time, totalWithVat: '115.00', vatTotal: '15.00',
    });
    Object.assign(invoice, { status: 'ISSUED', qr_code });
    source.zatca_status = 'ISSUED';
    return { data: { ...invoice }, error: null };
  });
  auth.requireUser.mockResolvedValue({ supabase: { from, rpc }, user: { id: owner } });
  const external = vi.fn(() => { throw Error('Unexpected external network access'); });
  vi.stubGlobal('fetch', external);
  return { rows, source, from, rpc, external, loseNextRouteUpdate: () => { loseRouteUpdate = true; } };
}

const request = (url: string, body: Row) => new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const save = (body: Row = draft) => createDraft(request(origin, body));
const issue = (organization_id = org, invoice_id = invoiceId) =>
  issueInvoice(request(origin + '/issue', { organization_id, invoice_id }));
const list = (organization_id = org) => GET(new Request(origin + '?organization_id=' + organization_id));

afterEach(() => {
  vi.unstubAllGlobals();
  auth.requireUser.mockReset();
});

describe('Yaqeen authenticated Simplified invoice routes with synthetic persistence', () => {
  it('creates a linked draft, issues it, and reads it back without any external delivery or financial write', async () => {
    const f = setup();
    const saved = await save();
    expect(saved.status, JSON.stringify(await saved.clone().json())).toBe(201);
    expect(await saved.json()).toMatchObject({ id: invoiceId, status: 'DRAFT', invoice_category: 'SIMPLIFIED',
      accounting_document_id: documentId, payable_amount: '115.00' });
    const issued = await issue();
    expect(issued.status).toBe(200);
    const result = await issued.json();
    expect(result).toMatchObject({ id: invoiceId, status: 'ISSUED', seller_name: 'Registered synthetic seller',
      accounting_source: { document_id: documentId, financial_effect: 'UNCHANGED_ON_ZATCA_ISSUE' } });
    expect(result.qr_code).toBeTruthy();
    const reload = await list();
    expect(reload.status).toBe(200);
    expect((await reload.json()).invoices).toMatchObject([{ id: invoiceId, status: 'ISSUED', buyer_vat_number: null,
      qr_code: result.qr_code, accounting_document: { id: documentId, zatca_status: 'ISSUED' } }]);
    expect(f.rows.liquidity_flows).toEqual([]);
    expect(f.rows.financial_events).toEqual([]);
    expect(f.external).not.toHaveBeenCalled();
  });

  it('accepts an omitted buyer contact for a Simplified accounting source without a contact', async () => {
    setup();
    const { buyer_contact_id: omitted, ...anonymousDraft } = draft;
    expect(omitted).toBeNull();
    const response = await save(anonymousDraft);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: invoiceId, status: 'DRAFT' });
  });

  it('reconciles an error after local issuance without invoking the issue RPC again', async () => {
    const f = setup();
    expect((await save()).status).toBe(201);
    f.loseNextRouteUpdate();
    expect((await issue()).status).toBe(500);
    expect((await list()).status).toBe(200);
    const retry = await issue();
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ id: invoiceId, status: 'ISSUED' });
    expect(f.rpc.mock.calls.filter(([name]) => name === 'issue_vat_einvoice')).toHaveLength(1);
    expect(f.external).not.toHaveBeenCalled();
  });

  it('denies access to another tenant and hides another tenant’s invoice lookup', async () => {
    const f = setup();
    expect((await list(otherOrg)).status).toBe(403);
    expect((await save({ ...draft, organization_id: otherOrg })).status).toBe(403);
    expect((await issue(otherOrg, otherInvoiceId)).status).toBe(403);
    expect((await issue(org, otherInvoiceId)).status).toBe(404);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it('allows a viewer to list but not create or issue', async () => {
    const f = setup('VIEWER');
    const response = await list();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ is_admin: false });
    expect((await save()).status).toBe(403);
    expect((await issue()).status).toBe(403);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it('blocks issuance when fiscal totals changed after the draft was created', async () => {
    const f = setup();
    expect((await save()).status).toBe(201);
    f.source.gross_amount = '116.00';
    const result = await issue();
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: 'EINVOICE_ACCOUNTING_SOURCE_MISMATCH' });
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(['link_zatca_accounting_document']);
  });
});
