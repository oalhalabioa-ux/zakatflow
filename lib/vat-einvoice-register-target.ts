export type InvoiceRegisterTarget = { electronicId: string | null; documentId: string | null };
export function vatEInvoiceRegisterUrl(organizationId: string, target?: InvoiceRegisterTarget) {
  const base = `/api/vat/e-invoices?organization_id=${encodeURIComponent(organizationId)}`;
  return target?.electronicId ? `${base}&target_invoice_id=${encodeURIComponent(target.electronicId)}`
    : target?.documentId ? `${base}&target_document_id=${encodeURIComponent(target.documentId)}` : base;
}
