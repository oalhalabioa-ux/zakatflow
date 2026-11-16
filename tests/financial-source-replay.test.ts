import {describe,it,expect} from 'vitest';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';

const original=()=>({
 origin:'LIVE_CANONICAL_EVENTS',
 organizationId:'10000000-0000-4000-8000-000000000001',
 readAt:'2026-11-07T10:00:00Z',
 coverage:{readAt:'2026-11-07T10:00:00Z',complete:true,eventCount:2,lineCount:2},
 events:[
  {id:'a',lines:[{id:'a-1',baseAmount:'50.0000',cashDirection:'INFLOW'}]},
  {id:'b',lines:[{id:'b-1',baseAmount:'35.0000',cashDirection:'NON_CASH'}]},
 ],
 opening:[{accountId:'cash',debit:'5.0000',credit:'0.0000'}],
 policy:{rules:[{id:'r',accountId:'cash',from:'2026-01-01',to:'2026-12-31'}]},
 controls:{cashClosing:'55.0000'},
});
describe('live statement source replay race detector (not an atomic ledger attestation)',()=>{
 it('accepts identical accounting contents with changed server timestamps and JSON aggregate ordering',()=>{
  const first=original(),next=structuredClone(first);
  next.readAt='2026-11-07T10:02:00Z';
  next.coverage.readAt='2026-11-07T10:02:00Z';
  next.events.reverse();
  expect(()=>assertStableFinancialReplay(first,next)).not.toThrow();
 });
 it('rejects changed original amounts, missing or duplicated source rows',()=>{
  const a=original(),b=structuredClone(a);
  b.events[0].lines[0].baseAmount='51.0000';
  expect(()=>assertStableFinancialReplay(a,b)).toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');
  b.events=structuredClone(a.events.slice(0,1));
  expect(()=>assertStableFinancialReplay(a,b)).toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');
  b.events=[...structuredClone(a.events),structuredClone(a.events[0])];
  expect(()=>assertStableFinancialReplay(a,b)).toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');
 });
 it('rejects changed opening balances, posting policy or cash reconciliation',()=>{
  const a=original(),b=structuredClone(a);
  b.opening[0].debit='6.0000';
  expect(()=>assertStableFinancialReplay(a,b)).toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');
  b.opening[0].debit='5.0000';b.policy.rules[0].accountId='payable';
  expect(()=>assertStableFinancialReplay(a,b)).toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');
  b.policy.rules[0].accountId='cash';b.controls.cashClosing='60.0000';
  expect(()=>assertStableFinancialReplay(a,b)).toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');
 });
 it('rejects missing or non-JSON snapshots instead of treating them as empty',()=>{
  expect(()=>assertStableFinancialReplay(original(),null)).toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');
  expect(()=>assertStableFinancialReplay([],[])).toThrow('REPORTING_SOURCE_CHANGED_DURING_VERIFICATION');
 });
});
