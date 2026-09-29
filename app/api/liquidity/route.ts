import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/services/auth';
import { requireOrganizationMember, requireOrganizationAdmin } from '@/services/organization-access';
import { calculateLiquidityTransfer } from '@/lib/liquidity-transfer';

const accountSchema = z.object({
  organization_id: z.string().uuid(), entity_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120), account_type: z.enum(['BANK','CASH','WALLET','INVESTMENT','OTHER']).default('BANK'),
  currency: z.string().length(3).default('SAR'), current_balance: z.coerce.number(), restricted_balance: z.coerce.number().min(0).default(0),
  uncleared_balance: z.coerce.number().min(0).default(0), current_balance_base: z.coerce.number(), restricted_balance_base: z.coerce.number().min(0).default(0),
  uncleared_balance_base: z.coerce.number().min(0).default(0), notes: z.string().max(500).default(''),
});
const flowSchema = z.object({
  organization_id: z.string().uuid(), entity_id: z.string().uuid().nullable().optional(), account_id: z.string().uuid().nullable().optional(),
  direction: z.enum(['INFLOW','OUTFLOW']), flow_type: z.enum(['OPERATING','PAYROLL','TAX','FINANCING','INVESTMENT','OTHER']).default('OPERATING'),
  title: z.string().trim().min(1).max(160), counterparty: z.string().max(160).default(''), counterparty_id: z.string().uuid().nullable().optional(), due_date: z.string().date(), amount: z.coerce.number().positive(),
  currency: z.string().length(3).default('SAR'), base_amount: z.coerce.number().positive(), status: z.enum(['ACTUAL','CONFIRMED','EXPECTED']).default('EXPECTED'),
  source: z.enum(['MANUAL','INVOICE','IMPORT','VAT','ACCOUNTING']).default('MANUAL'), reference: z.string().max(120).default(''), notes: z.string().max(500).default(''),
});
const counterpartySchema = z.object({ organization_id: z.string().uuid(), name: z.string().trim().min(1).max(160), party_type: z.enum(['CUSTOMER','SUPPLIER','BOTH','PERSON','OTHER']).default('OTHER'), contact_name: z.string().trim().max(120).default(''), phone: z.string().trim().max(40).default(''), email: z.string().trim().max(160).default(''), notes: z.string().max(500).default('') });
const transferSchema = z.object({
  organization_id: z.string().uuid(), source_account_id: z.string().uuid(), destination_account_id: z.string().uuid(),
  amount: z.coerce.number().positive(), exchange_rate: z.coerce.number().positive(), transfer_date: z.string().date(),
  source_title: z.string().trim().min(1).max(160), destination_title: z.string().trim().min(1).max(160),
  reference: z.string().max(120).default(''), notes: z.string().max(500).default(''),
});
const status = (e: unknown) => e instanceof Error && e.message === 'UNAUTHORIZED' ? 401 : e instanceof Error && /ACCESS_REQUIRED|ADMIN_REQUIRED/.test(e.message) ? 403 : 400;
const canWriteLiquidity = async (supabase: any, userId: string, organizationId: string) => { const { data } = await supabase.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', userId).eq('status', 'ACTIVE').maybeSingle(); return !!data && ['OWNER','ADMIN','ACCOUNTANT','ADVISOR'].includes(data.role); };

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
    const { data: counterparties, error: counterpartiesError } = await supabase.from('liquidity_counterparties').select('*').in('organization_id', organizationIds).order('name');
    if (counterpartiesError) throw counterpartiesError;
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
        return { ...row, current_balance_base: Number(row.current_balance_base) * rate, restricted_balance_base: Number(row.restricted_balance_base) * rate, uncleared_balance_base: Number(row.uncleared_balance_base) * rate, raw_base_amount: row.base_amount == null ? undefined : Number(row.base_amount), base_amount: row.base_amount == null ? undefined : Number(row.base_amount) * rate, fx_conversion_missing: rate === 0 };
      };
      accounts = accounts.map(convert);
      flows = flows.map(convert);
    }
    accounts = accounts.map((account: any) => {
      const owner = organizations.find((item: any) => item.id === account.organization_id);
      if (!owner || account.currency === owner.base_currency) return { ...account, base_rate: 1 };
      const rows = (fxResult.data ?? []).filter((row: any) => row.organization_id === account.organization_id || row.organization_id === null);
      const direct = rows.find((row: any) => row.from_currency === account.currency && row.to_currency === owner.base_currency);
      const inverse = rows.find((row: any) => row.from_currency === owner.base_currency && row.to_currency === account.currency);
      const rate = direct ? Number(direct.rate) : inverse ? 1 / Number(inverse.rate) : 0;
      return { ...account, base_rate: rate > 0 && Number.isFinite(rate) ? rate : null };
    });
    return NextResponse.json({ organization, organizations, organization_ids: organizationIds, accounts, flows, entities: entitiesResult.data ?? [], counterparties: counterparties ?? [], fx_missing: fxMissing });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'LIQUIDITY_LOAD_FAILED' }, { status: status(error) }); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const kind = body.kind;
    if (kind === 'counterparty') { const input = counterpartySchema.parse(body); await requireOrganizationMember(supabase, user.id, input.organization_id); if (!await canWriteLiquidity(supabase, user.id, input.organization_id)) throw new Error('ORGANIZATION_ADMIN_REQUIRED'); const { data, error } = await supabase.from('liquidity_counterparties').insert(input).select().single(); if (error) throw error; return NextResponse.json(data, { status: 201 }); }
    if (kind === 'transfer') {
      const input = transferSchema.parse(body);
      await requireOrganizationMember(supabase, user.id, input.organization_id);
      await requireOrganizationAdmin(supabase, user.id, input.organization_id).catch(async () => {
        const { data: membership } = await supabase.from('organization_members').select('role').eq('organization_id', input.organization_id).eq('user_id', user.id).eq('status', 'ACTIVE').maybeSingle();
        if (!membership || !['OWNER','ADMIN','ACCOUNTANT','ADVISOR'].includes(membership.role)) throw new Error('ORGANIZATION_ADMIN_REQUIRED');
      });
      const [{ data: accounts, error: accountsError }, { data: organization, error: organizationError }] = await Promise.all([
        supabase.from('liquidity_accounts').select('id,organization_id,currency,active').in('id', [input.source_account_id, input.destination_account_id]).eq('organization_id', input.organization_id),
        supabase.from('organizations').select('base_currency').eq('id', input.organization_id).single(),
      ]);
      if (accountsError) throw accountsError;
      if (organizationError) throw organizationError;
      const source = accounts?.find((account: any) => account.id === input.source_account_id);
      const destination = accounts?.find((account: any) => account.id === input.destination_account_id);
      if (!source?.active || !destination?.active) throw new Error('TRANSFER_ACCOUNT_NOT_FOUND');
      if (input.source_account_id === input.destination_account_id) throw new Error('TRANSFER_ACCOUNTS_MUST_DIFFER');
      const currencies = [...new Set([source.currency, destination.currency].filter((code: string) => code !== organization.base_currency))];
      const { data: rates, error: ratesError } = currencies.length ? await supabase.from('fx_rates').select('organization_id,from_currency,to_currency,rate,valuation_date').or(`organization_id.eq.${input.organization_id},organization_id.is.null`).lte('valuation_date', input.transfer_date).in('from_currency', currencies.concat(organization.base_currency)).order('valuation_date', { ascending: false }).limit(300) : { data: [], error: null };
      if (ratesError) throw ratesError;
      const baseRate = (code: string) => {
        if (code === organization.base_currency) return 1;
        const scoped = (rates ?? []).filter((row: any) => row.organization_id === input.organization_id);
        const global = (rates ?? []).filter((row: any) => row.organization_id === null);
        for (const rows of [scoped, global]) {
          const direct = rows.find((row: any) => row.from_currency === code && row.to_currency === organization.base_currency);
          if (direct && Number(direct.rate) > 0) return Number(direct.rate);
          const inverse = rows.find((row: any) => row.from_currency === organization.base_currency && row.to_currency === code);
          if (inverse && Number(inverse.rate) > 0) return 1 / Number(inverse.rate);
        }
        throw new Error(`TRANSFER_BASE_RATE_REQUIRED:${code}`);
      };
      const computed = calculateLiquidityTransfer({
        sourceAccountId: input.source_account_id, destinationAccountId: input.destination_account_id,
        sourceOrganizationId: input.organization_id, destinationOrganizationId: input.organization_id,
        amount: input.amount, exchangeRate: source.currency === destination.currency ? 1 : input.exchange_rate,
        sourceBaseRate: baseRate(source.currency), destinationBaseRate: baseRate(destination.currency),
      });
      const { data, error } = await supabase.rpc('create_liquidity_transfer', {
        p_organization_id: input.organization_id,
        p_source_account_id: input.source_account_id,
        p_destination_account_id: input.destination_account_id,
        p_source_amount: computed.sourceAmount,
        p_destination_amount: computed.destinationAmount,
        p_source_base_amount: computed.sourceBaseAmount,
        p_destination_base_amount: computed.destinationBaseAmount,
        p_exchange_rate: source.currency === destination.currency ? 1 : input.exchange_rate,
        p_transfer_date: input.transfer_date,
        p_source_title: input.source_title,
        p_destination_title: input.destination_title,
        p_reference: input.reference,
        p_notes: input.notes,
      });
      if (error) throw error;
      return NextResponse.json(data, { status: 201 });
    }
    if (kind !== 'account' && kind !== 'flow') return NextResponse.json({ error: 'LIQUIDITY_RECORD_KIND_REQUIRED' }, { status: 400 });
    let payload: any = kind === 'account' ? accountSchema.parse(body) : flowSchema.parse(body);
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
    if (kind === 'flow' && payload.counterparty_id) { const { data: counterparty, error } = await supabase.from('liquidity_counterparties').select('id,name').eq('id', payload.counterparty_id).eq('organization_id', payload.organization_id).eq('active', true).maybeSingle(); if (error) throw error; if (!counterparty) throw new Error('COUNTERPARTY_ORGANIZATION_MISMATCH'); payload = { ...payload, counterparty: counterparty.name }; }
    const { data, error } = kind === 'account'
      ? await supabase.from('liquidity_accounts').insert(payload).select().single()
      : await supabase.from('liquidity_flows').insert(payload).select().single();
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'LIQUIDITY_SAVE_FAILED' }, { status: status(error) }); }
}

