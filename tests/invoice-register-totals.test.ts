import { describe, expect, it } from 'vitest';
import { invoiceRegisterTotals, type InvoiceTotalRow } from '../lib/invoice-register-totals';
const invoice = (overrides: Partial<InvoiceTotalRow> = {}): InvoiceTotalRow => ({side:'SALES',kind:'INVOICE',currency:'SAR',net:'100',tax:'15',gross:'115',...overrides});
describe('filtered invoice totals', () => {
  it('deducts credits and adds debit notes using exact decimals', () => {
    const result = invoiceRegisterTotals([invoice({net:'0.1',tax:'0.01',gross:'0.11'}),invoice({net:'0.2',tax:'0.02',gross:'0.22'}),invoice({kind:'CREDIT_NOTE',net:'0.1',tax:'0.01',gross:'0.11'}),invoice({kind:'DEBIT_NOTE',net:'0.3',tax:'0.03',gross:'0.33'})]);
    expect(result.groups[0]).toMatchObject({net:'0.50',tax:'0.05',gross:'0.55',count:4});
  });
  it('keeps directions and document currencies separate from settlement currency', () => {
    const result=invoiceRegisterTotals([invoice(),invoice({side:'PURCHASE'}),invoice({currency:'USD',flow:{currency:'SAR',amount:'431.25',settled_amount:'100'}})]);
    expect(result.groups.map(g=>[g.side,g.currency,g.gross])).toEqual([['SALES','SAR','115.00'],['PURCHASE','SAR','115.00'],['SALES','USD','115.00']]);
    expect(result.cash).toEqual([{side:'SALES',currency:'SAR',paid:'100.00',due:'331.25'}]);
  });
  it('excludes void and rejected documents but includes visible review drafts', () => {
    const result=invoiceRegisterTotals([invoice({status:'VOID'}),invoice({status:'REJECTED'}),invoice({status:'DRAFT'})]);
    expect(result.groups[0]).toMatchObject({count:1,gross:'115.00'});
    expect(invoiceRegisterTotals([])).toEqual({groups:[],cash:[]});
  });
  it('uses the adjusted original obligation without double-counting note refunds', () => {
    const result=invoiceRegisterTotals([invoice({flow:{currency:'SAR',amount:'80',settled_amount:'100'}}),invoice({kind:'CREDIT_NOTE',net:'30',tax:'5',gross:'35',flow:{currency:'SAR',amount:'20',settled_amount:'20'}})]);
    expect(result.groups[0]).toMatchObject({gross:'80.00'});
    expect(result.cash).toEqual([{side:'SALES',currency:'SAR',paid:'100.00',due:'0.00'}]);
  });
});
