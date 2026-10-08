import { describe, expect, it } from 'vitest';
import { isVatReportDocument } from './vat-report-scope';
import { summarizeVatDocuments } from './vat';
import { invoicePaymentState } from './invoice-register-filters';

describe('VAT report scope and note treatment', () => {
  it('defaults to issued sales and includes drafts only for review', () => {
    for (const status of ['DRAFT','NOT_ISSUED']) {
      expect(isVatReportDocument({document_type:'SALES',zatca_status:status})).toBe(false);
      expect(isVatReportDocument({document_type:'SALES',zatca_status:status},true)).toBe(true);
    }
    for (const status of ['ISSUED','CLEARED','REPORTED','SUBMITTED']) expect(isVatReportDocument({document_type:'SALES',zatca_status:status})).toBe(true);
    expect(isVatReportDocument({document_type:'PURCHASE',zatca_status:'NOT_ISSUED'})).toBe(true);
    for (const status of ['VOID','REJECTED']) expect(isVatReportDocument({document_type:'SALES',zatca_status:status},true)).toBe(false);
  });
  it('reports credit/debit notes in their own period without counting drafts', () => {
    const rows = [
      {document_type:'SALES' as const,document_kind:'INVOICE' as const,transaction_date:'2025-12-31',zatca_status:'ISSUED',supply_type:'STANDARD' as const,net_amount:1000,tax_amount:150,recoverable_percent:100},
      {document_type:'SALES' as const,document_kind:'CREDIT_NOTE' as const,transaction_date:'2026-01-10',zatca_status:'ISSUED',supply_type:'STANDARD' as const,net_amount:100,tax_amount:15,recoverable_percent:100},
      {document_type:'SALES' as const,document_kind:'DEBIT_NOTE' as const,transaction_date:'2026-01-11',zatca_status:'ISSUED',supply_type:'STANDARD' as const,net_amount:50,tax_amount:7.5,recoverable_percent:100},
      {document_type:'SALES' as const,document_kind:'DEBIT_NOTE' as const,transaction_date:'2026-01-12',zatca_status:'DRAFT',supply_type:'STANDARD' as const,net_amount:999,tax_amount:149.85,recoverable_percent:100},
    ];
    const current = summarizeVatDocuments(rows.filter(row=>row.transaction_date>='2026-01-01' && isVatReportDocument(row)));
    expect(current.salesNet).toBe('-50.00'); expect(current.outputTax).toBe('-7.50');
    expect(summarizeVatDocuments(rows.filter(row=>row.transaction_date<'2026-01-01')).outputTax).toBe('150.00');
  });
  it('reverses only the original recoverable input tax on supplier credits', () => {
    const result=summarizeVatDocuments([{document_type:'PURCHASE',document_kind:'CREDIT_NOTE',supply_type:'STANDARD' as const,net_amount:100,tax_amount:15,recoverable_percent:50}]);
    expect(result.inputTax).toBe('-7.50'); expect(result.purchaseNet).toBe('-100.00');
  });
  it('treats zero forecasts closed by credit as closed, with unlinked invoices separate', () => {
    const row={id:'i',number:'1',name:'A',date:'2026-10-08',currency:'SAR',baseAmount:0};
    expect(invoicePaymentState({...row,flow:{amount:0,settled_amount:0,settlement_status:'SETTLED'}})).toBe('PAID');
    expect(invoicePaymentState(row)).toBe('UNLINKED');
  });
});
