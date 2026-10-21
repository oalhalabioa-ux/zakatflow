import Decimal from 'decimal.js';
import {investmentProjection,type InvestmentTerms} from './investments';

export type PortfolioInstrument={id:string;status:string;terms:InvestmentTerms};
export type PortfolioOperation={contract_id:string;kind:string;status:string;amount:number};
export type PortfolioParticipation={id:string;direction:string;state:string;currency:string;reference:string;maturity_date:string|null;summary:{managed:number;profitDeclared:number;profitDue:number;returnDue:number}};
export type PortfolioKind=InvestmentTerms['instrument']|'CONTRACT';
export const portfolioKindLabels:Record<PortfolioKind,string>={DEPOSIT:'الودائع',SUKUK:'الصكوك',BOND:'السندات',CONTRACT:'عقود الاستثمار'};
const add=(a:number,b:number)=>new Decimal(a).plus(b).toDecimalPlaces(4).toNumber();

/** Read-only portfolio. Original currencies, projected income and settled income remain distinct. */
export function investmentPortfolio(instruments:PortfolioInstrument[],operations:PortfolioOperation[],participations:PortfolioParticipation[],asOf:string,baseCurrency='SAR'){
 const eligible=instruments.filter(c=>c.status!=='CANCELLED'),outgoing=participations.filter(c=>c.direction==='OUTGOING'&&!['DRAFT','CANCELLED'].includes(c.state));
 const currencies=[...new Set([...eligible.map(c=>c.terms.currency),...participations.filter(c=>c.direction==='OUTGOING'&&c.state!=='CANCELLED').map(c=>c.currency)])].sort();
 if(!currencies.length)currencies.push(baseCurrency);
 return currencies.map(currency=>{
  const rows=eligible.filter(c=>c.terms.currency===currency),contracts=outgoing.filter(c=>c.currency===currency);
  const allocation=(['DEPOSIT','SUKUK','BOND','CONTRACT'] as PortfolioKind[]).map(kind=>{
   const active=rows.filter(c=>c.status==='ACTIVE'&&c.terms.instrument===kind);
   const contractRows=kind==='CONTRACT'?contracts:[];
   const ids=new Set(rows.filter(c=>c.terms.instrument===kind&&c.status!=='DRAFT').map(c=>c.id));
   return {kind,label:portfolioKindLabels[kind],activeCount:kind==='CONTRACT'?contractRows.filter(c=>c.state==='ACTIVE').length:active.length,
    carrying:add(active.reduce((s,c)=>add(s,investmentProjection(c.terms).cost),0),contractRows.reduce((s,c)=>add(s,c.summary.managed),0)),
    projectedIncome:kind==='CONTRACT'?null:active.reduce((s,c)=>add(s,investmentProjection(c.terms).gross),0),
    declaredIncome:contractRows.reduce((s,c)=>add(s,c.summary.profitDeclared),0),
    settledIncome:add(operations.filter(o=>ids.has(o.contract_id)&&o.kind==='INCOME'&&o.status==='POSTED').reduce((s,o)=>add(s,Number(o.amount)),0),contractRows.reduce((s,c)=>add(s,Math.max(0,new Decimal(c.summary.profitDeclared).minus(c.summary.profitDue).toNumber())),0))};
  });
  const maturities=[...rows.filter(c=>c.status==='ACTIVE').map(c=>({id:c.id,kind:c.terms.instrument as PortfolioKind,name:c.terms.name,date:c.terms.maturity_date,amount:investmentProjection(c.terms).redemption,estimated:false})),...contracts.filter(c=>c.state==='ACTIVE'&&c.maturity_date&&c.summary.managed>0).map(c=>({id:c.id,kind:'CONTRACT' as PortfolioKind,name:c.reference,date:c.maturity_date!,amount:c.summary.managed,estimated:true}))].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  return {currency,allocation,maturities,
   invested:allocation.reduce((s,a)=>add(s,a.carrying),0),
   projectedIncome:allocation.reduce((s,a)=>add(s,a.projectedIncome??0),0),
   declaredIncome:contracts.reduce((s,c)=>add(s,c.summary.profitDeclared),0),
   settledIncome:allocation.reduce((s,a)=>add(s,a.settledIncome),0),
   profitDue:contracts.reduce((s,c)=>add(s,c.summary.profitDue),0),
   returnDue:contracts.reduce((s,c)=>add(s,c.summary.returnDue),0),
   activeCount:allocation.reduce((s,a)=>s+a.activeCount,0),
   overdueCount:maturities.filter(m=>m.date<asOf).length,
   draftCount:rows.filter(c=>c.status==='DRAFT').length+participations.filter(c=>c.direction==='OUTGOING'&&c.currency===currency&&c.state==='DRAFT').length};
 });
}
