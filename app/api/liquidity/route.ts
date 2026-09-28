import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/services/auth';
import { requireOrganizationMember, requireOrganizationAdmin } from '@/services/organization-access';

const accountSchema = z.object({
  organization_id: z.string().uuid(), entity_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120), account_type: z.enum(['BANK','CASH','WALLET','INVESTMENT','OTHER']).default('BANK'),
  currency: z.string().length(3).default('SAR'), current_balance: z.coerce.number(), restricted_balance: z.coerce.number().min(0).default(0),
  uncleared_balance: z.coerce.number().min(0).default(0), current_balance_base: z.coerce.number(), restricted_balance_base: z.coerce.number().min(0).default(0),
  uncleared_balance_base: z.coerce.number().min(0).default(0), notes: z.string().max(500).default(''),
});
const flowSchema = z.object({
  organization_id: z.string().uuid(), entity_id: z.string().uuid().nullable().optional(), account_id: z.string().uuid().nullable().optional(),
  direction: z.enum(['INFLOW','OUTFLOW']), flow_type: z.enum(['OPERATING','PAYROLL','TAX','FINANCING','INVESTMENT','TRANSFER','OTHER']).default('OPERATING'),
  title: z.string().trim().min(1).max(160), counterparty: z.string().max(160).default(''), due_date: z.string().date(), amount: z.coerce.number().positive(),
  currency: z.string().length(3).default('SAR'), base_amount: z.coerce.number().positive(), status: z.enum(['ACTUAL','CONFIRMED','EXPECTED']).default('EXPECTED'),
  source: z.enum(['MANUAL','INVOICE','IMPORT','VAT','ACCOUNTING']).default('MANUAL'), reference: z.string().max(120).default(''), notes: z.string().max(500).default(''),
});
const status = (e: unknown) => e instanceof Error && e.message === 'UNAUTHORIZED' ? 401 : e instanceof Error && /ACCESS_REQUIRED|ADMIN_REQUIRED/.test(e.message) ? 403 : 400;

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const params = new URL(request.url).searchParams;
    const organizationId = params.get('organization_id');
    if (!organizationId) return NextResponse.json({ error: 'ORGANIZATION_ID_REQUIRED' }, { status: 400 });
    await requireOrganizationMember(supabase, user.id, organizationId);
    const { data: organization, error: orgError } = await supabase.from('organizations').select('id,name,entity_type,base_currency,organization_kind,parent_organization_id').eq('id', organizationId).single();
    if (orgError) throw orgError;
    let organizationIds = [organizationId];
    if (params.get('scope') === 'group' && organization.organization_kind === 'HOLDING') {
      const { data: children, error } = await supabase.from('organizations').select('id,name,entity_type,base_currency,organization_kind,parent_organization_id').eq('parent_organization_id', organizationId);
      if (error) throw error;
      for (const child of children ?? []) {
        const { data: membership } = await supabase.from('organization_members').select('user_id').eq('organization_id', child.id).eq('user_id', user.id).eq('status', 'ACTIVE').maybeSingle();
        if (membership) organizationIds.push(child.id);
      }
    }
    const [accountsResult, flowsResult, entitiesResult, organizationsResult, fxResult] = await Promise.all([
      supabase.from('liquidity_accounts').select('*').in('organization_id', organizationIds).eq('active', true).order('created_at'),
      supabase.from('liquidity_flows').select('*').in('organization_id', organizationIds).order('due_date', { ascending: true }).limit(1500),
      supabase.from('organization_entities').select('id,name,organization_id,entity_type').in('organization_id', organizationIds).eq('active', true).order('name'),
      supabase.from('organizations').select('id,name,entity_type,base_currency').in('id', organizationIds),
      supabase.from('fx_rates').select('organization_id,from_currency,to_currency,rate,valuation_date').or(`organization_id.is.null,organization_id.in.(${organizationIds.join(',')})`).order('valuation_date',{ascending:false}).limit(600),
    ]);
    for (const result of [accountsResult, flowsResult, entitiesResult, organizationsResult, fxResult]) if (result.error) throw result.error;
    const organizations = organizationsResult.data ?? [];
    let accounts: any[] = accountsResult.data ?? [];
    let flows: any[] = flowsResult.data ?? [];
    const fxMissing: string[] = [];
    if (organizationIds.length > 1) {
      const targetCurrency = organization.base_currency;
      const currencyByOrg = new Map(organizations.map((item: any) => [item.id, item.base_currency]));
      const multipliers = new Map<string, number>([[organizationId, 1]]);
      for (const childId of organizationIds.slice(1)) {
        const sourceCurrency = currencyByOrg.get(childId);
        if (!sourceCurrency || sourceCurrency === targetCurrency) { multipliers.set(childId, 1); continue; }
        const rows = (fxResult.data ?? []).filter((row: any) => (row.organization_id === childId || row.organization_id === null));
        const direct = rows.find((row: any) => row.from_currency === sourceCurrency && row.to_currency === targetCurrency);
        const inverse = rows.find((row: any) => row.from_currency === targetCurrency && row.to_currency === sourceCurrency);
        const rate = direct ? Number(direct.rate) : inverse ? 1 / Number(inverse.rate) : 0;
        if (rate > 0 && Number.isFinite(rate)) multipliers.set(childId, rate);
        else { multipliers.set(childId, 0); fxMissing.push(organizations.find((o: any)=>o.id===childId)?.name ?? childId); }
      }
      const convert = (row: any) => {
        const rate = multipliers.get(row.organization_id) ?? 1;
        return { ...row, current_balance_base: Number(row.current_balance_base) * rate, restricted_balance_base: Number(row.restricted_balance_base) * rate, uncleared_balance_base: Number(row.uncleared_balance_base) * rate, base_amount: row.base_amount == null ? undefined : Number(row.base_amount) * rate, fx_conversion_missing: rate === 0 };
      };
      accounts = accounts.map(convert);
      flows = flows.map(convert);
    }
    return NextResponse.json({ organization, organizations, organization_ids: organizationIds, accounts, flows, entities: entitiesResult.data ?? [], fx_missing: fxMissing });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'LIQUIDITY_LOAD_FAILED' }, { status: status(error) }); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const kind = body.kind;
    if (kind !== 'account' && kind !== 'flow') return NextResponse.json({ error: 'LIQUIDITY_RECORD_KIND_REQUIRED' }, { status: 400 });
    const payload: any = kind === 'account' ? accountSchema.parse(body) : flowSchema.parse(body);
    await requireOrganizationMember(supabase, user.id, payload.organization_id);
    await requireOrganizationAdmin(supabase, user.id, payload.organization_id).catch(async () => {
      const { data: membership } = await supabase.from('organization_members').select('role').eq('organization_id', payload.organization_id).eq('user_id', user.id).eq('status', 'ACTIVE').maybeSingle();
      if (!membership || !['OWNER','ADMIN','ACCOUNTANT','ADVISOR'].includes(membership.role)) throw new Error('ORGANIZATION_ADMIN_REQUIRED');
    });
    if (payload.entity_id) {
      const { data, error } = await supabase.from('organization_entities').select('id').eq('id', payload.entity_id).eq('organization_id', payload.organization_id).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('ENTITY_ORGANIZATION_MISMATCH');
    }
    if (kind === 'flow' && payload.account_id) {
      const { data, error } = await supabase.from('liquidity_accounts').select('id').eq('id', payload.account_id).eq('organization_id', payload.organization_id).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('ACCOUNT_ORGANIZATION_MISMATCH');
    }
    const { data, error } = kind === 'account'
      ? await supabase.from('liquidity_accounts').insert({ ...payload, created_by: user.id }).select().single()
      : await supabase.from('liquidity_flows').insert({ ...payload, created_by: user.id }).select().single();
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'LIQUIDITY_SAVE_FAILED' }, { status: status(error) }); }
}
