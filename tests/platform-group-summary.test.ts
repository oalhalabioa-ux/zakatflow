import {describe,it,expect} from 'vitest';
import {platformGroupCash,platformGroupCurrencyKnown,platformGroupVat} from '../lib/platform-group-summary';
import {platformLiquiditySummary} from '../lib/platform-liquidity-summary';

const tax=(taxPayable:number,taxCredit:number,from='2026-10-01')=>({period:{from,to:'2026-12-31'},profile:{},periodTotals:{salesBase:1000,outputTax:150,inputTax:50,taxPayable,taxCredit,paidAmount:20}});
describe('dashboard company and subsidiary scope',()=>{
 it('sums tax payables separately from another taxpayer’s credit',()=>{
  expect(platformGroupVat([tax(100,0),tax(0,40)])?.totals).toMatchObject({salesBase:'2000.00',taxPayable:'100.00',taxCredit:'40.00',paidAmount:'40.00'});
 });
 it('does not combine unavailable or different tax periods',()=>{
  expect(platformGroupVat([tax(100,0),null])).toBeNull();
  expect(platformGroupVat([tax(100,0),tax(0,40,'2026-11-01')])).toBeNull();
 });
 it('requires a common base currency for monetary aggregation',()=>{
  expect(platformGroupCurrencyKnown([{base_currency:'SAR'},{base_currency:'SAR'}],'SAR')).toBe(true);
  expect(platformGroupCurrencyKnown([{base_currency:'SAR'},{base_currency:'USD'}],'SAR')).toBe(false);
 });
 it('recomputes the group cash forecast and ignores internal transfers',()=>{
  const a={accounts:[{current_balance_base:1000}],counterparty_balances:[{payable_balance:100}],flows:[{direction:'OUTFLOW',due_date:'2026-10-12',status:'EXPECTED',base_amount:500}]};
  const b={accounts:[{current_balance_base:1000}],counterparty_balances:[{payable_balance:200}],flows:[{direction:'INFLOW',due_date:'2026-10-12',status:'EXPECTED',base_amount:500},{direction:'OUTFLOW',due_date:'2026-10-12',status:'EXPECTED',base_amount:900,transfer_id:'internal'}]};
  const combined=platformGroupCash([a,b]);
  expect(combined?.accounts).toHaveLength(2);
  expect(platformLiquiditySummary(combined,'2026-10-11')).toMatchObject({available:2000,payables:300,forecastIn:500,forecastOut:500,lowest:2000});
  expect(platformGroupCash([a,null])).toBeNull();
 });
});
