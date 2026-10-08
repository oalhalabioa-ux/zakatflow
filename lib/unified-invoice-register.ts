import type { InvoiceSearchRow } from './invoice-register-filters';
export type RegisterFlow = { id: string; amount: string; settled_amount: string; settlement_status: string; currency: string; direction: string; due_date: string | null };
export type UnifiedInvoice = InvoiceSearchRow & {
  documentId: string | null; electronicId: string | null; side: 'SALES' | 'PURCHASE'; kind: string;
  accountingStatus: string; status: string; originalId: string | null; originalNumber: string | null;
  tax: number; total: number; flow: RegisterFlow | null;
};
type Document = { id: string; document_number: string; counterparty_name: string; transaction_date: string; due_date: string | null; document_type: 'SALES' | 'PURCHASE'; document_kind: string; zatca_status: string; currency: string; source_currency?: string; source_gross_amount?: string | null; source_tax_amount?: string | null; gross_amount: string; tax_amount: string; preceding_document_id?: string | null };
type Electronic = { id: string; accounting_document_id: string | null; invoice_number: string; buyer_name: string | null; issue_date: string; due_date: string | null; document_type: string; status: string; currency: string; payable_amount: string; tax_total_amount: string; exchange_rate?: string; preceding_invoice_id?: string | null; billing_reference?: string | null };
export function buildUnifiedInvoices(documents: Document[], electronics: Electronic[], flows: Array<RegisterFlow & { source_record_id: string }>, events: Map<string,string>, originals: Map<string,string>): UnifiedInvoice[] {
  const electronicByDocument = new Map(electronics.filter(e => e.accounting_document_id).map(e => [e.accounting_document_id, e]));
  const flowByDocument = new Map(flows.map(f => [f.source_record_id, f]));
  const rows: UnifiedInvoice[] = documents.map(d => {
    const e = electronicByDocument.get(d.id);
    return { id: 'accounting:' + d.id, documentId: d.id, electronicId: e?.id ?? null, number: d.document_number,
      name: d.counterparty_name, date: d.transaction_date, due: d.due_date, side: d.document_type, kind: d.document_kind,
      category: d.document_kind, status: e?.status ?? d.zatca_status ?? 'NOT_ISSUED', accountingStatus: events.get(d.id) ?? 'UNLINKED',
      currency: d.source_currency || d.currency, baseAmount: Number(d.gross_amount), total: Number(d.source_gross_amount ?? d.gross_amount),
      tax: Number(d.source_tax_amount ?? d.tax_amount), originalId: d.preceding_document_id ?? e?.preceding_invoice_id ?? null,
      originalNumber: originals.get(d.preceding_document_id || '') ?? e?.billing_reference ?? null, flow: flowByDocument.get(d.id) ?? null };
  });
  // Linked electronic records belong to their accounting row, even when that row is on another page.
  for (const e of electronics.filter(e => !e.accounting_document_id)) rows.push({
    id: 'electronic:' + e.id, documentId: null, electronicId: e.id, number: e.invoice_number, name: e.buyer_name || '', date: e.issue_date,
    due: e.due_date, side: 'SALES', kind: e.document_type, category: e.document_type, status: e.status, accountingStatus: 'UNLINKED',
    currency: e.currency, total: Number(e.payable_amount), tax: Number(e.tax_total_amount), baseAmount: Number(e.payable_amount) * Number(e.exchange_rate || 1),
    originalId: e.preceding_invoice_id ?? null, originalNumber: e.billing_reference ?? null, flow: null,
  });
  return rows;
}
