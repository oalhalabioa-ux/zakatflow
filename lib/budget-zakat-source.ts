import {corporateStatus, type CorporateWorkflow} from './corporate-zakat-assessment';
import type {BudgetLine, BudgetPlan} from './budget-planning';

export type BudgetZakatBaseline = {
  organizationId: string;
  assessmentId: string;
  currency: string;
  due: number;
  remaining: number;
  assessmentDate: string;
};

type Assessment = {
  id: string;
  organization_id: string | null;
  currency: string;
  assessment_date: string;
  created_at?: string;
  workflow?: CorporateWorkflow | null;
};

/** Read the existing approved corporate result; never use a personal dashboard total. */
export function organizationBudgetZakatBaseline(
  rows: Assessment[], organizationId: string, currency: string,
): BudgetZakatBaseline | null {
  if (!organizationId) return null;
  const row = rows.filter(item => item.organization_id === organizationId &&
    item.currency === currency && item.workflow?.organization_id === organizationId &&
    item.workflow.assessment_id === item.id &&
    ['APPROVED', 'UNPAID', 'PARTIAL', 'PAID'].includes(corporateStatus(item.workflow)) &&
    Number.isFinite(Number(item.workflow.amount)) && Number(item.workflow.amount) >= 0)
    .sort((a, b) => b.assessment_date.localeCompare(a.assessment_date) ||
      (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
  return row?.workflow ? {
    organizationId, assessmentId: row.id, currency,
    due: Number(row.workflow.amount), remaining: Number(row.workflow.remaining),
    assessmentDate: row.assessment_date,
  } : null;
}

/** Apply the existing forecast method only to the currently selected company's plan. */
export function applyOrganizationBudgetZakatProjection(
  plan: BudgetPlan, organizationId: string, baseline: BudgetZakatBaseline | null, months: number[],
): BudgetPlan {
  if (!organizationId || plan.cost_center === 'ALL') throw Error('BUDGET_ORGANIZATION_REQUIRED');
  if ((plan.organization_id && plan.organization_id !== organizationId) ||
      (plan.resolved_organization_id && plan.resolved_organization_id !== organizationId)) {
    throw Error('BUDGET_ZAKAT_SOURCE_MISMATCH');
  }
  if (baseline && (baseline.organizationId !== organizationId || baseline.currency !== plan.currency)) {
    throw Error('BUDGET_ZAKAT_SOURCE_MISMATCH');
  }
  const rawManual = plan.assumptions.zakat_budget_manual_override;
  const hasManual = rawManual !== undefined && rawManual !== null && rawManual !== '';
  const manual = Number(rawManual);
  if (hasManual && (!Number.isFinite(manual) || manual < 0)) throw Error('BUDGET_ZAKAT_ESTIMATE_INVALID');
  if (!baseline && !hasManual) throw Error('BUDGET_ZAKAT_BASELINE_REQUIRED');
  if (!hasManual && plan.assumptions.zakat_budget_growth === undefined) throw Error('BUDGET_ZAKAT_GROWTH_REQUIRED');
  const paymentMonths = [...new Set(months)].filter(month => Number.isInteger(month) && month >= 0 && month < 12).sort((a, b) => a - b);
  if (!paymentMonths.length) throw Error('BUDGET_ZAKAT_PAYMENT_MONTH_REQUIRED');
  const growth = Number(plan.assumptions.zakat_budget_growth ?? 0);
  if (!Number.isFinite(growth) || growth < -1) throw Error('BUDGET_ZAKAT_ESTIMATE_INVALID');
  const assessmentYear = baseline ? Number(baseline.assessmentDate.slice(0, 4)) : null;
  const years = assessmentYear === null ? 0 : Math.max(0, plan.fiscal_year - assessmentYear);
  const modelEstimate = baseline ? Math.max(0, Math.round(baseline.due * Math.pow(1 + growth, years))) : null;
  const projected = hasManual ? manual : modelEstimate!;
  const schedule = Array.from({length: 12}, (_, month) => paymentMonths.includes(month) ? projected / paymentMonths.length : 0);
  const index = plan.lines.findIndex(line => line.category === 'ZAKAT');
  const lines = index >= 0 ? plan.lines.map((line, i) => i === index ? {
    ...line, monthly_budget: [...schedule], monthly_forecast: [...schedule],
  } : line) : [...plan.lines, {
    category: 'ZAKAT', name: 'مخصص ومدفوعات الزكاة', line_type: 'CASH', sort_order: 110,
    monthly_budget: [...schedule], monthly_actual: Array(12).fill(0), monthly_forecast: [...schedule],
  } as BudgetLine];
  return {...plan, lines, assumptions: {
    ...plan.assumptions,
    zakat_source: hasManual ? 'MANUAL_BUDGET_ESTIMATE' : 'CORPORATE_APPROVED_ASSESSMENT',
    zakat_source_organization_id: organizationId,
    zakat_source_assessment_id: baseline?.assessmentId ?? null,
    zakat_baseline_due: baseline?.due ?? null,
    zakat_baseline_assessment_date: baseline?.assessmentDate ?? null,
    zakat_baseline_year: assessmentYear,
    zakat_budget_growth: growth, zakat_budget_model_estimate: modelEstimate,
    zakat_budget_estimate: projected,
    zakat_payment_months: paymentMonths, zakat_payment_month: paymentMonths[0],
  }};
}
