import {describe,it,expect} from 'vitest';
import {platformLiquiditySummary} from '../lib/platform-liquidity-summary';

describe('main dashboard liquidity indicators',()=>{
  it('uses available cash, obligation balances and module forecasts without internal transfer duplication',()=>{
    const result=platformLiquiditySummary({accounts:[{current_balance_base:1000,restricted_balance_base:100,uncleared_balance_base:50}],counterparty_balances:[{receivable_balance:400,payable_balance:300,overdue_payable:25}],flows:[
      {direction:'INFLOW',due_date:'2026-10-12',status:'EXPECTED',base_amount:200},
      {direction:'OUTFLOW',due_date:'2026-10-13',status:'CONFIRMED',base_amount:100},
      {direction:'OUTFLOW',due_date:'2026-10-13',status:'ACTUAL',base_amount:999},
      {direction:'OUTFLOW',due_date:'2026-10-14',status:'EXPECTED',transfer_id:'t',base_amount:500},
      {direction:'INFLOW',due_date:'2027-03-01',status:'EXPECTED',base_amount:900},
    ]},'2026-10-11');
    expect(result).toMatchObject({available:850,receivables:400,payables:300,overduePayables:25,forecastIn:200,forecastOut:100,lowest:850});
  });
  it('keeps empty module balances at zero',()=>{
    expect(platformLiquiditySummary({accounts:[],flows:[],counterparty_balances:[]},'2026-10-11')).toMatchObject({available:0,payables:0,forecastIn:0,forecastOut:0,lowest:0});
  });
});
