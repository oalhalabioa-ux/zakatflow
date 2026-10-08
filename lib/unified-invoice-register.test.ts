import { describe, expect, it } from 'vitest';
import { buildUnifiedInvoices } from './unified-invoice-register';
import { filterInvoiceRows, emptyInvoiceFilters } from './invoice-register-filters';
const document = { id:'doc',document_number:'INV-1',counterparty_name:'Customer',transaction_date:'2025-01-02',due_date:'2025-02-02',document_type:'SALES' as const,document_kind:'INVOICE',zatca_status:'NOT_ISSUED',currency:'SAR',source_currency:'USD',source_gross_amount:'115',source_tax_amount:'15',gross_amount:'431.25',tax_amount:'56.25' };
const electronic = { id:'e',accounting_document_id:'doc',invoice_number:'INV-1',buyer_name:'Customer',issue_date:'2025-01-02',due_date:null,document_type:'INVOICE',status:'ISSUED',currency:'USD',payable_amount:'115',tax_total_amount:'15' };
describe('unified invoice register', () => {
  it('joins the accounting and electronic document once, retaining independent financial and payment states', () => {
    const rows = buildUnifiedInvoices([document],[electronic],[{ id:'flow',source_record_id:'doc',amount:'431.25',settled_amount:'100',settlement_status:'PARTIAL',currency:'SAR',direction:'INFLOW',due_date:null }],new Map([['doc','COMMITTED']]),new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ electronicId:'e',documentId:'doc',status:'ISSUED',accountingStatus:'COMMITTED',currency:'USD',total:115,baseAmount:431.25,tax:15 });
    expect(filterInvoiceRows(rows,{...emptyInvoiceFilters,payment:'PARTIAL'},r=>r)).toHaveLength(1);
  });
  it('does not duplicate linked electronic rows outside the current accounting page', () => {
    expect(buildUnifiedInvoices([], [electronic], [], new Map(), new Map())).toEqual([]);
  });
  it('keeps standalone electronic drafts, purchases and original-linked notes', () => {
    const note = {...document,id:'note',document_number:'CN-1',document_type:'PURCHASE' as const,document_kind:'CREDIT_NOTE',preceding_document_id:'original'};
    const rows = buildUnifiedInvoices([note],[{...electronic,accounting_document_id:null,status:'DRAFT'}],[],new Map([['note','ACTUAL']]),new Map([['original','OLD-INV']]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({side:'PURCHASE',kind:'CREDIT_NOTE',originalId:'original',originalNumber:'OLD-INV',accountingStatus:'ACTUAL',electronicId:null});
    expect(rows[1]).toMatchObject({status:'DRAFT',documentId:null,accountingStatus:'UNLINKED',flow:null});
  });
});
