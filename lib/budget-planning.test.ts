import {describe,expect,it} from 'vitest';
import {buildBudgetMetrics,createDefaultBudgetPlan} from './budget-planning';

describe('budget planning calculations',()=>{
 it('reconciles annual results to monthly values',()=>{
  const plan=createDefaultBudgetPlan(2027);
  const metrics=buildBudgetMetrics(plan);
  expect(metrics.revenue).toBe(metrics.monthly.reduce((total,month)=>total+month.revenue,0));
  expect(metrics.ebitda).toBe(metrics.grossProfit-metrics.opex);
  expect(metrics.endingCash).toBe(plan.opening_cash+metrics.netCash);
 });
 it('uses forecast values independently of budget',()=>{
  const plan=createDefaultBudgetPlan(2027);
  plan.lines[0].monthly_forecast=Array(12).fill(900000);
  const metrics=buildBudgetMetrics(plan);
  expect(metrics.forecastRevenue).toBeGreaterThan(metrics.revenue);
  expect(metrics.forecastVariance).toBeGreaterThan(0);
 });
});
