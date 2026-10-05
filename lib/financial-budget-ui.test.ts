import {describe,it,expect} from 'vitest';
import {groupReportRows,summarizeReport} from './financial-budget-ui';
import type {FinancialBudgetRow} from './financial-budget-ui';
const row=(changes:Partial<FinancialBudgetRow>={}):FinancialBudgetRow=>({budget_line_id:'opex',name:'OPEX',category:'OPEX',line_type:'EXPENSE',fiscal_month:1,budget_amount:1000,actual_amount:100,legacy_actual:90,reconciliation_difference:10,committed_amount:0,paid_settled_gross:115,outstanding_gross:0,remaining_budget:900,forecast_amount:1200,favorable_variance:900,variance_percent:90,remaining_semantics:'UNCONSUMED_BUDGET',...changes});
describe('Phase 2D report presentation',()=>{
 it('keeps Core/Legacy, VAT-inclusive payment and remaining separate',()=>{const t=summarizeReport([row()]);expect(t.actual_amount).toBe(100);expect(t.legacy_actual).toBe(90);expect(t.paid_settled_gross).toBe(115);expect(t.remaining_budget).toBe(900);expect(t.reconciliation_difference).toBe(10)});
 it('filters fiscal months and sums amounts without summing percentages',()=>{const rows=[row(),row({fiscal_month:2,budget_amount:2000,actual_amount:500,favorable_variance:1500,variance_percent:75,remaining_budget:1500})];expect(groupReportRows(rows,1)[0].actual_amount).toBe(100);const annual=groupReportRows(rows,0)[0];expect(annual.actual_amount).toBe(600);expect(annual.variance_percent).toBe(80);expect(annual.remaining_budget).toBe(2400)});
 it('preserves revenue signs, never merges revenue with expense lines',()=>{const grouped=groupReportRows([row(),row({budget_line_id:'rev',line_type:'REVENUE',category:'REVENUE',actual_amount:1100,favorable_variance:100,remaining_budget:-100})],0);expect(grouped).toHaveLength(2);expect(grouped[1].favorable_variance).toBe(100);expect(grouped[1].remaining_budget).toBe(-100)});
 it('shows unavailable variance for zero budget',()=>{expect(groupReportRows([row({budget_amount:0})],0)[0].variance_percent).toBeNull()});
});
