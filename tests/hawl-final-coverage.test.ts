import {calculateAssessment} from '../engine/assessment';
import {describe,it,expect} from 'vitest';
import {nextUnassessedHawlPeriod} from '../engine/hawl';
import {zakatLiabilitySummary} from '../lib/zakat-liability-summary';

describe('final annual coverage',()=>{
 it('does not reprice a finalized annual period in the next monthly assessment',()=>{
  const p=nextUnassessedHawlPeriod('HIJRI_TABULAR','2025-01-01','2026-03-05','2026-10-10');
  expect(p.hawlDueDate).toBe('2026-12-11');expect(p.completed).toBe(false);
 });
 it('includes a newly matured lot without advancing it on an open revision',()=>{
  expect(nextUnassessedHawlPeriod('HIJRI_TABULAR','2025-04-01',null,'2026-03-20').completed).toBe(false);
  const p=nextUnassessedHawlPeriod('HIJRI_TABULAR','2025-04-01',null,'2026-03-21');
  expect(p.completed).toBe(true);expect(p.hawlPeriod).toBe(1);
  expect(nextUnassessedHawlPeriod('HIJRI_TABULAR','2025-04-01',null,'2026-04-20').hawlPeriod).toBe(1);
 });
 it('includes an old lot again only after its next annual maturity',()=>{
  expect(nextUnassessedHawlPeriod('HIJRI_TABULAR','2025-01-01','2026-03-05','2026-12-11').completed).toBe(true);
 });
 it('honors Gregorian leap dates and advances a period exactly on the final boundary',()=>{
  const p=nextUnassessedHawlPeriod('GREGORIAN','2024-02-29','2025-02-28','2026-02-27');
  expect(p.hawlStartDate).toBe('2025-02-28');expect(p.hawlDueDate).toBe('2026-02-28');expect(p.completed).toBe(false);
 });
});
describe('cumulative indicators',()=>{
 const cycles=[{id:'c1',status:'CLOSED',final_assessment_id:'a1',final_zakat_due:45000},{id:'c2',status:'ACTIVE',assessment_id:'a3'}];
 const assessments=[{id:'a1',zakat_due:45000,status:'CALCULATED'},{id:'a2',zakat_due:6000,status:'CALCULATED',superseded_by:'a3'},{id:'a3',zakat_due:7000,status:'CALCULATED'}];
 it('shows 45,000 + 7,000 = 52,000 without adding superseded calculations',()=>{
  const s=zakatLiabilitySummary(cycles,assessments,[],[]);expect(s.asOf.toString()).toBe('52000');expect(s.finalRemaining.toString()).toBe('45000');
 });
 it('subtracts posted payments once and shows carried credit separately until finalization',()=>{
  const s=zakatLiabilitySummary(cycles,assessments,[{hawl_cycle_id:'c1',assessment_id:'a1',allocated_amount:45000}],[{base_amount:48000}]);
  expect(s.asOf.toString()).toBe('7000');expect(s.credit.toString()).toBe('3000');expect(s.afterCredit.toString()).toBe('4000');
 });
 it('does not count a finalized current cycle twice or deduct applied credit twice',()=>{
  const s=zakatLiabilitySummary([cycles[0],{id:'c2',status:'CLOSED',assessment_id:'a3',final_assessment_id:'a3',final_zakat_due:7000}],assessments,[{hawl_cycle_id:'c1',assessment_id:'a1',allocated_amount:45000},{hawl_cycle_id:'c2',assessment_id:'a3',allocated_amount:3000}],[{base_amount:48000}]);
  expect(s.finalRemaining.toString()).toBe('4000');expect(s.asOf.toString()).toBe('4000');expect(s.credit.toString()).toBe('0');
 });
 it('does not let an open stale revision or historically settled cycle reappear',()=>{
  const s=zakatLiabilitySummary([{...cycles[0],snapshot:{historical_settled:true}},{...cycles[1],assessment_id:'a2'}],assessments,[],[]);
  expect(s.asOf.toString()).toBe('0');
 });
});

describe('continuing portfolio Nisab',()=>{it('does not erase a small newly matured lot when the continuing portfolio is above Nisab',()=>{const result=calculateAssessment([{lotId:'new',marketValueBase:3000,hawlCompleted:true},{lotId:'previous-final',marketValueBase:100000,hawlCompleted:false}],4000,0.025,103000);expect(result.zakatDue.toString()).toBe('75');expect(result.lines[1].zakatAmount.toString()).toBe('0')})});
