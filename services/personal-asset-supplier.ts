import { acquisitionValuation } from '../lib/asset-entry-details';
import { assetEntryTaxSettings } from '../lib/asset-entry-tax';
import { assetSchema } from '../lib/validation/schemas';
import { requireUser } from './auth';

export type PersonalSupplierTerms = {
  mode: 'DEFERRED' | 'INSTALLMENTS';
  supplier_name: string;
  down_payment_account_id?: string | null;
  entries: { kind: 'DOWN_PAYMENT' | 'INSTALLMENT'; due_date: string; principal: string }[];
};

export async function createPersonalSupplierAsset(input: unknown, requestId: string, terms: PersonalSupplierTerms) {
  const asset = assetSchema.parse(input);
  if (asset.ownership_scope !== 'PERSONAL' || asset.is_zakatable ||
      asset.metadata.acquisition_mode !== 'PURCHASE' ||
      !['OTHER', 'REAL_ESTATE'].includes(asset.asset_type)) {
    throw Error('PERSONAL_SUPPLIER_ASSET_UNSUPPORTED');
  }
  const { supabase, user } = await requireUser();
  const profile = await supabase.from('profiles').select('base_currency').eq('id', user.id).single();
  if (profile.error) throw profile.error;
  if (asset.currency !== profile.data.base_currency) throw Error('PERSONAL_SUPPLIER_CURRENCY_UNSUPPORTED');

  asset.metadata = acquisitionValuation({
    ...asset.metadata,
    fx_rate: 1,
    fx_rate_id: null,
    fx_rate_date: asset.metadata.purchase_date,
    fx_rate_source: 'BASE_CURRENCY',
    fx_source_from: asset.currency,
    fx_source_to: asset.currency,
  }, asset.currency);
  if (asset.metadata.tax_category) {
    const tax = assetEntryTaxSettings({ ...asset.metadata, ownership_scope: 'PERSONAL' }, Number(asset.metadata.purchase_value || 0));
    asset.metadata = { ...asset.metadata, ...tax.metadata };
  }
  const { data, error } = await supabase.rpc('create_personal_supplier_asset', {
    p_asset: asset, p_request_id: requestId, p_terms: terms,
  });
  if (error) throw error;
  return data;
}
