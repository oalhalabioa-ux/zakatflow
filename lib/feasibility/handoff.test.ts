import {describe,expect,it} from 'vitest';
import {createStudy,defaultLegalItems} from './engine';
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
 it('generates only allowlisted organization V2 setup paths',()=>{
  const id='6357a708-bae2-4634-9296-490404b1d8a4';
  expect(handoffSetupPath('ar',id,[id])).toBe('/ar/settings/financial/setup?organization='+id);
  expect(handoffSetupPath('ar',id,[])).toBeNull();
  expect(handoffSetupPath('xx',id,[id])).toBeNull();
  expect(handoffSetupPath('ar','../../external',['../../external'])).toBeNull();
 });
});
