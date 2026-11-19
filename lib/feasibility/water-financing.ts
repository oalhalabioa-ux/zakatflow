import {z} from 'zod';
import {internalRateOfReturn} from './engine';
import type {WaterModel} from './water-model';

/** Optional annual convention. Existing drafts without this policy retain reference calculations. */
export const waterFinancingPolicySchema=z.object({
 graceInterest:z.enum(['LEGACY_WAIVED','PAY','CAPITALIZE']),
 interestTaxMode:z.enum(['NONE','PAID']),
 terminalDebt:z.enum(['CARRY','SETTLE']),
 evidence:z.string().max(3000),
}).strict();
export function defaultWaterFinancingPolicy():z.infer<typeof waterFinancingPolicySchema>{
 return {graceInterest:'PAY',interestTaxMode:'NONE',terminalDebt:'CARRY',evidence:''};
}

/** All borrowing is drawn at inception. loanYears counts principal instalments AFTER grace. */
export function waterDebtSchedule(model:WaterModel,totalLoan:number){
 const {deal,ops,financingPolicy:p}=model,start=Math.max(1,deal.loanStart),term=Math.max(1,deal.loanYears);
 let balance=totalLoan,instalment=totalLoan/term;
 return Array.from({length:ops.horizon},(_,i)=>{
  const year=i+1,openingDebt=balance,grace=year<start;
  const accruedInterest=openingDebt*deal.loanInterest/100;
  const capitalizedInterest=p&&grace&&p.graceInterest==='CAPITALIZE'?accruedInterest:0;
  const interest=!grace||p?.graceInterest==='PAY'?accruedInterest:0;
  balance+=capitalizedInterest;
  if(year===start)instalment=balance/term;
  const principal=!grace?Math.min(balance,instalment):0;
  balance=Math.max(0,balance-principal);
  const terminalDebtRepayment=p?.terminalDebt==='SETTLE'&&year===ops.horizon?balance:0;
  balance=Math.max(0,balance-terminalDebtRepayment);
  return {openingDebt,capitalizedInterest,interest,principal,terminalDebtRepayment,
   debtBalance:balance,debtService:principal+interest+terminalDebtRepayment};
 });
}

export function waterFinancingReadiness(model:WaterModel,cashRequired:number,closingDebt:number,totalEquity:number){
 const p=model.financingPolicy,hasDebt=model.deal.investorLoan+model.deal.extraFunding>0;
 const inputIssues=[
  ...(model.deal.extraFunding>0?['UNALLOCATED_FUNDING']:[]),
  ...(model.deal.investorLoan>cashRequired?['EXCESS_LOAN']:[]),
  ...(cashRequired>0&&totalEquity<=0?['NO_EQUITY']:[]),
  ...(hasDebt&&(model.deal.loanYears<=0||model.deal.loanStart<=0)?['LOAN_TERM']:[]),
 ];
 const returnIssues=closingDebt>.005?['RESIDUAL_DEBT']:[];
 const evidenceIssues=p?(!p.evidence.trim()?['DEBT_EVIDENCE']:[]):hasDebt?['FINANCING_POLICY']:[];
 return {inputReady:inputIssues.length===0,returnReady:inputIssues.length===0&&returnIssues.length===0,
  ready:inputIssues.length===0&&returnIssues.length===0&&evidenceIssues.length===0,
  issues:[...inputIssues,...returnIssues,...evidenceIssues]};
}

/** IRR is reported only for a conventional negative-inception / positive-return stream. */
export function conventionalEquityIrr(flows:number[]):number|null{
 const signs=flows.filter(v=>Math.abs(v)>1e-8).map(Math.sign);
 const changes=signs.slice(1).reduce((s,v,i)=>s+Number(v!==signs[i]),0);
 return flows[0]<0&&changes===1?internalRateOfReturn(flows):null;
}

/** Pro-rata equity distributions/capital calls; shareholder-loan receipts stay separate from equity. */
export function waterEquityReturns({investorEquity,land,shareholderLoan,annual,returnReady}:{
 investorEquity:number;land:number;shareholderLoan:number;returnReady:boolean;
 annual:readonly {afterDebt:number;principal:number;interest:number;terminalDebtRepayment?:number}[];
}){
 const totalEquity=investorEquity+land,share=totalEquity>0?investorEquity/totalEquity:0;
 const flows=[-totalEquity,...annual.map(y=>y.afterDebt)];
 const investorEquityFlows=[-investorEquity,...annual.map(y=>y.afterDebt*share)];
 const partnerEquityFlows=[-land,...annual.map(y=>y.afterDebt*(totalEquity>0?land/totalEquity:0))];
 const shareholderLoanFlows=[-shareholderLoan,...annual.map(y=>y.principal+y.interest+(y.terminalDebtRepayment??0))];
 const investorCombinedFlows=investorEquityFlows.map((v,i)=>v+shareholderLoanFlows[i]);
 return {flows,investorEquityFlows,partnerEquityFlows,shareholderLoanFlows,investorCombinedFlows,
  irr:returnReady?conventionalEquityIrr(flows):null,
  investorCombinedIrr:returnReady?conventionalEquityIrr(investorCombinedFlows):null,
  conventional:flows[0]<0&&flows.slice(1).every(v=>v>=0)};
}
