// Phase 2D metrics are authoritative. This module only groups report rows for display.
export type FinancialBudgetRow = {
 budget_line_id:string; name:string; category:string; line_type:string; fiscal_month:number;
 budget_amount:number; actual_amount:number; legacy_actual:number; reconciliation_difference:number;
 committed_amount:number; paid_settled_gross:number; outstanding_gross:number; remaining_budget:number;
 forecast_amount:number; favorable_variance:number; variance_percent:number|null; remaining_semantics:string;
};
export type FinancialFact = {
 financial_line_id:string; event_id:string; organization_id:string; entity_id:string|null; cost_center_id:string|null;
 classification_type:string; event_date:string; fiscal_month:number; metric_status:string; budget_line_id:string|null;
 actual_amount:number; committed_amount:number; unmapped_amount:number; reason:string|null;
 source_module:string; source_record_id:string|null; source_event_key:string; base_currency:string;
};
export type FinancialBudgetReport = {
 plan_id:string; organization_id:string; entity_id:string|null; cost_center_id:string|null; currency:string;
 scenario:string; fiscal_start:string; rows:FinancialBudgetRow[]; unmapped_financial_actuals:FinancialFact[]; unmapped_amount:number;
};
export const DISPLAY_METRICS = ['budget_amount','actual_amount','legacy_actual','reconciliation_difference','committed_amount','paid_settled_gross','outstanding_gross','remaining_budget','forecast_amount','favorable_variance'] as const;
export type DisplayMetric = typeof DISPLAY_METRICS[number];
export function groupReportRows(rows:FinancialBudgetRow[],month:number){
 const groups=new Map<string,FinancialBudgetRow>();
 for(const row of rows){
  if(month && row.fiscal_month!==month)continue;
  const current=groups.get(row.budget_line_id);
  if(!current){groups.set(row.budget_line_id,{...row});continue;}
  for(const key of DISPLAY_METRICS)current[key]=Number(current[key])+Number(row[key]);
 }
 // Variance percentages are not additive; ratio is presentation of the RPC variance.
 return [...groups.values()].map(row=>({...row,variance_percent:Number(row.budget_amount)===0?null:100*Number(row.favorable_variance)/Math.abs(Number(row.budget_amount))}));
}
export function summarizeReport(rows:FinancialBudgetRow[]){
 const totals=Object.fromEntries(DISPLAY_METRICS.map(k=>[k,0])) as Record<DisplayMetric,number>;
 for(const row of rows)for(const k of DISPLAY_METRICS)totals[k]+=Number(row[k]);
 return totals;
}
