import { expect, it } from 'vitest';
import { vatEInvoiceRegisterUrl } from './vat-einvoice-register-target';
it('keeps the original workspace request unchanged when no register target is supplied',()=>{
  expect(vatEInvoiceRegisterUrl('company')).toBe('/api/vat/e-invoices?organization_id=company');
});
it('focuses the added workspace on a linked or standalone electronic invoice, including old invoices',()=>{
  expect(vatEInvoiceRegisterUrl('company',{electronicId:'invoice',documentId:'doc'})).toBe('/api/vat/e-invoices?organization_id=company&target_invoice_id=invoice');
});
it('focuses accounting invoices that have not yet received an electronic draft',()=>{
  expect(vatEInvoiceRegisterUrl('company',{electronicId:null,documentId:'doc'})).toBe('/api/vat/e-invoices?organization_id=company&target_document_id=doc');
});
