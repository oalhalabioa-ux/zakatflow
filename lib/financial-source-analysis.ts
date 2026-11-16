import Decimal from 'decimal.js';
import {budgetComparisonExport} from './financial-budget-comparison';
import type {BudgetSourceSnapshot} from './financial-budget-source';
const D=Decimal.clone({precision:50});
export type AnalysisMeasure='revenue'|'expense';
/** Presentation of the same authorized RPC snapshot; not a second financial recognition source. */
export function financialSourceAnalysis(s:BudgetSourceSnapshot,measure:AnalysisMeasure){
 const type=measure==='revenue'?'REVENUE':'EXPENSE',groups=s.groups.filter(g=>g.lineType===type),totals=s.totals[measure],available=groups.length>0;
 const divide=(a:string,b:string)=>new D(b).lte(0)?null:new D(a).div(b).times(100).toFixed(4);
 const signedVariance=new D(totals.actual_amount).minus(totals.budget_amount).toFixed(4);
 return{measure,available,currency:s.currency,fromMonth:s.fromMonth,toMonth:s.toMonth,revenue:s.groups.some(g=>g.lineType==='REVENUE')?s.totals.revenue.actual_amount:null,expense:s.groups.some(g=>g.lineType==='EXPENSE')?s.totals.expense.actual_amount:null,profitMargin:null,operatingProfit:null,budget:available?totals.budget_amount:null,actual:available?totals.actual_amount:null,variance:available?signedVariance:null,variancePercent:available?divide(signedVariance,totals.budget_amount):null,utilization:available?divide(totals.actual_amount,totals.budget_amount):null,rows:groups.map(g=>({id:g.id,name:g.name,type:g.lineType,budget:g.metrics.budget_amount,actual:g.metrics.actual_amount,favorableVariance:g.metrics.favorable_variance,utilization:divide(g.metrics.actual_amount,g.metrics.budget_amount)})),monthly:s.monthly.map(m=>({month:m.month,budget:measure==='revenue'?m.revenueBudget:m.expenseBudget,actual:measure==='revenue'?m.revenueActual:m.expenseActual,variancePercent:divide(new D(measure==='revenue'?m.revenueActual:m.expenseActual).minus(measure==='revenue'?m.revenueBudget:m.expenseBudget).toFixed(4),measure==='revenue'?m.revenueBudget:m.expenseBudget)}))};
}
export function financialAnalysisExport(s:BudgetSourceSnapshot,en:boolean,measure:AnalysisMeasure):(string|number)[][]{
 const a=financialSourceAnalysis(s,measure);
 return[['Source','FINANCIAL_CORE_RPC'],['Organization',s.organizationId],['Plan',s.plan.id],['Currency',s.currency],['Fiscal start',s.plan.fiscalStart],['Fiscal months',`${s.fromMonth}-${s.toMonth}`],['Measure',measure],['Scope','Budget and recognized actual only; formal profitability/sector data unavailable'],['Metric','Value'],['Revenue actual',a.revenue??''],['Expense actual',a.expense??''],['Selected budget',a.budget??''],['Selected actual',a.actual??''],['Selected variance',a.variance??''],['Selected variance %',a.variancePercent??''],['Operating profit','UNAVAILABLE'],['Profit margin','UNAVAILABLE'],[],[en?'Budget line':'بند الموازنة','Type','Budget','Core actual','Favorable variance','Utilization %'],...a.rows.map(r=>[r.name,r.type,r.budget,r.actual,r.favorableVariance,r.utilization??'']),[],['Fiscal month','Budget','Core actual'],...a.monthly.map(m=>[m.month,a.available?m.budget:'',a.available?m.actual:'']),...(s.comparison?[[],['Comparison measure','expense'],...budgetComparisonExport(s,en)]:[])];
}
