import {describe, expect, it} from 'vitest';
import {createCostCenterBudgetPlan} from './budget-planning';
import {applyOrganizationBudgetZakatProjection, organizationBudgetZakatBaseline} from './budget-zakat-source';

const row = (id: string, organization: string | null, overrides: Record<string, unknown> = {}) => ({
  id, organization_id: organization, currency: 'SAR', assessment_date: '2026-01-01',
  workflow: {assessment_id: id, organization_id: organization!, amount: 200, final_base: 8000,
    final_rate: .025, remaining: 150, paid: 50, event_status: 'ACTUAL', approved: true,
    approved_at: '2026-01-02', period_start: '2025-01-01', period_end: '2025-12-31',
    financial_event_id: 'event', obligation_id: 'obligation', flow_id: 'flow', review_reference: 'review'},
  ...overrides,
});

describe('company budget Zakat source boundary', () => {
  it('uses only the selected company, currency and approved corporate source', () => {
    const rows = [row('personal', null), row('other-company', 'b'), row('approved', 'a'),
      row('different-currency', 'a', {currency: 'USD', assessment_date: '2026-10-01'}),
      row('draft', 'a', {workflow: null, assessment_date: '2026-11-01'})];
    expect(organizationBudgetZakatBaseline(rows, 'a', 'SAR')).toEqual({
      organizationId: 'a', assessmentId: 'approved', currency: 'SAR', due: 200,
      remaining: 150, assessmentDate: '2026-01-01',
    });
    expect(organizationBudgetZakatBaseline(rows, 'unrelated', 'SAR')).toBeNull();
    expect(organizationBudgetZakatBaseline(rows, '', 'SAR')).toBeNull();
  });

  it('does not use a cancelled or reversed workflow, or a mismatched workflow identity', () => {
    for (const event_status of ['CANCELLED', 'REVERSED', 'COMMITTED']) {
      const a = row('a1', 'a'); a.workflow.event_status = event_status; a.workflow.approved = false;
      expect(organizationBudgetZakatBaseline([a], 'a', 'SAR')).toBeNull();
    }
    const a = row('a1', 'a'); a.workflow.organization_id = 'b';
    expect(organizationBudgetZakatBaseline([a], 'a', 'SAR')).toBeNull();
  });

  it('chooses the newest approved company assessment without aggregating currencies or companies', () => {
    const older = row('old', 'a'), newer = row('new', 'a', {assessment_date: '2026-02-01'});
    newer.workflow.amount = 800;
    expect(organizationBudgetZakatBaseline([older, newer], 'a', 'SAR')?.due).toBe(800);
  });

  it('rejects a baseline left over from another company or currency after a banner switch', () => {
    const plan = createCostCenterBudgetPlan('HQ', 2027);
    const baseline = organizationBudgetZakatBaseline([row('approved', 'a')], 'a', 'SAR');
    plan.assumptions = {zakat_budget_growth: .1};
    expect(() => applyOrganizationBudgetZakatProjection(plan, 'b', baseline, [2])).toThrow('BUDGET_ZAKAT_SOURCE_MISMATCH');
    expect(() => applyOrganizationBudgetZakatProjection({...plan, currency: 'USD'}, 'a', baseline, [2])).toThrow('BUDGET_ZAKAT_SOURCE_MISMATCH');
    expect(() => applyOrganizationBudgetZakatProjection({...plan, cost_center: 'ALL'}, 'a', baseline, [2])).toThrow('BUDGET_ORGANIZATION_REQUIRED');
  });

  it('permits an explicit manual estimate including zero without reading personal data', () => {
    const plan = createCostCenterBudgetPlan('HQ', 2027);
    for (const amount of [0, 1200]) {
      plan.assumptions = {zakat_budget_manual_override: amount};
      const next = applyOrganizationBudgetZakatProjection(plan, 'a', null, [2, 5]);
      expect(next.lines.find(line => line.category === 'ZAKAT')?.monthly_budget.reduce((sum, n) => sum + n, 0)).toBe(amount);
      expect(next.assumptions.zakat_source).toBe('MANUAL_BUDGET_ESTIMATE');
      expect(next.assumptions.zakat_source_organization_id).toBe('a');
      expect(next.assumptions.zakat_baseline_due).toBeNull();
    }
  });

  it('rejects a stale saved plan owner even when the baseline or manual override matches the new banner', () => {
    const plan = {...createCostCenterBudgetPlan('HQ', 2027), organization_id: 'a'};
    const baseline = organizationBudgetZakatBaseline([row('approved-b', 'b')], 'b', 'SAR');
    plan.assumptions = {zakat_budget_growth: .1};
    expect(() => applyOrganizationBudgetZakatProjection(plan, 'b', baseline, [2])).toThrow('BUDGET_ZAKAT_SOURCE_MISMATCH');
    plan.assumptions = {zakat_budget_manual_override: 0};
    expect(() => applyOrganizationBudgetZakatProjection(plan, 'b', null, [2])).toThrow('BUDGET_ZAKAT_SOURCE_MISMATCH');
    expect(() => applyOrganizationBudgetZakatProjection({...plan, organization_id: null, resolved_organization_id: 'a'}, 'b', null, [2])).toThrow('BUDGET_ZAKAT_SOURCE_MISMATCH');
  });

  it('uses the approved gross assessment as forecast basis, preserves actuals and records provenance', () => {
    const plan = createCostCenterBudgetPlan('HQ', 2027);
    const baseline = organizationBudgetZakatBaseline([row('approved', 'a')], 'a', 'SAR');
    plan.assumptions = {zakat_budget_growth: .1};
    const zakat = plan.lines.find(line => line.category === 'ZAKAT')!;
    zakat.monthly_actual[0] = 50;
    const next = applyOrganizationBudgetZakatProjection(plan, 'a', baseline, [2, 5]);
    expect(next.assumptions.zakat_budget_estimate).toBe(220);
    expect(next.assumptions.zakat_source_assessment_id).toBe('approved');
    expect(next.lines.find(line => line.category === 'ZAKAT')?.monthly_actual[0]).toBe(50);
    expect(zakat.monthly_budget.reduce((sum, n) => sum + n, 0)).toBe(0);
  });

  it('requires a genuine baseline or explicit manual estimate and an explicit payment schedule', () => {
    const plan = createCostCenterBudgetPlan('HQ', 2027);
    plan.assumptions = {zakat_budget_growth: .1};
    expect(() => applyOrganizationBudgetZakatProjection(plan, 'a', null, [2])).toThrow('BUDGET_ZAKAT_BASELINE_REQUIRED');
    plan.assumptions = {zakat_budget_manual_override: 100};
    expect(() => applyOrganizationBudgetZakatProjection(plan, 'a', null, [])).toThrow('BUDGET_ZAKAT_PAYMENT_MONTH_REQUIRED');
  });
});
