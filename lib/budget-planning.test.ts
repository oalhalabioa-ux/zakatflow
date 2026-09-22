import {describe,expect,it} from 'vitest';
import {budgetVariancePercent,buildBudgetMetrics,createCostCenterBudgetPlan,createDefaultBudgetPlan,isBudgetVarianceFavorable,normalizeCostCenterBudgetPlan,selectPersistedBudgetLine} from './budget-planning';
import {budgetPlanSchema} from './validation/schemas';

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
  plan.lines.find(line=>line.category==='REVENUE')!.monthly_budget=Array(12).fill(500000);
  plan.lines[0].monthly_forecast=Array(12).fill(900000);
  const metrics=buildBudgetMetrics(plan);
  expect(metrics.forecastRevenue).toBeGreaterThan(metrics.revenue);
  expect(metrics.forecastVariance).toBeGreaterThan(0);
 });
 it('rolls forecast cash independently from budget cash',()=>{
  const plan=createDefaultBudgetPlan(2027);
  plan.lines.find(line=>line.category==='REVENUE')!.monthly_budget=Array(12).fill(500000);
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
 it('keeps cost-center templates distinct and editable',()=>{
  const hq=createCostCenterBudgetPlan('HQ',2027),operations=createCostCenterBudgetPlan('OPERATIONS',2027);
  expect(hq.cost_center).toBe('HQ');
  expect(operations.cost_center).toBe('OPERATIONS');
  expect(hq.lines.some(line=>line.name==='رواتب إدارية')).toBe(true);
  expect(operations.lines.some(line=>line.name==='رواتب تشغيلية')).toBe(true);
  expect(hq.lines.every(line=>line.monthly_budget.every(value=>value===0))).toBe(true);
  expect(operations.lines.every(line=>line.monthly_budget.every(value=>value===0))).toBe(true);
 });
 it('normalizes legacy lines without leaking another center into the list',()=>{
  const legacy=createDefaultBudgetPlan(2027);
  legacy.lines.find(line=>line.name==='الرواتب')!.monthly_budget[0]=125;
  const hq=normalizeCostCenterBudgetPlan(legacy,'HQ');
  const operations=normalizeCostCenterBudgetPlan(legacy,'OPERATIONS');
  expect(hq.lines.map(line=>line.name)).toEqual(['إيرادات أخرى','رواتب إدارية','إيجار المقر والخدمات','التسويق والعلامة التجارية','أتعاب مهنية واستشارات','تقنية وأنظمة إدارية','الإنفاق الرأسمالي','خدمة الدين','مخصص ومدفوعات الزكاة']);
  expect(operations.lines.map(line=>line.name)).toEqual(['الإيرادات التشغيلية','تكلفة المبيعات','رواتب تشغيلية','إيجارات المواقع التشغيلية','تسويق تشغيلي','صيانة وتشغيل','مواد ومستلزمات تشغيل','نقل ولوجستيات','أنظمة وتقنية تشغيلية','الإنفاق الرأسمالي']);
  expect(hq.lines.find(line=>line.name==='رواتب إدارية')!.monthly_budget[0]).toBe(125);
  expect(operations.lines.some(line=>line.name==='رواتب إدارية')).toBe(false);
 });
 it('selects meaningful rows when production data contains duplicate line items',()=>{
  const saved=createCostCenterBudgetPlan('HQ',2027);
  const salaries=saved.lines.find(line=>line.name==='رواتب إدارية')!;
  const duplicate={...salaries,monthly_budget:Array(12).fill(900)};
  saved.lines=[salaries,duplicate,...saved.lines.filter(line=>line!==salaries)];
  const normalized=normalizeCostCenterBudgetPlan(saved,'HQ');
  expect(normalized.lines.find(line=>line.name==='رواتب إدارية')!.monthly_budget[0]).toBe(900);
 });
 it('keeps the latest edited duplicate even when its value is reduced to zero',()=>{
  const saved=createCostCenterBudgetPlan('HQ',2027);
  const salaries=saved.lines.find(line=>line.name==='رواتب إدارية')!;
  const legacy={...salaries,id:'00000000-0000-0000-0000-000000000001',monthly_budget:Array(12).fill(900),updated_at:'2026-09-20T10:00:00.000Z'};
  const edited={...salaries,id:'00000000-0000-0000-0000-000000000002',monthly_budget:Array(12).fill(0),updated_at:'2026-09-21T10:00:00.000Z'};
  const normalized=normalizeCostCenterBudgetPlan({...saved,lines:[legacy,edited,...saved.lines.filter(line=>line!==salaries)]} as any,'HQ');
  expect(normalized.lines.find(line=>line.name==='رواتب إدارية')!.monthly_budget[0]).toBe(0);
 });
 it('selects the newest persisted row when a cost-center line id is missing',()=>{
  const template=createCostCenterBudgetPlan('OPERATIONS',2027),line=template.lines[0];
  const old={...line,id:'00000000-0000-0000-0000-000000000010',updated_at:'2026-09-20T10:00:00.000Z'};
  const newest={...line,id:'00000000-0000-0000-0000-000000000011',updated_at:'2026-09-21T10:00:00.000Z'};
  expect(selectPersistedBudgetLine({...line,id:undefined},[old,newest])?.id).toBe(newest.id);
 });
 it('preserves budget line ids through request validation so saves update rows',()=>{
  const plan=createCostCenterBudgetPlan('HQ',2027),id='00000000-0000-4000-8000-000000000003';
  const parsed=budgetPlanSchema.parse({...plan,lines:plan.lines.map((line,index)=>index===0?{...line,id}:line)});
  expect(parsed.lines[0].id).toBe(id);
 });
 it('does not turn zero-budget variance into a false percentage or status',()=>{
  expect(budgetVariancePercent(100,0)).toBeNull();
  expect(isBudgetVarianceFavorable('OPEX',0,100)).toBe(false);
  expect(isBudgetVarianceFavorable('REVENUE',0,100)).toBe(true);
  expect(isBudgetVarianceFavorable('OPEX',0,0)).toBeNull();
 });
});
