import {describe,it,expect} from 'vitest';
import {advanceAmounts,advanceCommandSchema,compatibleAdvance} from './advances';
const id='85acbac0-e8b4-434c-a22b-3ec13b55e1a7';
describe('advance payment contract',()=>{
 it('uses four decimal base amounts and rejects nonfinite or empty value',()=>{expect(advanceAmounts(10.1234,3.75)).toEqual({amount:10.1234,base:37.9628});for(const n of [0,-1,Infinity,NaN])expect(()=>advanceAmounts(n,1)).toThrow('ADVANCE_AMOUNT_INVALID');});
 it('allows only the matching debt side, organization and recorded FX',()=>{const a={organization_id:id,obligation_type:'SUPPLIER_ADVANCE',currency:'SAR',base_currency:'SAR',exchange_rate:1},o={...a,obligation_type:'PAYABLE'};expect(compatibleAdvance(a,o)).toBe(true);for(const change of [{organization_id:'other'},{currency:'USD'},{exchange_rate:3.75},{obligation_type:'RECEIVABLE'}])expect(compatibleAdvance(a,{...o,...change})).toBe(false);expect(compatibleAdvance({...a,obligation_type:'CUSTOMER_ADVANCE'},{...o,obligation_type:'RECEIVABLE'})).toBe(true);});
 it('does not accept base amounts, approval flags or more than four amount decimals from client',()=>{const c={action:'RECORD',request_id:id,side:'SUPPLIER_ADVANCE',counterparty_id:id,account_id:id,entity_id:null,amount:100,exchange_rate:1,date:'2026-10-14',reference:'ADV-1',description:'Advance'};expect(advanceCommandSchema.safeParse(c).success).toBe(true);for(const change of [{base_amount:100},{approved:true},{amount:1.12345},{amount:NaN},{counterparty_id:''}])expect(advanceCommandSchema.safeParse({...c,...change}).success).toBe(false);});
});

import {filterAdvanceParties} from './advances';
it('filters by actual party role and shared classification while allowing an explicit all-parties view',()=>{
 const types=[{id:'asset',code:'ASSET_SUPPLIER',name_ar:'مورد أصول',name_en:'Asset supplier'},{id:'employee',code:'EMPLOYEE',name_ar:'موظف',name_en:'Employee'}];
 const parties=[{id:'s',party_type:'SUPPLIER'},{id:'c',party_type:'CUSTOMER'},{id:'b',party_type:'BOTH'},{id:'a',party_type:'OTHER',party_type_id:'asset'},{id:'e',party_type:'OTHER',party_type_id:'employee'}];
 expect(filterAdvanceParties(parties,types,'SUPPLIER_ADVANCE').map(p=>p.id)).toEqual(['s','b','a']);
 expect(filterAdvanceParties(parties,types,'CUSTOMER_ADVANCE').map(p=>p.id)).toEqual(['c','b']);
 expect(filterAdvanceParties(parties,types,'SUPPLIER_ADVANCE','ASSET_SUPPLIER').map(p=>p.id)).toEqual(['a']);
 expect(filterAdvanceParties(parties,types,'SUPPLIER_ADVANCE','',true)).toEqual(parties);
 expect(filterAdvanceParties(parties,types,'SUPPLIER_ADVANCE','EMPLOYEE',true).map(p=>p.id)).toEqual(['e']);
});
