import Decimal from 'decimal.js';
import type {BudgetSourceSnapshot,SourcePlan} from './financial-budget-source';
const D=Decimal.clone({precision:50});
export const comparisonKeys=['budget','actual','variance','utilization','forecast'] as const;
export type ComparisonKey=typeof comparisonKeys[number];
export type BudgetTrend={current:string|null;previous:string|null;change:string|null;unit:'percent'|'points';direction:'up'|'down'|'flat'|null;tone:'positive'|'negative'|'neutral';status:'available'|'previous_zero'|'unavailable'};
export type BudgetComparison={plan:SourcePlan;fromMonth:number;toMonth:number;metrics:Record<ComparisonKey,BudgetTrend>;previousUnmapped:string;previousTotals:BudgetSourceSnapshot['totals']};
export function isPriorBudgetPlan(current:SourcePlan,previous:SourcePlan){return current.id!==previous.id&&current.organizationId===previous.organizationId&&current.currency===previous.currency&&current.entityId===previous.entityId&&current.costCenterId===previous.costCenterId&&current.scenario===previous.scenario&&previous.year===current.year-1&&previous.fiscalStart.slice(5)===current.fiscalStart.slice(5)&&Number(previous.fiscalStart.slice(0,4))===Number(current.fiscalStart.slice(0,4))-1}
function values(s:BudgetSourceSnapshot):Record<ComparisonKey,string|null>{const e=s.totals.expense;return{budget:e.budget_amount,actual:e.actual_amount,variance:new D(e.actual_amount).minus(e.budget_amount).toFixed(4),utilization:new D(e.budget_amount).lte(0)?null:new D(e.actual_amount).div(e.budget_amount).times(100).toFixed(8),forecast:e.forecast_amount}}
export function budgetComparison(current:BudgetSourceSnapshot,previous:BudgetSourceSnapshot):BudgetComparison{
 if(!isPriorBudgetPlan(current.plan,previous.plan)||current.organizationId!==previous.organizationId||current.fromMonth!==previous.fromMonth||current.toMonth!==previous.toMonth)throw Error('BUDGET_COMPARISON_SCOPE_MISMATCH');
 const a=values(current),b=values(previous),metrics={} as Record<ComparisonKey,BudgetTrend>;
 for(const key of comparisonKeys){const c=a[key],p=b[key],unit=key==='utilization'?'points':'percent',incomplete=(key==='actual'||key==='variance'||key==='utilization')&&(new D(current.warnings.unmappedSelected).isZero()===false||new D(previous.warnings.unmappedSelected).isZero()===false);
  let trend:BudgetTrend={current:c,previous:p,change:null,unit,direction:null,tone:'neutral',status:'unavailable'};
  if(c!=null&&p!=null&&!incomplete){if(new D(p).isZero())trend.status='previous_zero';else{const delta=new D(c).minus(p),change=key==='utilization'?delta:delta.div(new D(p).abs()).times(100),direction=delta.isZero()?'flat':delta.isPositive()?'up':'down';trend={...trend,change:change.toFixed(4),direction,tone:key==='actual'&&direction!=='flat'?(direction==='up'?'negative':'positive'):'neutral',status:'available'}}}
  metrics[key]=trend;
 }
 return{plan:previous.plan,fromMonth:previous.fromMonth,toMonth:previous.toMonth,metrics,previousUnmapped:previous.warnings.unmappedSelected,previousTotals:previous.totals};
}
export function budgetComparisonExport(s:BudgetSourceSnapshot,en:boolean):(string|number)[][]{
 const c=s.comparison;if(!c)return[];
 return[['Comparison source','FINANCIAL_CORE_RPC'],['Comparison plan',c.plan.id],['Comparison fiscal start',c.plan.fiscalStart],['Comparison fiscal months',`${c.fromMonth}-${c.toMonth}`],['Comparison unmapped selected',c.previousUnmapped],[en?'Metric':'المؤشر','Current','Previous','Change','Unit','Status'],...comparisonKeys.map(k=>{const t=c.metrics[k];return[k,t.current??'',t.previous??'',t.change??'',t.unit,t.status]})];
}
