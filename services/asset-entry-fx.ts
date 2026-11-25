import { assetEntryQuote, type AssetEntryRate } from '../lib/asset-entry-details';
import { requireOrganizationMember } from './organization-access';

export async function resolveAssetEntryFx(
  supabase: any, userId: string, currency: string, date: string, organizationId: string | null,
) {
  if (organizationId) await requireOrganizationMember(supabase, userId, organizationId);
  const profile = await supabase.from(organizationId ? 'organizations' : 'profiles')
    .select('base_currency').eq('id', organizationId ?? userId).single();
  if (profile.error) throw profile.error;
  const base = profile.data.base_currency || 'SAR';

  const codes = [...new Set([currency, base])];
  const active = await supabase.from('currencies').select('code').in('code', codes).eq('active', true);
  if (active.error) throw active.error;
  if (active.data.length !== codes.length) throw Error('ASSET_CURRENCY_NOT_REGISTERED');
  if (currency === base) return { rate: 1, row: null, base_currency: base };

  const quoteFor = async (query: any, scope: string | null) => {
    const { data, error } = await query
      .or(`and(from_currency.eq.${currency},to_currency.eq.${base}),and(from_currency.eq.${base},to_currency.eq.${currency})`)
      .lte('valuation_date', date).gt('rate', 0)
      .order('valuation_date', { ascending: false }).order('id', { ascending: false }).limit(1);
    if (error) throw error;
    const rows: AssetEntryRate[] = data.map((row: Omit<AssetEntryRate, 'organization_id'>) => ({
      ...row, organization_id: scope,
    }));
    return assetEntryQuote(rows, currency, base, date, scope);
  };
  const columns = 'id,from_currency,to_currency,rate,valuation_date,source';
  const scoped = organizationId
    ? supabase.from('fx_rates').select(columns).eq('organization_id', organizationId)
    : supabase.from('personal_fx_rates').select(columns).eq('user_id', userId);
  const quote = await quoteFor(scoped, organizationId)
    ?? await quoteFor(supabase.from('fx_rates').select(columns).is('organization_id', null), null);
  if (!quote) throw Error('ASSET_SAVED_FX_RATE_MISSING');
  return { ...quote, base_currency: base };
}
