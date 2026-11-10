import {describe,it,expect} from 'vitest';
import {createStudy} from './engine';
import {evaluateAdvanced,emptyAdvanced,illustratedLives} from './advanced-model';
function sample(){
 const s=createStudy('factory','Example');
 s.capex=[{id:'equip',label:'Equipment',category:'EQUIPMENT',amount:120000}];
 s.monthlyUnits=10000;s.unitPrice=2;s.variableCost=1;s.monthlyFixedCost=3000;
 s.years=2;s.discountRatePct=10;s.indicativeTaxRatePct=20;
 s.advanced={...emptyAdvanced(),lives:{...emptyAdvanced().lives,EQUIPMENT:2}};
 return s;
}
describe('standalone optional advanced DCF',()=>{
 it('never fabricates depreciation from absent useful lives',()=>{
  const s=sample();s.advanced=undefined;
  const r=evaluateAdvanced(s);
  expect(r.ready).toBe(false);expect(r.projectNpv).toBeNull();
  expect(r.blockers).toContain('USEFUL_LIVES_MISSING');
 });
 it('taxes indicative EBIT but never pays cash depreciation',()=>{
  const s=sample();s.workingCapital=10000;s.advanced!.terminalCash=20000;
  const r=evaluateAdvanced(s);
  expect(r.ready).toBe(true);
  expect(r.annual[0].ebitda).toBe(84000);
  expect(r.annual[0].depreciation).toBe(60000);
  expect(r.annual[0].ebit).toBe(24000);
  expect(r.annual[0].tax).toBe(4800);
  expect(r.projectFlows).toEqual([-130000,79200,109200]);
  expect(r.projectNpv).toBeCloseTo(-130000+79200/1.1+109200/1.21);
 });
 it('models equal principal and declining interest separately from unlevered cashflows',()=>{
  const s=sample();s.investorEquity=60000;s.investorLoan=60000;
  s.advanced!.debtRatePct=10;s.advanced!.debtYears=2;
  const r=evaluateAdvanced(s);
  expect(r.equityReady).toBe(true);
  expect(r.annual.map(y=>y.principal)).toEqual([30000,30000]);
  expect(r.annual.map(y=>y.interest)).toEqual([6000,3000]);
  expect(r.annual[1].debtBalance).toBe(0);
  expect(r.equityFlows[0]).toBe(-60000);
  expect(r.projectFlows[0]).toBe(-120000);
 });
 it('blocks equity returns when contributed cash differs from project cash need',()=>{
  const s=sample();s.investorEquity=1000;
  const r=evaluateAdvanced(s);
  expect(r.ready).toBe(true);expect(r.equityReady).toBe(false);
  expect(r.equityBlockers).toContain('FUNDING_GAP');
  expect(r.equityIrr).toBeNull();
 });
 it('includes transferred land as economic contribution, not spendable cash',()=>{
  const s=sample();s.landValue=30000;s.landTransferred=true;s.investorEquity=120000;
  const r=evaluateAdvanced(s);
  expect(r.equityReady).toBe(true);expect(r.cashNeed).toBe(120000);
  expect(r.initialInvestment).toBe(150000);expect(r.equityFlows[0]).toBe(-150000);
 });
 it('uses sellable capacity not nameplate production, retaining scenario multipliers',()=>{
  const s=sample();Object.assign(s.advanced!,{mode:'CAPACITY',capacityMonthly:20000,utilisationPct:50,saleablePct:80});
  expect(evaluateAdvanced(s).monthlyVolume).toBe(8000);
  expect(evaluateAdvanced(s).annual[0].volume).toBe(96000);
  expect(evaluateAdvanced(s,'CONSERVATIVE').annual[0].volume).toBeCloseTo(67200);
 });
 it('refuses debt maturity outside forecast and invalid rates',()=>{
  const s=sample();s.investorLoan=10000;s.advanced!.debtYears=3;
  expect(evaluateAdvanced(s).blockers).toContain('DEBT_EXCEEDS_HORIZON');
  s.investorLoan=0;s.advanced!.debtYears=0;s.advanced!.utilisationPct=150;
  expect(evaluateAdvanced(s).blockers).toContain('INVALID_ASSUMPTIONS');
 });
 it('keeps illustrative lives opt-in and old study assumptions compatible',()=>{
  expect(illustratedLives.EQUIPMENT).toBe(10);
  expect(createStudy('old','Old study').advanced).toBeUndefined();
 });
});

describe('working-capital and CAPEX risk sensitivities',()=>{
 it('defaults to the original manual working-capital schedule for older saved studies',()=>{
  const s=sample();s.workingCapital=10000;
  const r=evaluateAdvanced(s);
  expect(r.ready).toBe(true);
  expect(r.initialInvestment).toBe(130000);
  expect(r.annual.map(x=>x.workingCapitalMovement)).toEqual([0,-10000]);
  expect(r.projectFlows).toEqual([-130000,79200,89200]);
 });
 it('rolls forward scenario-sensitive receivables and inventory, releasing only the final balance',()=>{
  const s=sample();s.volumeGrowthPct=10;s.investorEquity=0;s.workingCapital=50000;
  s.advanced!.workingCapitalPolicy={mode:'DAYS',receivableDays:30,inventoryDays:20,payableDays:10};
  const result=evaluateAdvanced(s);
  const wc1=(240000*30+120000*10)/365,wc2=wc1*1.1;
  expect(result.ready).toBe(true);
  expect(result.openingWorkingCapital).toBeCloseTo(wc1);
  expect(result.initialInvestment).toBeCloseTo(120000+wc1);
  expect(result.annual[0].workingCapitalMovement).toBeCloseTo(wc2-wc1);
  expect(result.annual[1].workingCapitalMovement).toBeCloseTo(-wc2);
  expect(result.projectFlows[0]).toBeCloseTo(-120000-wc1);
  expect(result.annual[0].fcf).toBeCloseTo(79200-(wc2-wc1));
  expect(result.annual[1].fcf).toBeCloseTo(105600-7200+wc2);
 });
 it('does not silently turn negative supplier credit into operating cash',()=>{
  const s=sample();s.advanced!.workingCapitalPolicy={mode:'DAYS',receivableDays:0,inventoryDays:0,payableDays:200};
  const r=evaluateAdvanced(s);
  expect(r.ready).toBe(false);
  expect(r.blockers).toContain('NEGATIVE_WORKING_CAPITAL');
  expect(r.projectNpv).toBeNull();
 });
 it('models contingency in initial cash need without inventing additional depreciable assets',()=>{
  const s=sample();s.advanced!.contingencyPct=10;s.investorEquity=132000;
  const r=evaluateAdvanced(s);
  expect(r.ready).toBe(true);expect(r.equityReady).toBe(true);
  expect(r.contingency).toBe(12000);
  expect(r.cashNeed).toBe(132000);
  expect(r.initialInvestment).toBe(132000);
  expect(r.annual[0].depreciation).toBe(60000);
  expect(r.projectFlows[0]).toBe(-132000);
 });
 it('validates operating-cycle inputs and contingency proportion',()=>{
  const s=sample();s.advanced!.contingencyPct=200;
  expect(evaluateAdvanced(s).blockers).toContain('INVALID_ASSUMPTIONS');
  s.advanced!.contingencyPct=0;
  s.advanced!.workingCapitalPolicy={mode:'DAYS',receivableDays:400,inventoryDays:0,payableDays:0};
  expect(evaluateAdvanced(s).blockers).toContain('INVALID_ASSUMPTIONS');
 });
});
