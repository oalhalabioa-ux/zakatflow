import {describe,it,expect} from 'vitest';
import {financialSignals} from '../lib/yaqeen-financial-signals';
const context={scope:'ORGANIZATION',organizationIds:['org'],today:'2026-10-19',ar:true,locale:'ar'};
const deposit=(id:string,status='ACTIVE',currency='SAR',org='org')=>({id,status,terms:{ownership_scope:'ORGANIZATION',organization_id:org,instrument:'DEPOSIT',currency,principal:1000,maturity_date:'2026-11-01'},projection:{coupon:50}});
describe('dashboard investment and financing facts',()=>{
 it('excludes drafts/other companies, separates currencies and actual receipts from estimates',()=>{
  const rows=financialSignals({...context,loans:null,investments:{contracts:[deposit('a'),deposit('b','DRAFT'),deposit('c','ACTIVE','USD'),deposit('x','ACTIVE','SAR','other')],operations:[{contract_id:'a',kind:'INCOME',status:'POSTED',amount:20},{contract_id:'a',kind:'INCOME',status:'PREPARED',amount:90},{contract_id:'a',kind:'INCOME',status:'POSTED',settlement_status:'REVERSED',amount:80}]}});
  expect(rows.find(r=>r.id==='deposits:SAR')?.value).toBe(1000);
  expect(rows.find(r=>r.id==='deposits:USD')?.value).toBe(1000);
  expect(rows.find(r=>r.id==='deposit-estimate:SAR')?.value).toBe(50);
  expect(rows.find(r=>r.id==='deposit-received:SAR')?.value).toBe(20);
  expect(rows.find(r=>r.id==='deposit-maturity:SAR')?.value).toBe(1000);
 });
 it('uses outstanding obligation balances and correct installment dates, not principal or drafts',()=>{
  const loan={status:'ACTUAL',side:'PAYABLE',currency:'USD',schedule:[{due_date:'2026-10-01'},{due_date:'2026-11-01'},{due_date:'2027-01-01'}],installments:[{obligation_key:'installment:1',outstanding_base_amount:10,base_currency:'SAR'},{obligation_key:'installment:2',outstanding_base_amount:20,base_currency:'SAR'},{obligation_key:'installment:3',outstanding_base_amount:30,base_currency:'SAR'}]};
  const rows=financialSignals({...context,investments:null,loans:{contracts:[loan,{...loan,status:'COMMITTED'}]}});
  expect(rows.find(r=>r.id==='loan-PAYABLE:SAR')?.value).toBe(60);
  expect(rows.find(r=>r.id==='loan-due-PAYABLE:SAR')?.value).toBe(20);
  expect(rows.find(r=>r.id==='loan-overdue-PAYABLE:SAR')?.value).toBe(10);
 });
 it('does not turn a failed source into zero or leak institutional investments into personal scope',()=>{
  expect(financialSignals({...context,investments:null,loans:null})).toEqual([]);
  expect(financialSignals({...context,scope:'PERSONAL',investments:{contracts:[deposit('a')],operations:[]},loans:null})).toEqual([]);
 });
 it('keeps personal loan balances distinct from unrelated personal debts',()=>{
  const rows=financialSignals({...context,scope:'PERSONAL',investments:null,loans:null,personalDebts:[{side:'PAYABLE',category:'P_AP_LOAN',currency:'SAR',amount:500,dueDate:'2026-11-01'},{side:'PAYABLE',category:'P_AP_OTHER',currency:'SAR',amount:900,dueDate:'2026-11-01'}]});
  expect(rows.find(r=>r.id==='personal-loan-PAYABLE:SAR')?.value).toBe(500);
 });
});
