import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fiscalPeriod,annualOpening} from '../lib/financial-fiscal';
import {normalizeStatementSource} from '../lib/financial-statement-source';
describe('Organization fiscal rules',()=>{
 it.each([
  [1,1,'2024-12-31','2024-01-01','2024-12-31','2025-01-01'],
  [7,1,'2026-11-04','2026-07-01','2027-06-30','2027-07-01'],
  [7,1,'2026-06-30','2025-07-01','2026-06-30','2026-07-01'],
  [4,1,'2025-02-01','2024-04-01','2025-03-31','2025-04-01'],
  [4,1,'2025-04-01','2025-04-01','2026-03-31','2026-04-01'],
  [2,29,'2025-03-01','2025-02-28','2026-02-27','2026-02-28'],
  [2,29,'2024-02-29','2024-02-29','2025-02-27','2025-02-28'],
  [12,31,'2024-01-01','2023-12-31','2024-12-30','2024-12-31'],
 ])('resolves %s/%s at %s', (startMonth,startDay,asOf,start,end,nextStart)=>{
  expect(fiscalPeriod({startMonth:Number(startMonth),startDay:Number(startDay),retainedEarningsAccount:'3300'},String(asOf))).toEqual({start,end,nextStart});
 });
 it('rejects impossible dates and incomplete calendar configuration',()=>{
  expect(()=>fiscalPeriod({startMonth:0,startDay:1,retainedEarningsAccount:'3300'},'2024-01-01')).toThrow('FISCAL_CALENDAR_INVALID');
  expect(()=>fiscalPeriod({startMonth:1,startDay:1,retainedEarningsAccount:'3300'},'2024-02-30')).toThrow('FISCAL_DATE_INVALID');
 });
});
const evidencePath=process.env.FISCAL_QA_EVIDENCE;
describe.runIf(!!evidencePath)('Actual independent organization database closes',()=>{
 it('matches the database close and retained earnings to the existing statement compiler',()=>{
  const evidence=JSON.parse(readFileSync(evidencePath!,'utf8'));
  expect(evidence.checks.every((check:{passed:boolean})=>check.passed)).toBe(true);
  expect(evidence.snapshots).toHaveLength(2);
  for(const {payload} of evidence.snapshots){
   const raw=payload.source;
   const compiled=normalizeStatementSource(raw,{organization:raw.organizationId,from:raw.from,to:raw.to});
   const rollover=annualOpening(compiled,{startMonth:Number(raw.fiscalStart.slice(5,7)),startDay:1,retainedEarningsAccount:'3300'});
   expect(compiled.statements.income.netProfit).toBe('70.0000');
   expect(compiled.statements.cash).toMatchObject({opening:'500.0000',operating:'70.0000',investing:'-60.0000',closing:'510.0000'});
   expect(compiled.statements.position).toMatchObject({assets:'710.0000',equity:'710.0000'});
   expect(rollover.nextOpening).toEqual(payload.closure.next_opening);
   for(const account of compiled.accounts){
    expect(payload.trial.trialBalance.find((row:{accountId:string})=>row.accountId===account.id).closing).toBe(account.balance);
   }
  }
 });
});
