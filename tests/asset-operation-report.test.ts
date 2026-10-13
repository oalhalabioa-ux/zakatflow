import {describe,it,expect} from 'vitest';
import {operationColumnValue,operationExportRows,operationFilteredSummary,operationReportAmounts} from '../lib/asset-operation-report';
const purchase={id:'p',transaction_date:'2026-10-13',transaction_type:'PURCHASE',financial_event_status:'ACTUAL',gross_value:100,base_value:375,currency:'USD',base_currency:'SAR',quantity:1,metadata:{fx_rate:3.75,vat_amount:15},asset_account_id:'asset',asset_accounts:{name:'Asset'},obligation_balances:[{}],applied_base_amount:187.5,outstanding_base_amount:243.75};
describe('operations financial presentation',()=>{
 it('keeps source net/VAT/gross distinct from base and book effect',()=>{expect(operationReportAmounts(purchase)).toMatchObject({net:100,tax:15,total:115,baseNet:375,baseTax:56.25,baseTotal:431.25,fx:3.75});expect(operationColumnValue(purchase,'outstanding')).toBe(243.75)});
 it('excludes drafts/cancelled/reversed from posted movement',()=>{const rows=[purchase,{...purchase,id:'draft',financial_event_status:'DRAFT'},{...purchase,id:'reversed',financial_event_status:'REVERSED'}];expect(operationFilteredSummary(rows)).toMatchObject({count:2,drafts:1,net:375,currency:'SAR'})});
 it('does not sum different base currencies',()=>{expect(operationFilteredSummary([purchase,{...purchase,id:'eur',base_currency:'EUR'}]).net).toBeNull()});
 it('reports disposal and sale by book effect instead of proceeds for the net asset metric',()=>{const sale={...purchase,operation_type:'SALE',gross_value:200,metadata:{cost_basis_base:150,asset_effect_base:-150,realized_gain_base:50,vat_amount:0}};expect(operationFilteredSummary([sale]).net).toBe(-150);expect(operationReportAmounts(sale).gain).toBe(50)});
 it('leaves settlement figures blank when no obligation exists',()=>{expect(operationColumnValue({...purchase,obligation_balances:[]},'applied')).toBe('—');expect(operationExportRows([purchase])[1]).toContain(431.25)});
});
