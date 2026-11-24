import {describe,expect,it} from 'vitest';
import {createStudy,defaultLegalItems} from './engine';
import {createIndustrialStarter} from './project-templates';
import {emptyAdvanced} from './advanced-model';
import {handoffReadiness,handoffSetupPath} from './handoff';

function readyStudy(){
 const s=createStudy('study-1','Water factory');
 s.country='سوريا';s.currency='USD';
 s.status='APPROVED';
 s.capex=[{id:'plant',label:'Plant',amount:100000,category:'EQUIPMENT'}];
 s.investorEquity=100000;s.monthlyUnits=10000;s.unitPrice=2;s.variableCost=1;
 s.legal=s.legal.map(x=>defaultLegalItems.slice(0,3).some(y=>y===x.title)?{...x,status:'VERIFIED'}:x);
 return s;
}
describe('project company handoff preflight',()=>{
 it('does not authorize a newly created or unapproved study',()=>{
  const s=createStudy('a','Draft');
  expect(handoffReadiness(s).ready).toBe(false);
 });
 it('does not mark funding balanced in a new dairy template with missing model inputs',()=>{
  const s=createIndustrialStarter('dairy','Dairy','DAIRY_CHEESE');
  const hasBalancedFunding=()=>handoffReadiness(s).checks.find(check=>check.key==='finance')?.passed;

  expect(hasBalancedFunding()).toBe(false);
  s.capex[0].amount=1000;
  s.investorEquity=1000;
  expect(hasBalancedFunding()).toBe(false);
  s.monthlyUnits=100;
  s.unitPrice=20;
  expect(hasBalancedFunding()).toBe(true);
 });
 it('accepts a locally reviewed, funded, preliminarily verified study',()=>{
  expect(handoffReadiness(readyStudy()).ready).toBe(true);
 });
 it('rejects uncovered cash need, legal blockers and missing critical checks',()=>{
  const s=readyStudy();s.investorEquity=200;
  expect(handoffReadiness(s).checks.find(x=>x.key==='finance')?.passed).toBe(false);
  s.investorEquity=100000;
  s.legal[0].status='BLOCKED';
  expect(handoffReadiness(s).ready).toBe(false);
 });
 it('blocks handoff until a country and study currency are explicitly selected',()=>{
  const s=readyStudy();s.country='';expect(handoffReadiness(s).checks.find(x=>x.key==='identity')?.passed).toBe(false);
  s.country='Saudi Arabia';s.currency='';expect(handoffReadiness(s).ready).toBe(false);
 });
 it('rejects unallocated excess investment funding, not just shortfalls',()=>{
  const s=readyStudy();
  s.investorEquity=100001;
  expect(handoffReadiness(s).checks.find(x=>x.key==='finance')?.passed).toBe(false);
  expect(handoffReadiness(s).ready).toBe(false);
  s.investorEquity=100000;
  expect(handoffReadiness(s).ready).toBe(true);
 });
 it('uses the advanced cash requirement instead of the simplified balance when advanced inputs exist',()=>{
  const s=readyStudy();
  s.advanced={...emptyAdvanced(),lives:{...emptyAdvanced().lives,EQUIPMENT:10},contingencyPct:10};
  const unfunded=handoffReadiness(s);
  expect(unfunded.ready).toBe(false);
  expect(unfunded.checks.find(x=>x.key==='finance')?.passed).toBe(false);
  expect(unfunded.checks.find(x=>x.key==='advanced-FUNDING_GAP')).toMatchObject({
   passed:false,ar:expect.stringContaining('نقص تمويل'),en:expect.stringContaining('Funding gap')
  });
  s.investorEquity=110000;
  expect(handoffReadiness(s).ready).toBe(true);
 });
 it('shows missing debt terms even when simplified cash funding balances',()=>{
  const s=readyStudy();
  s.advanced={...emptyAdvanced(),lives:{...emptyAdvanced().lives,EQUIPMENT:10}};
  s.investorEquity=50000;s.investorLoan=50000;
  const review=handoffReadiness(s);
  expect(review.checks.find(x=>x.key==='model')?.passed).toBe(false);
  expect(review.checks.find(x=>x.key==='advanced-DEBT_TERM_MISSING')?.passed).toBe(false);
  s.advanced.debtYears=1;
  expect(handoffReadiness(s).ready).toBe(true);
 });
 it('checks recorded operational risks and blocked high-priority tasks for general studies',()=>{
  const s=readyStudy();
  s.risks=[{id:'permit',title:'Permit',response:'',impact:5,likelihood:3,status:'MITIGATED'}];
  s.tasks=[{id:'permit-task',title:'File permit',due:'',owner:'',priority:'HIGH',status:'BLOCKED'}];
  const review=handoffReadiness(s);
  expect(review.checks.find(x=>x.key==='risk')?.passed).toBe(false);
  expect(review.checks.find(x=>x.key==='execution')?.passed).toBe(false);
  s.risks[0].response='Verified permit route and owner';
  s.tasks[0].status='DONE';
  expect(handoffReadiness(s).ready).toBe(true);
 });
 it('requires evidence for the sector-specific critical licences in new dairy studies',()=>{
  const starter=createIndustrialStarter('dairy','Dairy','DAIRY_CHEESE');
  const requirements=starter.legal.filter(x=>x.critical);
  expect(requirements).toHaveLength(3);
  const s=readyStudy();s.legal.push(...requirements);
  const passed=()=>handoffReadiness(s).checks.find(x=>x.key==='legal')?.passed;
  expect(passed()).toBe(false);
  for(const item of requirements)item.status='VERIFIED';
  expect(passed()).toBe(false);
  for(const item of requirements)item.notes='Synthetic permit reference';
  expect(passed()).toBe(true);
 });
 it('generates only allowlisted organization V2 setup paths',()=>{
  const id='6357a708-bae2-4634-9296-490404b1d8a4';
  expect(handoffSetupPath('ar',id,[id])).toBe('/ar/settings/financial/setup?organization='+id);
  expect(handoffSetupPath('ar',id,[])).toBeNull();
  expect(handoffSetupPath('xx',id,[id])).toBeNull();
  expect(handoffSetupPath('ar','../../external',['../../external'])).toBeNull();
 });
});
