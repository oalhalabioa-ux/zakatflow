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
      const organizationIds = [...new Set([input.holding_organization_id, input.source_organization_id, input.destination_organization_id])];
      for (const organizationId of organizationIds) {
        await requireOrganizationMember(supabase, user.id, organizationId);
        if (!await canWriteLiquidity(supabase, user.id, organizationId)) throw new Error('ORGANIZATION_ADMIN_REQUIRED');
      }
      const [{ data: accounts, error: accountsError }, { data: organizations, error: organizationsError }] = await Promise.all([
        supabase.from('liquidity_accounts').select('id,organization_id,entity_id,name,currency,active').in('id', [input.source_account_id,input.destination_account_id]),
        supabase.from('organizations').select('id,name,base_currency,organization_kind,parent_organization_id').in('id', organizationIds),
      ]);
      if (accountsError) throw accountsError;
      if (organizationsError) throw organizationsError;
      const source = accounts?.find((row: any) => row.id === input.source_account_id && row.organization_id === input.source_organization_id);
      const destination = input.destination_account_id ? accounts?.find((row: any) => row.id === input.destination_account_id && row.organization_id === input.destination_organization_id) : null;
      const holding = organizations?.find((row: any) => row.id === input.holding_organization_id);
      const sourceOrg = organizations?.find((row: any) => row.id === input.source_organization_id);
      const destinationOrg = organizations?.find((row: any) => row.id === input.destination_organization_id);
      const onBehalf = input.transaction_type === 'ON_BEHALF';
      if (!source?.active || (!onBehalf && !destination?.active) || (onBehalf && input.destination_account_id)) throw new Error('TRANSFER_ACCOUNT_NOT_FOUND');
      if (holding?.organization_kind !== 'HOLDING' || !sourceOrg || !destinationOrg) throw new Error('INTERCOMPANY_ORGANIZATION_NOT_FOUND');
      const destinationCurrency = onBehalf ? destinationOrg.base_currency : destination!.currency;
      const currencies = [...new Set([source.currency,destinationCurrency].filter((code: string, index: number) => code !== [sourceOrg.base_currency,destinationOrg.base_currency][index]))];
      const { data: rates, error: ratesError } = currencies.length
        ? await supabase.from('fx_rates').select('organization_id,from_currency,to_currency,rate,valuation_date').or(`organization_id.in.(${input.source_organization_id},${input.destination_organization_id}),organization_id.is.null`).lte('valuation_date', input.transfer_date).order('valuation_date',{ascending:false}).limit(600)
        : { data: [], error: null };
      if (ratesError) throw ratesError;
      const baseRate = (organizationId: string, code: string) => {
        const organization = organizations?.find((row: any) => row.id === organizationId);
        if (!organization) throw new Error('INTERCOMPANY_ORGANIZATION_NOT_FOUND');
        if (code === organization.base_currency) return 1;
        const scoped = (rates ?? []).filter((row: any) => row.organization_id === organizationId);
        const global = (rates ?? []).filter((row: any) => row.organization_id === null);
        for (const rows of [scoped,global]) {
          const direct = rows.find((row: any) => row.from_currency === code && row.to_currency === organization.base_currency);
          if (direct && Number(direct.rate) > 0) return Number(direct.rate);
          const inverse = rows.find((row: any) => row.from_currency === organization.base_currency && row.to_currency === code);
          if (inverse && Number(inverse.rate) > 0) return 1 / Number(inverse.rate);
        }
        throw new Error(`TRANSFER_BASE_RATE_REQUIRED:${code}`);
      };
      const computed = calculateIntercompanyTransfer({
        holdingOrganizationId: input.holding_organization_id,
        sourceOrganizationId: input.source_organization_id,
        destinationOrganizationId: input.destination_organization_id,
        sourceAccountId: source.id, destinationAccountId: destination?.id ?? null, transactionType: input.transaction_type,
        sourceParentOrganizationId: sourceOrg.parent_organization_id,
        destinationParentOrganizationId: destinationOrg.parent_organization_id,
        amount: input.amount,
        exchangeRate: source.currency === destinationCurrency ? 1 : input.exchange_rate,
        sourceBaseRate: baseRate(input.source_organization_id, source.currency),
        destinationBaseRate: onBehalf ? 1 : baseRate(input.destination_organization_id, destination!.currency),
      });
      const { data, error } = await supabase.rpc('create_liquidity_intercompany_transfer', {
        p_holding_organization_id: input.holding_organization_id,
        p_source_organization_id: input.source_organization_id, p_source_account_id: source.id,
        p_destination_organization_id: input.destination_organization_id, p_destination_account_id: destination?.id ?? null,
        p_transaction_type: input.transaction_type, p_source_amount: computed.sourceAmount,
        p_destination_amount: computed.destinationAmount, p_source_base_amount: computed.sourceBaseAmount,
        p_destination_base_amount: computed.destinationBaseAmount,
        p_exchange_rate: source.currency === destinationCurrency ? 1 : input.exchange_rate,
        p_transfer_date: input.transfer_date, p_source_title: input.source_title, p_destination_title: input.destination_title,
        p_reference: input.reference, p_notes: input.notes,
      });
      if (error) throw error;
      return NextResponse.json(data, { status: 201 });
    }
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
    if (kind === 'flow' && payload.category_id) {
      const { data: category, error } = await supabase.from('liquidity_flow_categories').select('id,flow_group,allowed_direction').eq('id', payload.category_id).eq('organization_id', payload.organization_id).eq('active', true).maybeSingle();
      if (error) throw error;
      if (!category) throw new Error('CATEGORY_ORGANIZATION_MISMATCH');
      if (category.allowed_direction !== 'BOTH' && category.allowed_direction !== payload.direction) throw new Error('CATEGORY_DIRECTION_NOT_ALLOWED');
      payload = { ...payload, flow_type: category.flow_group };
    }
    const { data, error } = kind === 'account'
      ? await supabase.from('liquidity_accounts').insert(payload).select().single()
      : await supabase.from('liquidity_flows').insert(payload).select().single();
    if (error) throw error;
    if (kind === 'flow' && data && payload.source === 'MANUAL' && payload.category_id) {
      const { data: category, error: categoryError } = await supabase.from('liquidity_flow_categories').select('financial_classification_type').eq('id',payload.category_id).eq('organization_id',payload.organization_id).single();
      if (categoryError) throw categoryError;
      const treatment = category?.financial_classification_type;
      if (treatment) {
        const obligationType = payload.direction === 'OUTFLOW' ? 'PAYABLE' : 'RECEIVABLE';
        const [{ data: recognitionClass, error: recognitionClassError }, { data: obligationClass, error: obligationClassError }, { data: organization, error: organizationError }] = await Promise.all([
          supabase.from('financial_classifications').select('id').eq('organization_id',payload.organization_id).eq('classification_type',treatment).eq('active',true).limit(1).maybeSingle(),
          supabase.from('financial_classifications').select('id').eq('organization_id',payload.organization_id).eq('classification_type',obligationType).eq('active',true).limit(1).maybeSingle(),
          supabase.from('organizations').select('base_currency').eq('id',payload.organization_id).single()
        ]);
        if (recognitionClassError) throw recognitionClassError;if(obligationClassError) throw obligationClassError;if(organizationError) throw organizationError;
        if (!recognitionClass || !obligationClass) throw new Error('LIQUIDITY_FINANCIAL_CLASSIFICATION_REQUIRED');
        const sourceKey = `liquidity:${data.id}:recognition`;
        const eventType = treatment === 'CAPEX' || treatment === 'ASSET' || treatment === 'INVESTMENT' ? 'ASSET_PURCHASE' : payload.direction === 'INFLOW' ? 'REVENUE' : 'EXPENSE';
        const created:any = await executeFinancialEventAction({action:'CREATE',payload:{organization_id:payload.organization_id,entity_id:payload.entity_id,counterparty_id:payload.counterparty_id,event_type:eventType,source_module:'OPERATIONAL_CONSOLE',source_record_id:data.id,source_event_key:sourceKey,event_date:payload.due_date,due_date:payload.due_date,base_currency:organization.base_currency,description:payload.title,lines:[{line_number:1,description:payload.title,classification_id:recognitionClass.id,cost_center_id:null,amount:payload.amount,currency:payload.currency,exchange_rate:payload.base_amount/payload.amount,base_amount:payload.base_amount,cash_direction:'NON_CASH',vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}],obligations:[{obligation_key:`liquidity:${data.id}:obligation`,obligation_type:obligationType,settleable_amount:payload.amount,currency:payload.currency,exchange_rate:payload.base_amount/payload.amount,base_currency:organization.base_currency,settleable_base_amount:payload.base_amount}] }});
        const eventId = typeof created === 'string' ? created : (created?.event_id ?? created?.id);
        if (!eventId) throw new Error('LIQUIDITY_RECOGNITION_EVENT_ID_MISSING');
        await supabase.from('financial_event_links').upsert({organization_id:payload.organization_id,event_id:eventId,link_type:'CASH_FLOW',target_module:'liquidity_flows',target_record_id:data.id},{onConflict:'organization_id,event_id,link_type,target_module,target_record_id'});
        await supabase.from('liquidity_flows').update({source_module:'LIQUIDITY',source_record_id:data.id,source_event_key:sourceKey}).eq('id',data.id);
        const { data: event } = await supabase.from('financial_events').select('status').eq('id',eventId).single();
        if(event?.status==='DRAFT') await executeFinancialEventAction({action:'TRANSITION',organization_id:payload.organization_id,event_id:eventId,status:'PLANNED',note:'Created from Liquidity Management'});
        const { data: planned } = await supabase.from('financial_events').select('status').eq('id',eventId).single();
        if(planned?.status==='PLANNED') await executeFinancialEventAction({action:'TRANSITION',organization_id:payload.organization_id,event_id:eventId,status:'COMMITTED',note:'Confirmed cash-flow obligation'});
      }
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'LIQUIDITY_SAVE_FAILED' }, { status: status(error) }); }
}