import Decimal from 'decimal.js';
import {z} from 'zod';
import {budgetComparisonExport,type BudgetComparison} from './financial-budget-comparison';
const Money=Decimal.clone({precision:50});
const money=z.union([z.string(),z.number()]).transform((v,ctx)=>{const s=String(v);if(!/^-?\d{1,20}(\.\d{1,4})?$/.test(s)||(typeof v==='number'&&new Money(s).abs().times(10000).gt(Number.MAX_SAFE_INTEGER))){ctx.addIssue({code:'custom',message:'INVALID_SOURCE_AMOUNT'});return z.NEVER}return new Money(s).toFixed(4)});
const uuid=z.string().uuid();
export const budgetSourceQuery=z.object({organization:uuid,plan:uuid,comparisonPlan:uuid.optional(),fromMonth:z.coerce.number().int().min(1).max(12).default(1),toMonth:z.coerce.number().int().min(1).max(12).default(12)}).refine(q=>q.fromMonth<=q.toMonth,{message:'INVALID_MONTH_RANGE'});
export type BudgetSourceQuery=z.infer<typeof budgetSourceQuery>;
export type SourcePlan={id:string;organizationId:string;name:string;year:number;currency:string;scenario:string;fiscalStart:string;entityId:string|null;costCenterId:string|null};
export type SourceContext={organizations:{id:string;name:string;currency:string}[];plans:SourcePlan[];statements:{available:false;reason:'BALANCED_LEDGER_ADAPTER_REQUIRED'}};
const metricNames=['budget_amount','actual_amount','legacy_actual','reconciliation_difference','committed_amount','paid_settled_gross','outstanding_gross','remaining_budget','forecast_amount','favorable_variance'] as const;
export type SourceMetric=typeof metricNames[number];
const rowSchema=z.object({budget_line_id:uuid,name:z.string().max(500),category:z.string().max(80),line_type:z.enum(['REVENUE','EXPENSE','CASH']),fiscal_month:z.number().int().min(1).max(12),budget_amount:money,actual_amount:money,legacy_actual:money,reconciliation_difference:money,committed_amount:money,paid_settled_gross:money,outstanding_gross:money,remaining_budget:money,forecast_amount:money,favorable_variance:money,actual_source:z.literal('FINANCIAL_CORE_DERIVED')});
const reportSchema=z.object({plan_id:uuid,organization_id:uuid,entity_id:uuid.nullable(),cost_center_id:uuid.nullable(),currency:z.string().regex(/^[A-Z]{3}$/),scenario:z.string().max(80),fiscal_start:z.string().date(),rows:z.array(rowSchema).max(120000),unmapped_financial_actuals:z.array(z.object({organization_id:uuid,fiscal_month:z.number().int().min(1).max(12),reason:z.string(),unmapped_amount:money})).max(100000),unmapped_amount:money,legacy_actual_not_replaced:z.literal(true),forecast_not_changed:z.literal(true)});
export type BudgetSourceRow=z.infer<typeof rowSchema>;
export type BudgetSourceSnapshot={origin:'FINANCIAL_CORE_RPC';comparison?:BudgetComparison;organizationId:string;plan:SourcePlan;currency:string;fromMonth:number;toMonth:number;rows:BudgetSourceRow[];groups:{id:string;name:string;category:string;lineType:string;metrics:Record<SourceMetric,string>;variancePercent:string|null}[];monthly:{month:number;revenueBudget:string;revenueActual:string;expenseBudget:string;expenseActual:string}[];totals:{revenue:Record<SourceMetric,string>;expense:Record<SourceMetric,string>};warnings:{unmappedAnnual:string;unmappedSelected:string;unmappedReasons:string[];reconciliationDifference:string;legacyActualExcluded:true;cashSettlementExcludedFromActual:true};statements:{available:false;reason:'BALANCED_LEDGER_ADAPTER_REQUIRED'}};
const zeros=()=>Object.fromEntries(metricNames.map(k=>[k,'0.0000'])) as Record<SourceMetric,string>;
const add=(a:string,b:string)=>new Money(a).plus(b).toFixed(4);
export function normalizeBudgetSource(input:unknown,query:BudgetSourceQuery,plan:SourcePlan):BudgetSourceSnapshot{
 const q=budgetSourceQuery.parse(query),r=reportSchema.parse(input);
 if(r.organization_id!==q.organization||r.plan_id!==q.plan||plan.id!==q.plan||plan.organizationId!==q.organization||r.entity_id!==plan.entityId||r.cost_center_id!==plan.costCenterId||r.currency!==plan.currency||r.fiscal_start!==plan.fiscalStart||r.scenario!==plan.scenario)throw Error('BUDGET_SOURCE_SCOPE_MISMATCH');
 const keys=new Set<string>(),lineNames=new Map<string,string>();
 for(const row of r.rows){const key=row.budget_line_id+':'+row.fiscal_month;if(keys.has(key))throw Error('DUPLICATE_BUDGET_SOURCE_ROW');keys.add(key);const shape=JSON.stringify([row.name,row.category,row.line_type]);if(lineNames.has(row.budget_line_id)&&lineNames.get(row.budget_line_id)!==shape)throw Error('INCONSISTENT_BUDGET_SOURCE_LINE');lineNames.set(row.budget_line_id,shape)}
 if(keys.size!==lineNames.size*12)throw Error('INCOMPLETE_BUDGET_SOURCE_YEAR');
 if(r.unmapped_financial_actuals.some(f=>f.organization_id!==q.organization))throw Error('BUDGET_SOURCE_SCOPE_MISMATCH');
 const rows=r.rows.filter(row=>row.fiscal_month>=q.fromMonth&&row.fiscal_month<=q.toMonth),grouped=new Map<string,BudgetSourceSnapshot['groups'][number]>(),totals={revenue:zeros(),expense:zeros()};
 const monthly=Array.from({length:q.toMonth-q.fromMonth+1},(_,i)=>({month:i+q.fromMonth,revenueBudget:'0.0000',revenueActual:'0.0000',expenseBudget:'0.0000',expenseActual:'0.0000'}));
 for(const row of rows){let group=grouped.get(row.budget_line_id);if(!group){group={id:row.budget_line_id,name:row.name,category:row.category,lineType:row.line_type,metrics:zeros(),variancePercent:null};grouped.set(row.budget_line_id,group)}for(const k of metricNames)group.metrics[k]=add(group.metrics[k],row[k]);
  const type=row.line_type==='REVENUE'?'revenue':row.line_type==='EXPENSE'?'expense':null;
  if(type){for(const k of metricNames)totals[type][k]=add(totals[type][k],row[k]);const m=monthly[row.fiscal_month-q.fromMonth];if(type==='revenue'){m.revenueBudget=add(m.revenueBudget,row.budget_amount);m.revenueActual=add(m.revenueActual,row.actual_amount)}else{m.expenseBudget=add(m.expenseBudget,row.budget_amount);m.expenseActual=add(m.expenseActual,row.actual_amount)}}
 }
 for(const g of grouped.values())g.variancePercent=new Money(g.metrics.budget_amount).isZero()?null:new Money(g.metrics.favorable_variance).div(new Money(g.metrics.budget_amount).abs()).times(100).toFixed(4);
 const unmapped=r.unmapped_financial_actuals.filter(f=>f.fiscal_month>=q.fromMonth&&f.fiscal_month<=q.toMonth);
 return{origin:'FINANCIAL_CORE_RPC',organizationId:q.organization,plan,currency:r.currency,fromMonth:q.fromMonth,toMonth:q.toMonth,rows,groups:[...grouped.values()],monthly,totals,warnings:{unmappedAnnual:r.unmapped_amount,unmappedSelected:unmapped.reduce((n,f)=>add(n,f.unmapped_amount),'0.0000'),unmappedReasons:[...new Set(unmapped.map(f=>f.reason))],reconciliationDifference:rows.reduce((n,row)=>add(n,row.reconciliation_difference),'0.0000'),legacyActualExcluded:true,cashSettlementExcludedFromActual:true},statements:{available:false,reason:'BALANCED_LEDGER_ADAPTER_REQUIRED'}};
}
export function budgetSourceExport(snapshot:BudgetSourceSnapshot,en:boolean){
 const meta:(string|number)[][]=[['Source','FINANCIAL_CORE_RPC'],['Organization',snapshot.organizationId],['Plan',snapshot.plan.id],['Currency',snapshot.currency],['Fiscal start',snapshot.plan.fiscalStart],['Fiscal months',`${snapshot.fromMonth}-${snapshot.toMonth}`],['Unmapped selected',snapshot.warnings.unmappedSelected],['Legacy actual is separate; gross cash settlement is NOT recognized actual']];
 return[...meta,[en?'Budget line':'بند الموازنة',en?'Fiscal month':'الشهر المالي','Budget','Core actual','Legacy actual (excluded)','Committed','Paid gross (not actual)','Outstanding gross','Remaining','Forecast','Favorable variance'],...snapshot.rows.map(r=>[r.name,r.fiscal_month,r.budget_amount,r.actual_amount,r.legacy_actual,r.committed_amount,r.paid_settled_gross,r.outstanding_gross,r.remaining_budget,r.forecast_amount,r.favorable_variance]),...budgetComparisonExport(snapshot,en)];
}

export function budgetSourceCsv(snapshot:BudgetSourceSnapshot,en:boolean){
 const quote=(v:string|number)=>{const raw=String(v),numeric=/^-?\d+(\.\d+)?$/.test(raw);const safe=typeof v==='string'&&!numeric&&/^[=+@\-\t\r]/.test(raw)?"'"+raw:raw;return '"'+safe.replaceAll('"','""')+'"'};
 return '\uFEFF'+budgetSourceExport(snapshot,en).map(row=>row.map(quote).join(',')).join('\r\n');
}
