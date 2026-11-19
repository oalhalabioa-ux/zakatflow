import {describe,it,expect} from 'vitest';
import {createWaterModel,evaluateWater,legacyWaterFinancialPolicy,waterModelSchema} from './water-model';
import {conventionalEquityIrr,defaultWaterFinancingPolicy} from './water-financing';
import {createIndustrialStarter} from './project-templates';
import {feasibilityDraftSchema} from './draft-schema';
import {handoffReadiness} from './handoff';

function model(){
 const m=createWaterModel();m.capex.line=1000;
 Object.assign(m.ops,{bottlesHour:12,hoursDay:1,daysMonth:10,bottlesCarton:12,priceCarton:10,variableCarton:4,
  fixedMonth:10,horizon:4,life:2,util:[100,100,100,100],taxRate:20,discountRate:10});
 Object.assign(m.deal,{investorLoan:300,loanInterest:10,loanYears:3,loanStart:2});
 m.financialPolicy={...legacyWaterFinancialPolicy(),depreciationMode:'CAPPED',evidence:'Synthetic depreciation assumption'};
 return m;
}
function financed(){const m=model();m.financingPolicy={...defaultWaterFinancingPolicy(),evidence:'Synthetic loan terms — not a market quotation'};return m;}
describe('water annual financing and equity-return reconciliation',()=>{
 it('preserves all pre-existing annual and project calculations until explicitly selected',()=>{
  const m=model(),before=structuredClone(m),legacy=evaluateWater(m);expect(legacy.equity).toBeUndefined();
  m.financingPolicy={...defaultWaterFinancingPolicy(),graceInterest:'LEGACY_WAIVED'};
  const r=evaluateWater(m);expect(r.flows).toEqual(legacy.flows);expect(r.irr).toBe(legacy.irr);
  for(const [i,y] of legacy.annual.entries())for(const key of Object.keys(y))expect(r.annual[i][key as keyof typeof y]).toEqual(y[key as keyof typeof y]);
  expect(r.investorShare).toBe(legacy.investorShare);delete m.financingPolicy;expect(m).toEqual(before);
 });
 it('pays grace interest annually and counts the loan term after grace without changing project IRR',()=>{
  const m=financed(),legacy=evaluateWater(model()),before=structuredClone(m),r=evaluateWater(m);
  expect(r.annual.map(y=>y.principal)).toEqual([0,100,100,100]);expect(r.annual.map(y=>y.interest)).toEqual([30,30,20,10]);
  expect(r.annual.map(y=>y.debtBalance)).toEqual([300,200,100,0]);expect(r.annual.map(y=>y.afterDebt)).toEqual([550,450,360,370]);
  expect(r.flows).toEqual([-1000,580,580,480,480]);expect(r.irr).toBe(legacy.irr);expect(r.npv).toBe(legacy.npv);
  expect(r.annual[0].dscr).toBeCloseTo(580/30);expect(r.financingReadiness?.ready).toBe(true);expect(m).toEqual(before);
 });
 it('capitalizes grace interest once, amortizes the higher balance and preserves ownership',()=>{
  const m=financed(),paid=evaluateWater(m);m.financingPolicy!.graceInterest='CAPITALIZE';const r=evaluateWater(m);
  expect(r.annual.map(y=>y.openingDebt)).toEqual([300,330,220,110]);
  expect(r.annual.map(y=>y.capitalizedInterest)).toEqual([30,0,0,0]);expect(r.annual.map(y=>y.principal)).toEqual([0,110,110,110]);
  expect(r.annual.map(y=>y.interest)).toEqual([0,33,22,11]);expect(r.annual.map(y=>y.afterDebt)).toEqual([580,437,348,359]);
  expect(r.annual[0].dscr).toBeNull();expect(r.investorShare).toBe(paid.investorShare);expect(r.totalLoan).toBe(300);
  for(const y of r.annual)expect(y.openingDebt!+y.capitalizedInterest!-y.principal-y.terminalDebtRepayment!).toBeCloseTo(y.debtBalance,10);
 });
 it('withholds incomplete equity IRR and includes terminal payoff in debt service/operating DSCR',()=>{
  const m=financed();m.financingPolicy!.graceInterest='CAPITALIZE';m.ops.horizon=3;
  const carried=evaluateWater(m);expect(carried.annual[2].debtBalance).toBe(110);expect(carried.equity?.irr).toBeNull();
  expect(carried.financingReadiness?.issues).toContain('RESIDUAL_DEBT');
  m.financingPolicy!.terminalDebt='SETTLE';const r=evaluateWater(m),last=r.annual[2];
  expect(last).toMatchObject({principal:110,interest:22,terminalDebtRepayment:110,debtService:242,debtBalance:0,afterDebt:238});
  expect(last.dscr).toBeCloseTo(480/242);expect(r.equity?.irr).not.toBeNull();expect(r.flows).toEqual(carried.flows);
  m.financialPolicy!.terminalAssetProceeds=10000;const exit=evaluateWater(m);
  expect(exit.annual[2].dscr).toBe(last.dscr);expect(exit.equity!.flows[3]-r.equity!.flows[3]).toBe(10000);
 });
 it('deducts only explicitly selected paid interest, capped at positive EBIT, from equity tax',()=>{
  const m=financed(),base=evaluateWater(m);m.financingPolicy!.interestTaxMode='PAID';const r=evaluateWater(m);
  expect(r.annual.map(y=>y.interestTaxSaving)).toEqual([6,6,4,2]);expect(r.annual.map(y=>y.equityTax)).toEqual([14,14,116,118]);
  expect(r.annual.map(y=>y.afterDebt)).toEqual([556,456,364,372]);expect(r.flows).toEqual(base.flows);
  expect(r.annual[0].dscr).toBeCloseTo(586/30);
  m.financingPolicy!.graceInterest='CAPITALIZE';expect(evaluateWater(m).annual[0].interestTaxSaving).toBe(0);
  m.deal.loanInterest=100;expect(evaluateWater(m).annual[1].equityTax).toBe(0);
  const loss=evaluateWater(m,{price:10,volume:100,cost:100});expect(loss.annual.every(y=>y.interestTaxSaving===0)).toBe(true);
 });
 it('reconciles economic in-kind equity, cash equity and shareholder-loan returns without double counting',()=>{
  const m=financed();m.deal.landValue=5000;const r=evaluateWater(m),e=r.equity!;
  expect(r.investorShare).toBeCloseTo(700/5700*100);expect(r.partnerShare).toBeCloseTo(5000/5700*100);
  expect(e.flows[0]).toBe(-5700);expect(e.investorEquityFlows[0]).toBe(-700);expect(e.partnerEquityFlows[0]).toBe(-5000);
  expect(e.shareholderLoanFlows[0]).toBe(-300);expect(e.investorCombinedFlows[0]).toBe(-1000);
  for(let i=0;i<e.flows.length;i++){
   expect(e.investorEquityFlows[i]+e.partnerEquityFlows[i]).toBeCloseTo(e.flows[i],9);
   expect(e.investorCombinedFlows[i]+e.partnerEquityFlows[i]).toBeCloseTo(r.flows[i],9);
   expect(e.investorCombinedFlows[i]).toBeCloseTo(e.investorEquityFlows[i]+e.shareholderLoanFlows[i],9);
  }
  expect(e.investorCombinedIrr).not.toBe(e.irr);
 });
 it('solves equity IRR against its own cash flows and rejects ambiguous or absent equity',()=>{
  const r=evaluateWater(financed()),e=r.equity!;expect(e.irr).not.toBeNull();expect(e.irr).not.toBe(r.irr);
  expect(e.flows.reduce((s,v,i)=>s+v/(1+e.irr!/100)**i,0)).toBeCloseTo(0,6);
  expect(conventionalEquityIrr([-100,300,-250])).toBeNull();expect(conventionalEquityIrr([0,100,100])).toBeNull();
  expect(conventionalEquityIrr([-100,110,0])).toBeCloseTo(10,5);
 });
 it('does not invent an allocation or equity return for surplus financing, excess loans or incomplete terms',()=>{
  const m=financed();m.deal.extraFunding=100;const extra=evaluateWater(m);
  expect(extra.financingReadiness?.issues).toContain('UNALLOCATED_FUNDING');expect(extra.equity).toBeUndefined();expect(extra.ready).toBe(false);
  m.deal.extraFunding=0;m.deal.investorLoan=1001;expect(evaluateWater(m).financingReadiness?.issues).toContain('EXCESS_LOAN');
  m.deal.investorLoan=300;m.deal.loanYears=0;expect(evaluateWater(m).financingReadiness?.issues).toContain('LOAN_TERM');
 });
 it('does not invent owners for all-debt funding and compounds multiple grace years before repayment',()=>{
  const m=financed();m.deal.investorLoan=1000;expect(evaluateWater(m).financingReadiness?.issues).toContain('NO_EQUITY');
  expect(evaluateWater(m).equity).toBeUndefined();
  m.deal.investorLoan=300;m.financingPolicy!.graceInterest='CAPITALIZE';m.deal.loanStart=3;m.deal.loanYears=2;
  const r=evaluateWater(m);expect(r.annual.map(y=>y.capitalizedInterest)).toEqual([30,33,0,0]);
  expect(r.annual.map(y=>y.principal)).toEqual([0,0,181.5,181.5]);expect(r.annual.at(-1)?.debtBalance).toBe(0);
  for(const y of r.annual)expect(y.openingDebt!+y.capitalizedInterest!-y.principal-y.terminalDebtRepayment!).toBeCloseTo(y.debtBalance,8);
 });
 it('retains policy through strict JSON round trips and requires evidence for investment readiness',()=>{
  const s=createIndustrialStarter('6cac7619-9896-4f4a-9b5a-035008a1feec','Synthetic equity','BOTTLED_WATER');s.water=financed();
  expect(feasibilityDraftSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(s);
  expect(handoffReadiness(s).checks.find(x=>x.key==='financing-policy')?.passed).toBe(true);
  s.water.financingPolicy!.evidence='';expect(handoffReadiness(s).checks.find(x=>x.key==='financing-policy')?.passed).toBe(false);
  expect(waterModelSchema.safeParse({...s.water,financingPolicy:{...s.water.financingPolicy,graceInterest:'MAGIC'}}).success).toBe(false);
 });
});
