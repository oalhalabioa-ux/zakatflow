import { describe, expect, it } from 'vitest';
import { emptyInvoiceFilters, filterInvoiceRows, type InvoiceSearchRow } from './invoice-register-filters';
const rows: InvoiceSearchRow[] = [
  {id:'a',number:'10',name:'Alpha',date:'2026-10-01',due:'2026-10-05',currency:'USD',baseAmount:375,status:'DRAFT',flow:{amount:100,settled_amount:40}},
  {id:'b',number:'2',name:'Beta',date:'2026-10-02',due:'2026-10-05',currency:'SAR',baseAmount:200,status:'ISSUED',flow:{amount:200,settled_amount:200}},
  {id:'c',number:'3',name:'Gamma',date:'2026-10-03',currency:'SAR',baseAmount:100,status:'DRAFT'},
];
describe('invoice register filtering', () => {
  it('sorts invoice numbers numerically without mutating the source', () => {
    expect(filterInvoiceRows(rows,{...emptyInvoiceFilters,sort:'NUMBER_ASC'},row=>row).map(row=>row.number)).toEqual(['2','3','10']);
    expect(rows.map(row=>row.number)).toEqual(['10','2','3']);
  });
  it('combines contact search, currency, date and status', () => {
    expect(filterInvoiceRows(rows,{...emptyInvoiceFilters,query:' alpha ',currency:'USD',status:'DRAFT',from:'2026-10-01',to:'2026-10-01'},row=>row)).toHaveLength(1);
  });
  it('excludes fully paid and unlinked invoices from overdue', () => {
    expect(filterInvoiceRows(rows,{...emptyInvoiceFilters,payment:'OVERDUE'},row=>row,'2026-10-08').map(row=>row.id)).toEqual(['a']);
  });
  it('orders values in the common base currency', () => {
    expect(filterInvoiceRows(rows,{...emptyInvoiceFilters,sort:'AMOUNT_DESC'},row=>row).map(row=>row.id)).toEqual(['a','b','c']);
  });
  it('distinguishes unlinked from unpaid and rejects inverted date ranges', () => {
    expect(filterInvoiceRows(rows,{...emptyInvoiceFilters,payment:'UNLINKED'},row=>row).map(row=>row.id)).toEqual(['c']);
    expect(filterInvoiceRows(rows,{...emptyInvoiceFilters,from:'2026-10-05',to:'2026-10-01'},row=>row)).toEqual([]);
  });
});
