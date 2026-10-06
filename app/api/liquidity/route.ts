import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/services/auth';
import { requireOrganizationMember, requireOrganizationAdmin } from '@/services/organization-access';
import { calculateLiquidityTransfer } from '@/lib/liquidity-transfer';
import { calculateIntercompanyTransfer } from '@/lib/intercompany-transfer';
import { executeFinancialEventAction } from '@/services/financial-events';

const accountSchema = z.object({
  organization_id: z.string().uuid(), entity_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(120), account_type: z.enum(['BANK','CASH','WALLET','INVESTMENT','OTHER']).default('BANK'),
  currency: z.string().length(3).default('SAR'), current_balance: z.coerce.number(), restricted_balance: z.coerce.number().min(0).default(0),
  uncleared_balance: z.coerce.number().min(0).default(0), current_balance_base: z.coerce.number(), restricted_balance_base: z.coerce.number().min(0).default(0),
  uncleared_balance_base: z.coerce.number().min(0).default(0), notes: z.string().max(500).default(''),
});
const flowSchema = z.object({
  organization_id: z.string().uuid(), entity_id: z.string().uuid().nullable().optional(), account_id: z.string().uuid().nullable().optional(),
  direction: z.enum(['INFLOW','OUTFLOW']), flow_type: z.enum(['OPERATING','PAYROLL','TAX','FINANCING','INVESTMENT','OTHER']).default('OPERATING'), category_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(160), counterparty: z.string().max(160).default(''), counterparty_id: z.string().uuid().nullable().optional(), due_date: z.string().date(), amount: z.coerce.number().positive(),
  currency: z.string().length(3).default('SAR'), base_amount: z.coerce.number().positive(), status: z.enum(['ACTUAL','CONFIRMED','EXPECTED']).default('EXPECTED'),
  source: z.enum(['MANUAL','INVOICE','IMPORT','VAT','ACCOUNTING']).default('MANUAL'), reference: z.string().max(120).default(''), notes: z.string().max(500).default(''),
});
const counterpartySchema = z.object({ organization_id: z.string().uuid(), name: z.string().trim().min(1).max(160), party_type: z.enum(['CUSTOMER','SUPPLIER','BOTH','PERSON','OTHER']).default('OTHER'), party_type_id: z.string().uuid().nullable().optional(), roles: z.array(z.enum(['CUSTOMER','SUPPLIER','ASSET_SUPPLIER','INVESTEE','INVESTMENT_MANAGER','LENDER','BORROWER','EMPLOYEE','GOVERNMENT','TAX_AUTHORITY','RELATED_PARTY','OTHER'])).max(12).optional(), contact_name: z.string().trim().max(120).default(''), phone: z.string().trim().max(40).default(''), email: z.string().trim().max(160).default(''), notes: z.string().max(500).default('') });
const categorySchema = z.object({ organization_id: z.string().uuid(), name_ar: z.string().trim().min(1).max(80), name_en: z.string().trim().min(1).max(80), flow_group: z.enum(['OPERATING','PAYROLL','TAX','FINANCING','INVESTMENT','OTHER']).default('OTHER'), allowed_direction: z.enum(['INFLOW','OUTFLOW','BOTH']).default('BOTH'), financial_classification_type: z.enum(['REVENUE','OPEX','CAPEX','ASSET','LIABILITY','RECEIVABLE','PAYABLE','FINANCING','INVESTMENT','EQUITY','TAX','ZAKAT','TRANSFER','OTHER']).nullable().optional() });
const partyTypeSchema = z.object({ organization_id: z.string().uuid(), name_ar: z.string().trim().min(1).max(80), name_en: z.string().trim().min(1).max(80) });
const transferSchema = z.object({
  organization_id: z.string().uuid(), source_account_id: z.string().uuid(), destination_account_id: z.string().uuid(),
  amount: z.coerce.number().positive(), exchange_rate: z.coerce.number().positive(), transfer_date: z.string().date(),
  source_title: z.string().trim().min(1).max(160), destination_title: z.string().trim().min(1).max(160),
  reference: z.string().max(120).default(''), notes: z.string().max(500).default(''),
});
const intercompanyTransferSchema = z.object({
  holding_organization_id: z.string().uuid(), source_organization_id: z.string().uuid(), source_account_id: z.string().uuid(),
  destination_organization_id: z.string().uuid(), destination_account_id: z.string().uuid().nullable().optional(),
  transaction_type: z.enum(['LOAN','CAPITAL','ON_BEHALF']), amount: z.coerce.number().positive(), exchange_rate: z.coerce.number().positive(),
  transfer_date: z.string().date(), source_title: z.string().trim().min(1).max(160), destination_title: z.string().trim().min(1).max(160),
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
    const [accountsResult, flowsResult, entitiesResult, organizationsResult, fxResult, categoriesResult, partyTypesResult, counterpartyRolesResult, intercompanyTransfersResult] = await Promise.all([
      supabase.from('liquidity_accounts').select('*').in('organization_id', organizationIds).eq('active', true).order('created_at'),
      supabase.from('liquidity_flows').select('*').in('organization_id', organizationIds).order('due_date', { ascending: true }).limit(1500),
      supabase.from('organization_entities').select('id,name,organization_id,entity_type').in('organization_id', organizationIds).eq('active', true).order('name'),
      supabase.from('organizations').select('id,name,entity_type,base_currency,organization_kind,parent_organization_id').in('id', organizationIds),
      supabase.from('fx_rates').select('organization_id,from_currency,to_currency,rate,valuation_date').or(`organization_id.is.null,organization_id.in.(${organizationIds.join(',')})`).order('valuation_date',{ascending:false}).limit(600),
      supabase.from('liquidity_flow_categories').select('*').in('organization_id', organizationIds).eq('active', true).order('is_system', { ascending: false }).order('name_ar'),
      supabase.from('liquidity_party_types').select('*').in('organization_id', organizationIds).eq('active', true).order('is_system', { ascending: false }).order('name_ar'),
      supabase.from('liquidity_counterparty_roles').select('organization_id,counterparty_id,role_code').in('organization_id', organizationIds).eq('active', true),
      organization.organization_kind === 'HOLDING' && params.get('scope') === 'group'
        ? supabase.from('liquidity_intercompany_transfers').select('*').eq('holding_organization_id', organizationId).in('source_organization_id', organizationIds).in('destination_organization_id', organizationIds).order('transfer_date', { ascending: false }).limit(1000)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [accountsResult, flowsResult, entitiesResult, organizationsResult, fxResult, categoriesResult, partyTypesResult, counterpartyRolesResult, intercompanyTransfersResult]) if (result.error) throw result.error;
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
    return NextResponse.json({ organization, organizations, organization_ids: organizationIds, accounts, flows, entities: entitiesResult.data ?? [], counterparties: (counterparties ?? []).map((party:any)=>({...party,roles:(counterpartyRolesResult.data??[]).filter((role:any)=>role.counterparty_id===party.id).map((role:any)=>role.role_code)})), categories: categoriesResult.data ?? [], party_types: partyTypesResult.data ?? [], intercompany_transfers: intercompanyTransfersResult.data ?? [], fx_missing: fxMissing });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'LIQUIDITY_LOAD_FAILED' }, { status: status(error) }); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = await request.json();
    const kind = body.kind;
    if (kind === 'category') {
      const input = categorySchema.parse(body);
      await requireOrganizationMember(supabase, user.id, input.organization_id);
      if (!await canWriteLiquidity(supabase, user.id, input.organization_id)) throw new Error('ORGANIZATION_ADMIN_REQUIRED');
      const { data, error } = await supabase.from('liquidity_flow_categories').insert({ ...input, code: `CUSTOM_${crypto.randomUUID().replaceAll('-', '')}` }).select().single();
      if (error) throw error;
      return NextResponse.json(data, { status: 201 });
    }
    if (kind === 'party_type') {
      const input = partyTypeSchema.parse(body);
      await requireOrganizationMember(supabase, user.id, input.organization_id);
      if (!await canWriteLiquidity(supabase, user.id, input.organization_id)) throw new Error('ORGANIZATION_ADMIN_REQUIRED');
      const { data, error } = await supabase.from('liquidity_party_types').insert(input).select().single();
      if (error) throw error;
      return NextResponse.json(data, { status: 201 });
    }
    if (kind === 'counterparty') {
      const input = counterpartySchema.parse(body);
      await requireOrganizationMember(supabase, user.id, input.organization_id);
      if (!await canWriteLiquidity(supabase, user.id, input.organization_id)) throw new Error('ORGANIZATION_ADMIN_REQUIRED');
      let payload: any = input;
      if (input.party_type_id) {
        const { data: type, error: typeError } = await supabase.from('liquidity_party_types').select('id,code').eq('id', input.party_type_id).eq('organization_id', input.organization_id).eq('active', true).maybeSingle();
        if (typeError) throw typeError;
        if (!type) throw new Error('PARTY_TYPE_ORGANIZATION_MISMATCH');
        payload = { ...input, party_type: ['CUSTOMER','SUPPLIER','BOTH','PERSON','OTHER'].includes(type.code) ? type.code : 'OTHER' };
      }
      const { roles = [], ...partyPayload } = payload;
      const { data, error } = await supabase.from('liquidity_counterparties').insert(partyPayload).select().single();
      if (error) throw error;
      const defaultRoles = partyPayload.party_type === 'BOTH' ? ['CUSTOMER','SUPPLIER'] : partyPayload.party_type === 'CUSTOMER' ? ['CUSTOMER'] : partyPayload.party_type === 'SUPPLIER' ? ['SUPPLIER'] : [];
      const roleCodes = [...new Set([...(roles as string[]),...defaultRoles])];
      if (roleCodes.length) { const { error: roleError } = await supabase.from('liquidity_counterparty_roles').insert(roleCodes.map(role_code=>({organization_id:input.organization_id,counterparty_id:data.id,role_code,created_by:user.id}))); if (roleError) throw roleError; }
      return NextResponse.json({...data,roles:roleCodes}, { status: 201 });
    }
    if (kind === 'intercompany_transfer') {
      const input = intercompanyTransferSchema.parse(body);