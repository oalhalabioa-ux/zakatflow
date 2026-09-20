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
 it('rolls forecast cash independently from budget cash',()=>{
  const plan=createDefaultBudgetPlan(2027);
  plan.lines.find(line=>line.category==='REVENUE')!.monthly_forecast=Array(12).fill(1000000);
  const metrics=buildBudgetMetrics(plan);
  expect(metrics.forecastEndingCash).toBe(plan.opening_cash+metrics.forecastNetCash);
  expect(metrics.forecastEndingCash).not.toBe(metrics.endingCash);
 });
 it('calculates actual operating and cash variances from monthly actuals',()=>{
  const plan=createDefaultBudgetPlan(2027);
  plan.lines.forEach(line=>{line.monthly_actual=[...line.monthly_budget]});
  const metrics=buildBudgetMetrics(plan);
  expect(metrics.revenueVariance).toBe(0);
  expect(metrics.opexVariance).toBe(0);
  expect(metrics.netCashVariance).toBe(0);
  expect(metrics.actualNetCash).toBe(metrics.netCash);
 });
 it('measures forecast minimum cash buffer against the configured target',()=>{
  const plan=createDefaultBudgetPlan(2027);
  const metrics=buildBudgetMetrics(plan);
  expect(metrics.forecastMinimumCashBuffer).toBe(Math.min(...metrics.forecastClosingCash)-plan.minimum_cash_target);
 });
});
