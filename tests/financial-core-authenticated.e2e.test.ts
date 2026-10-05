import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Role = 'owner' | 'admin' | 'viewer';
type SessionContext = { role: Role; userId: string; client: SupabaseClient };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const orgId = process.env.E2E_ORGANIZATION_ID ?? '85acbac0-e8b4-434c-a22b-3ec13b55e1a7';
const holdingId = process.env.E2E_HOLDING_ID ?? '4673c66d-698d-43bb-b638-28dd556bbc27';
const recognitionEventId = process.env.E2E_RECOGNITION_EVENT_ID ?? 'c5a33326-0719-4b63-81f4-de27257e8681';
const writeFixture = process.env.E2E_WRITE_FIXTURE === 'true';
const configured = Boolean(
  url && anonKey &&
  process.env.E2E_OWNER_EMAIL && process.env.E2E_OWNER_PASSWORD &&
  process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD &&
  process.env.E2E_VIEWER_EMAIL && process.env.E2E_VIEWER_PASSWORD,
);
if (process.env.E2E_REQUIRE_CONFIG === 'true' && !configured) {
  throw new Error('E2E_CONFIG_MISSING: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and all E2E_*_EMAIL/E2E_*_PASSWORD QA secrets');
}

function env(role: Role, suffix: 'EMAIL' | 'PASSWORD' | 'USER_ID') {
  return process.env[`E2E_${role.toUpperCase()}_${suffix}`];
}

function makeClient() {
  if (!url || !anonKey) throw new Error('E2E_SUPABASE_ENV_MISSING');
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function signIn(role: Role): Promise<SessionContext> {
  const email = env(role, 'EMAIL');
  const password = env(role, 'PASSWORD');
  if (!email || !password) throw new Error(`E2E_${role.toUpperCase()}_CREDENTIALS_MISSING`);
  const client = makeClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user || !data.session) throw new Error(error?.message ?? 'E2E_SIGN_IN_FAILED');
  const expected = env(role, 'USER_ID');
  if (expected && data.user.id !== expected) throw new Error(`E2E_${role.toUpperCase()}_IDENTITY_MISMATCH`);
  return { role, userId: data.user.id, client };
}

async function expectDenied(promise: any) {
  const { error } = await promise;
  expect(error).toBeTruthy();
}

async function report(ctx: SessionContext, planId: string) {
  const { data, error } = await ctx.client.rpc('financial_budget_report', { p_plan: planId });
  if (error) throw new Error(error.message);
  return data as { rows?: Array<Record<string, unknown>>; unmapped_amount?: number };
}

function sum(rows: Array<Record<string, unknown>>, key: string) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

