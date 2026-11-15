import {describe,expect,it} from 'vitest';
import {createStudy,evaluateStudy,internalRateOfReturn,waterFactoryLegalItems} from './engine';

describe('independent feasibility planning engine',()=>{
 it('starts zeroed and never fabricates returns',()=>{
  const study=createStudy('a','Water factory');
  const calc=evaluateStudy(study);
  expect(calc.ready).toBe(false);
  expect(calc.npv).toBeNull();
  expect(calc.irr).toBeNull();
  expect(calc.investorShare).toBeNull();
  expect(study.legal.every(x=>x.status==='NOT_STARTED')).toBe(true);
 });
 it('keeps unrelated sectors free from factory-specific licence assumptions',()=>{
  const study=createStudy('real-estate','Real estate','REAL_ESTATE');
  expect(study.legal.some(x=>x.title.includes('مصدر المياه'))).toBe(false);
  expect(waterFactoryLegalItems.some(x=>x.includes('مصدر المياه'))).toBe(true);
 });
 it('does not count privately held land as company equity',()=>{
  const study=createStudy('b','Water factory');
  study.landValue=200000;
  study.investorEquity=600000;
  study.capex=[{id:'a',label:'Equipment',amount:600000,category:'EQUIPMENT'}];
  const without=evaluateStudy(study);
  expect(without.landAsset).toBe(0);
  expect(without.investorShare).toBe(100);
  study.landTransferred=true;
  const withLand=evaluateStudy(study);
  expect(withLand.landAsset).toBe(200000);
  expect(withLand.investorShare).toBe(75);
  expect(withLand.partnerShare).toBe(25);
  expect(withLand.totalInvestment).toBe(800000);
 });
 it('separates shareholder loans from legal equity ratios',()=>{
  const study=createStudy('c','Factory');
  study.investorEquity=400000;study.partnerCashEquity=100000;study.investorLoan=200000;
  study.capex=[{id:'a',label:'Plant',amount:700000,category:'OTHER'}];
  const calc=evaluateStudy(study);
  expect(calc.investorShare).toBe(80);
  expect(calc.cashFundingGap).toBe(0);
 });
 it('calculates cash need without using noncash land contribution as cash',()=>{
  const s=createStudy('d','Factory');s.landTransferred=true;s.landValue=300000;
  s.investorEquity=100000;s.capex=[{id:'e',label:'Equipment',amount:250000,category:'EQUIPMENT'}];
  s.workingCapital=50000;
  const r=evaluateStudy(s);
  expect(r.totalInvestment).toBe(600000);
  expect(r.cashFundingGap).toBe(200000);
 });
 it('calculates NPV, cash flows and break-even with explicit assumptions',()=>{
  const s=createStudy('e','Factory');
  s.capex=[{id:'f',label:'Equipment',amount:120000,category:'EQUIPMENT'}];
  s.monthlyUnits=10000;s.unitPrice=2;s.variableCost=1;s.monthlyFixedCost=3000;s.years=2;s.discountRatePct=10;
  const r=evaluateStudy(s);
  expect(r.ready).toBe(true);
  expect(r.annual[0].revenue).toBe(240000);
  expect(r.annual[0].ebitda).toBe(84000);
  expect(r.breakevenMonthlyUnits).toBe(3000);
  expect(r.flows).toEqual([-120000,84000,84000]);
  expect(r.npv).toBeCloseTo(-120000+84000/1.1+84000/1.21);
 });
 it('conservative scenario reduces cash flow with lower volume and higher costs',()=>{
  const s=createStudy('f','Factory');
  s.capex=[{id:'i',label:'Factory',amount:100000,category:'OTHER'}];s.monthlyUnits=20000;s.unitPrice=2;s.variableCost=1;
  expect(evaluateStudy(s,'CONSERVATIVE').annual[0].ebitda).toBeLessThan(evaluateStudy(s,'BASE').annual[0].ebitda);
 });
 it('IRR returns null when positive/negative cash flows do not both exist',()=>{
  expect(internalRateOfReturn([-100,-10,-10])).toBeNull();
  expect(internalRateOfReturn([-100,110])).toBeCloseTo(10,4);
 });
});

describe('sector-specific starter tasks for new studies only',()=>{
 it('never assumes a jurisdiction or currency, and does not show factory CAPEX for unrelated sectors',()=>{
  for(const sector of ['INDUSTRIAL','COMMERCIAL','REAL_ESTATE','SERVICES','AGRICULTURE','CUSTOM'] as const){
   const study=createStudy('new-'+sector,'New',sector);
   expect(study.country).toBe('');expect(study.currency).toBe('');
   expect(study.capex.every(x=>x.amount===0)).toBe(true);
  }
  expect(createStudy('property','Property','REAL_ESTATE').capex.map(x=>x.label).join(' ')).not.toContain('خطوط الإنتاج');
  expect(createStudy('service','Service','SERVICES').capex.map(x=>x.label).join(' ')).not.toContain('خطوط الإنتاج');
 });
 it('starts each supported sector with three relevant actions',()=>{
  for(const sector of ['INDUSTRIAL','COMMERCIAL','REAL_ESTATE','SERVICES','AGRICULTURE','CUSTOM'] as const){
   const s=createStudy('sector-'+sector,sector,sector);
   expect(s.tasks).toHaveLength(3);
   expect(s.tasks.every(t=>t.status==='TODO')).toBe(true);
   expect(s.tasks.every(t=>t.title.length>10)).toBe(true);
  }
 });
 it('does not seed a real-estate or service project with water bottling factory tasks',()=>{
  for(const sector of ['REAL_ESTATE','SERVICES','COMMERCIAL'] as const){
   const tasks=createStudy('task-'+sector,sector,sector).tasks.map(t=>t.title).join(' ');
   expect(tasks).not.toContain('خطوط الإنتاج');
   expect(tasks).not.toContain('مصدر المياه');
  }
 });
 it('does not automatically put water factory legal permits into every industrial project',()=>{
  const s=createStudy('generic','Industrial','INDUSTRIAL');
  expect(s.legal.some(v=>v.title.includes('موافقة الموارد المائية'))).toBe(false);
  expect(s.tasks.some(v=>v.title.includes('مصدر المياه'))).toBe(false);
 });
});
