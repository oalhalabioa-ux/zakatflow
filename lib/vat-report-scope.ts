export const issuedVatStates = new Set(['ISSUED', 'CLEARED', 'REPORTED', 'SUBMITTED']);
export function isVatReportDocument(document: { document_type: string; zatca_status?: string | null }, includeDrafts = false) {
  if (document.zatca_status === 'VOID' || document.zatca_status === 'REJECTED') return false;
  // Supplier invoices are received documents; our outbound issuance status does not apply.
  if (document.document_type !== 'SALES') return document.zatca_status !== 'DRAFT' || includeDrafts;
  return includeDrafts || issuedVatStates.has(document.zatca_status || '');
}