describe.skipIf(!configured)('Authenticated Financial Core QA E2E', () => {
  let owner: SessionContext;
  let admin: SessionContext;
  let viewer: SessionContext;
  let planId = process.env.E2E_PLAN_ID ?? '';
  let createdPlanId: string | undefined;
  let budgetLineId = process.env.E2E_BUDGET_LINE_ID ?? '';
  let classificationId = process.env.E2E_CLASSIFICATION_ID ?? '';

  beforeAll(async () => {
    owner = await signIn('owner');
    admin = await signIn('admin');
    viewer = await signIn('viewer');

    const { data, error } = await admin.client.from('organizations').select('id').eq('id', orgId).single();
    if (error || !data) throw new Error(`E2E_ORGANIZATION_READ_FAILED:${error?.message ?? 'missing'}`);

    if (!planId && writeFixture) {
      const { data: existing, error: lookupError } = await owner.client
        .from('budget_plans')
        .select('id')
        .eq('user_id', owner.userId)
        .eq('fiscal_year', 2026)
        .eq('scenario', 'BASE')
        .eq('organization_name', 'Phase 2E QA E2E Subsidiary A')
        .eq('cost_center', 'E2E_OPERATIONS')
        .maybeSingle();
      if (lookupError) throw new Error(lookupError.message);
      if (existing?.id) planId = existing.id;
      else {
        const { data: plan, error: planError } = await owner.client.from('budget_plans').insert({
          name: 'Phase 2E Authenticated E2E 2026', fiscal_year: 2026, currency: 'SAR', scenario: 'BASE',
          status: 'DRAFT', organization_name: 'Phase 2E QA E2E Subsidiary A', cost_center: 'E2E_OPERATIONS',
          opening_cash: 0, minimum_cash_target: 0, assumptions: {}, notes: 'QA harness fixture',
          user_id: owner.userId, created_by: owner.userId,
        }).select('id').single();
        if (planError || !plan) throw new Error(planError?.message ?? 'E2E_PLAN_CREATE_FAILED');
        planId = plan.id;
        createdPlanId = plan.id;
        const monthlyBudget = Array(12).fill(0); monthlyBudget[9] = 1000;
        const monthlyActual = Array(12).fill(0); monthlyActual[9] = 90;
        const { data: line, error: lineError } = await owner.client.from('budget_lines').insert({
          plan_id: plan.id, user_id: owner.userId, category: 'OPEX', name: 'QA Operating Expense',
          line_type: 'EXPENSE', sort_order: 1, monthly_budget: monthlyBudget, monthly_actual: monthlyActual,
          monthly_forecast: monthlyBudget, active: true,
        }).select('id').single();
        if (lineError || !line) throw new Error(lineError?.message ?? 'E2E_BUDGET_LINE_CREATE_FAILED');
        budgetLineId = line.id;
      }
      if (!budgetLineId) {
        const { data: line, error: lineError } = await owner.client.from('budget_lines').select('id').eq('plan_id', planId).eq('active', true).order('sort_order').limit(1).single();
        if (lineError || !line) throw new Error(lineError?.message ?? 'E2E_BUDGET_LINE_REQUIRED');
        budgetLineId = line.id;
      }
      if (!classificationId) throw new Error('E2E_CLASSIFICATION_ID_REQUIRED_FOR_MAPPING');
      const { error: bindError } = await owner.client.rpc('configure_financial_budget', {
        p_key: `phase2e-e2e-bind-${planId}`,
        p_payload: { action: 'BIND_PLAN', organization_id: orgId, plan_id: planId, entity_id: null, cost_center_id: null, fiscal_start: '2026-01-01' },
      });
      if (bindError && !bindError.message.includes('ALREADY_BOUND')) throw new Error(bindError.message);
      const { error: mapError } = await owner.client.rpc('configure_financial_budget', {
        p_key: `phase2e-e2e-map-${planId}-${classificationId}`,
        p_payload: { action: 'MAP', organization_id: orgId, plan_id: planId, budget_line_id: budgetLineId, classification_id: classificationId, entity_id: null, cost_center_id: null, metric_policy: 'OPEX', effective_from: '2026-01-01', effective_to: '2026-12-31' },
      });
      if (mapError && !mapError.message.includes('ALREADY_MAPPED') && !mapError.message.includes('OVERLAPPING_MAPPING_DENIED')) throw new Error(mapError.message);
    }
    if (!planId) throw new Error('E2E_PLAN_ID_REQUIRED');

    // Consolidation requires exactly one company-level plan for every organization
    // in the holding tree. Bootstrap the holding plan through the authenticated
    // Owner session and the same RLS/RPC path used by the application.
    if (writeFixture) {
      const holdingPlanName = 'Phase 2E Authenticated E2E Holding 2026';
      const holdingOrgName = 'Phase 2E QA E2E Holding 20261003';
      let holdingPlanId = '';

      const { data: existingHolding, error: holdingLookupError } = await owner.client
        .from('budget_plans')
        .select('id')
        .eq('user_id', owner.userId)
        .eq('fiscal_year', 2026)
        .eq('scenario', 'BASE')
        .eq('organization_name', holdingOrgName)
        .eq('cost_center', 'ALL')
        .maybeSingle();
      if (holdingLookupError) throw new Error(holdingLookupError.message);

      if (existingHolding?.id) holdingPlanId = existingHolding.id;
      else {
        const { data: holdingPlan, error: holdingPlanError } = await owner.client.from('budget_plans').insert({
          name: holdingPlanName, fiscal_year: 2026, currency: 'SAR', scenario: 'BASE',
          status: 'DRAFT', organization_name: holdingOrgName, cost_center: 'ALL',
          opening_cash: 0, minimum_cash_target: 0, assumptions: {}, notes: 'QA consolidation fixture',
          user_id: owner.userId, created_by: owner.userId,
        }).select('id').single();
        if (holdingPlanError || !holdingPlan) throw new Error(holdingPlanError?.message ?? 'E2E_HOLDING_PLAN_CREATE_FAILED');
        holdingPlanId = holdingPlan.id;
      }

      const { error: holdingBindError } = await owner.client.rpc('configure_financial_budget', {
        p_key: `phase2e-e2e-holding-bind-${holdingPlanId}`,
        p_payload: { action: 'BIND_PLAN', organization_id: holdingId, plan_id: holdingPlanId, entity_id: null, cost_center_id: null, fiscal_start: '2026-01-01' },
      });
      if (holdingBindError && !holdingBindError.message.includes('ALREADY_BOUND')) throw new Error(holdingBindError.message);
    }
  });

  afterAll(async () => {
    // Fixture cleanup is intentionally opt-in and never touches historical Phase 2F data.
    if (createdPlanId && process.env.E2E_CLEANUP === 'true') {
      await owner.client.from('budget_plans').delete().eq('id', createdPlanId).eq('user_id', owner.userId);
    }
    await Promise.all([owner?.client.auth.signOut(), admin?.client.auth.signOut(), viewer?.client.auth.signOut()]);
  });

  it('auth smoke: creates real sessions with expected identities', () => {
    expect(owner.userId).toBeTruthy(); expect(admin.userId).toBeTruthy(); expect(viewer.userId).toBeTruthy();
    expect(owner.userId).not.toBe(admin.userId); expect(admin.userId).not.toBe(viewer.userId);
  });

  it('owner/admin report preserves Core, Legacy, Paid and Remaining semantics', async () => {
    const result = await report(admin, planId);
    const rows = result.rows ?? [];
    expect(sum(rows, 'budget_amount')).toBe(1000);
    expect(sum(rows, 'actual_amount')).toBe(100);
    expect(sum(rows, 'legacy_actual')).toBe(90);
    expect(sum(rows, 'reconciliation_difference')).toBe(10);
    expect(sum(rows, 'paid_settled_gross')).toBe(115);
    expect(sum(rows, 'outstanding_gross')).toBe(0);
    expect(sum(rows, 'remaining_budget')).toBe(900);
    expect(result.unmapped_amount ?? 0).toBe(0);
  });

  it('drilldown includes the recognition event and does not treat settlement as recognition', async () => {
    const { data, error } = await admin.client.rpc('financial_budget_drilldown', { p_plan: planId });
    if (error) throw new Error(error.message);
    const facts = (data ?? []) as Array<Record<string, unknown>>;
    expect(facts.some((fact) => fact.event_id === recognitionEventId)).toBe(true);
    expect(facts.filter((fact) => fact.event_type === 'SETTLEMENT').length).toBe(0);
  });

  it('viewer can read only and cannot configure mappings', async () => {
    await expectDenied(viewer.client.rpc('configure_financial_budget', {
      p_key: `phase2e-viewer-denial-${planId}`,
      p_payload: { action: 'MAP', organization_id: orgId, plan_id: planId, budget_line_id: budgetLineId, classification_id: classificationId, entity_id: null, cost_center_id: null, metric_policy: 'OPEX', effective_from: '2026-01-01', effective_to: '2026-12-31' },
    }));
  });

  it('anonymous and cross-organization access are denied', async () => {
    const anonymous = makeClient();
    await expectDenied(anonymous.rpc('financial_budget_report', { p_plan: planId }));
    const crossOrgPlan = process.env.E2E_CROSS_ORG_PLAN_ID;
    if (crossOrgPlan) await expectDenied(admin.client.rpc('financial_budget_report', { p_plan: crossOrgPlan }));
  });

  it('consolidation is available only to a complete authorized holding session', async () => {
    const { data, error } = await owner.client.rpc('financial_budget_consolidated', { p_holding: holdingId, p_year: 2026, p_scenario: 'BASE' });
    if (error) throw new Error(error.message);
    expect(data).toBeTruthy();
  });
});