import {describe,it,expect} from 'vitest';
import {previewSourceBoundGroupEliminations} from '../lib/financial-group-source-bound-adjustments';
import {sourceBoundGroupFixture} from './financial-reporting/group-source-bound-fixture';
function fixture(){
 const f=sourceBoundGroupFixture();
 for(const [i,p] of f.sources.entries()){
  p.events[0].lines[0].baseAmount='50.0000';
  p.policy.rules[0].debitAccountId=i===0?'160001':'110001';
  p.policy.rules[0].creditAccountId=i===0?'210001':'310001';
 }
 f.entry={...f.entry,kind:'CAPITAL_CONTRIBUTION',debitSource:f.ref(1,'310001'),creditSource:f.ref(0,'160001')};
 return f;
}
describe('documented capital contribution worksheet',()=>{
 it('eliminates only contributed capital and parent investment without changing company sources',()=>{
  const f=fixture(),original=structuredClone(f.sources),r=previewSourceBoundGroupEliminations(f.control,f.sources,[f.entry]);
  expect(r.worksheet.rows.find(x=>x.reportingCode==='1600')?.afterNetDebit).toBe('0.0000');
  const capital=r.worksheet.rows.find(x=>x.reportingCode==='3100')!;
  expect(capital.adjustmentDebit).toBe('50.0000');expect(capital.afterNetDebit).toBe('-1000.0000');
  expect(r.worksheet.closingDebit).toBe(r.worksheet.closingCredit);expect(f.sources).toEqual(original);
 });
 it('refuses sibling, reversed ownership direction and partial ownership',()=>{
  for(const change of[(f:ReturnType<typeof fixture>)=>{f.entry.debitSource.organizationId=f.entry.creditSource.organizationId},(f:ReturnType<typeof fixture>)=>{const r=f.control.relationships[0];[r.parentOrganizationId,r.subsidiaryOrganizationId]=[r.subsidiaryOrganizationId,r.parentOrganizationId]},(f:ReturnType<typeof fixture>)=>{f.control.relationships[0].directEconomicInterestPercent='80'}]){
   const f=fixture();change(f);expect(()=>previewSourceBoundGroupEliminations(f.control,f.sources,[f.entry])).toThrow(/GROUP_(CAPITAL_CONTROL_UNSUPPORTED|CONTROL_HIERARCHY_INVALID|ADJUSTMENT_MEMBERSHIP_INVALID)/);
  }
 });
 it('does not substitute reserves or retained earnings for contributed capital',()=>{
  const f=fixture();f.sources[1].policy.rules[0].creditAccountId='320001';f.entry.debitSource.accountId='320001';
  expect(()=>previewSourceBoundGroupEliminations(f.control,f.sources,[f.entry])).toThrow('GROUP_CAPITAL_ACCOUNT_INVALID');
 });
 it('requires acquisition evidence for a contribution before the approved control date',()=>{
  const f=fixture();f.sources.forEach(s=>s.from='2026-04-01');f.control.from='2026-04-01';f.control.relationships[0].effectiveFrom='2026-04-01';
  expect(()=>previewSourceBoundGroupEliminations(f.control,f.sources,[f.entry])).toThrow('GROUP_CAPITAL_ACQUISITION_EVIDENCE_REQUIRED');
 });
 it('rejects excess, duplicate and non-closing adjustments',()=>{
  const f=fixture();expect(()=>previewSourceBoundGroupEliminations(f.control,f.sources,[{...f.entry,amount:'51'}])).toThrow('GROUP_ADJUSTMENT_EXCEEDS_DETAIL_SOURCE');
  expect(()=>previewSourceBoundGroupEliminations(f.control,f.sources,[f.entry,{...f.entry,id:'20000000-0000-4000-8000-000000000007'}])).toThrow('GROUP_ADJUSTMENT_EXCEEDS_DETAIL_SOURCE');
  expect(()=>previewSourceBoundGroupEliminations(f.control,f.sources,[{...f.entry,date:'2026-11-01'}])).toThrow('GROUP_CAPITAL_CLOSING_DATE_REQUIRED');
 });
});
