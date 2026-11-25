import {expect,it} from 'vitest';
import base from './financial-reporting/statement-snapshot.json';
import {normalizeStatementSource} from '../lib/financial-statement-source';
import {annualOpening} from '../lib/financial-fiscal';

it('carries net income and open balances once after accrual, settlement, adjustment and reversal',()=>{
 const raw=structuredClone(base);
 const expense=raw.events.find(e=>e.sourceKey==='invoice')!;
 const adjustment={...expense,id:'adjustment',sourceKey:'adjustment',status:'REVERSED',
  date:'2026-11-01',lines:[{...expense.lines[0],id:'adjustment-line',baseAmount:'25'}]};
 const reversal={...adjustment,id:'reversal',sourceKey:'reversal',status:'ACTUAL',
  date:'2026-12-01',reversesEventId:adjustment.id,
  lines:[{...adjustment.lines[0],id:'reversal-line',recognitionSign:-1}]};
 raw.events.push(adjustment,reversal);
 raw.coverage.eventCount+=2;
 raw.coverage.lineCount+=2;
 raw.accounts.push({...raw.accounts.find(a=>a.id==='capital')!,id:'retained'});
 const query={organization:raw.organizationId,from:raw.from,to:raw.to};
 const before=normalizeStatementSource({...raw,to:'2026-11-30'},{...query,to:'2026-11-30'});
 expect(before.statements.income.netProfit).toBe('75.0000');
 const closed=normalizeStatementSource(raw,query);
 expect(closed.statements.income.netProfit).toBe('100.0000');
 expect(closed.statements.cash.closing).toBe('575.0000');
 const calendar={startMonth:1,startDay:1,retainedEarningsAccount:'retained'};
 const rollover=annualOpening(closed,calendar);
 expect(rollover.nextOpening.find(row=>row.accountId==='retained')?.credit).toBe('100.0000');
 expect(rollover.nextOpening.some(row=>['revenue','opex'].includes(row.accountId))).toBe(false);
 const next={...raw,opening:rollover.nextOpening,openingDate:raw.to,fiscalStart:rollover.period.nextStart,
  from:rollover.period.nextStart,to:'2027-12-31',events:[],openingSourceId:'synthetic-closure-2026',
  coverage:{...raw.coverage,eventCount:0,lineCount:0}};
 const reopened=normalizeStatementSource(next,{organization:raw.organizationId,from:next.from,to:next.to});
 expect(reopened.statements.income.netProfit).toBe('0.0000');
 expect(reopened.statements.cash.opening).toBe(closed.statements.cash.closing);
 expect(reopened.statements.position.assets).toBe(closed.statements.position.assets);
 expect(annualOpening(reopened,calendar).nextOpening).toEqual(rollover.nextOpening);
});
