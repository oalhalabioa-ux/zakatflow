import type { SupabaseClient } from '@supabase/supabase-js';
import Decimal from 'decimal.js';
import { isLiquidityFlowSettled, type LiquidityForecastFlow } from '../lib/liquidity-forecast';

type NativeForecast = LiquidityForecastFlow & {
  id: string;
  organization_id: string;
  currency: string;
  source_module: string | null;
  intercompany_transfer_id?: string | null;
};

type OpenItem = {
  organization_id: string;
  event_id: string;
  obligation_id: string;
  obligation_type: string;
  source_module: string;
  source_record_id: string | null;
  outstanding_base_amount: number | string;
};

type SupplierSchedule = {
  asset_id: string;
  purchase_id: string;
  event_id: string;
  obligation_id: string;
  native_forecast_id: string;
  status: string;
  currency: string;
  remaining: string;
  entries: { due_date: string; remaining: string }[];
};

export type SupplierForecasts = Record<string, LiquidityForecastFlow[]>;

const source = 'ASSETS_INTEGRATION';
const date = /^\d{4}-\d{2}-\d{2}$/;
const amount = /^\d+(?:\.\d{1,4})?$/;
const scoped = (organizationId: string, id: string) => `${organizationId}:${id}`;

function installments(flow: NativeForecast, item: OpenItem, schedule: SupplierSchedule) {
  if (schedule.status !== 'ACTUAL' || schedule.currency !== flow.currency ||
      !Array.isArray(schedule.entries) || schedule.entries.length === 0 ||
      !amount.test(schedule.remaining) || !amount.test(String(item.outstanding_base_amount))) return null;

  const rows: LiquidityForecastFlow[] = [];
  let total = new Decimal(0);
  for (const entry of schedule.entries) {
    if (!entry || !date.test(entry.due_date) || !amount.test(entry.remaining)) return null;
    const remaining = new Decimal(entry.remaining);
    total = total.plus(remaining);
    if (remaining.isZero()) continue;
    rows.push({
      direction: 'OUTFLOW',
      due_date: entry.due_date,
      status: flow.status,
      base_amount: remaining.toNumber(),
    });
  }
  return rows.length > 0 && total.eq(schedule.remaining) && total.eq(item.outstanding_base_amount) ? rows : null;
}

/** Read the existing schedule with the caller's permissions. Projections never become cash movements. */
export async function loadAssetSupplierForecasts(
  supabase: SupabaseClient,
  organizationIds: string[],
  flows: NativeForecast[],
  openItems: OpenItem[],
): Promise<SupplierForecasts> {
  const native = new Map(flows.filter(flow => flow.source_module === source && flow.direction === 'OUTFLOW' &&
    !flow.transfer_id && !flow.intercompany_transfer_id && !isLiquidityFlowSettled(flow))
    .map(flow => [scoped(flow.organization_id, flow.id), flow]));
  const payableByEvent = new Map(openItems.filter(item => item.source_module === source &&
    item.obligation_type === 'PAYABLE' && item.source_record_id !== null)
    .map(item => [scoped(item.organization_id, item.event_id), item]));
  if (native.size === 0 || payableByEvent.size === 0) return {};

  const replacements: SupplierForecasts = {};
  const seen = new Set<string>();
  const ids = [...native.values()].map(flow => flow.id);
  for (let i = 0; i < ids.length; i += 100) {
    const links = await supabase.from('financial_event_links')
      .select('event_id,organization_id,target_record_id')
      .in('organization_id', organizationIds).in('target_record_id', ids.slice(i, i + 100))
      .eq('link_type', 'CASH_FLOW').eq('target_module', 'liquidity_flows')
      .eq('metadata->>purpose', 'ASSET_DUE_FORECAST');
    if (links.error) throw links.error;
    const candidates = (links.data ?? []).flatMap(link => {
      const flow = native.get(scoped(link.organization_id, link.target_record_id));
      const item = payableByEvent.get(scoped(link.organization_id, link.event_id));
      return flow && item?.source_record_id ? [{ flow, item, purchaseId: item.source_record_id }] : [];
    });
    if (candidates.length === 0) continue;

    const purchases = await supabase.from('transactions').select('id,organization_id,asset_account_id')
      .in('organization_id', organizationIds).in('id', [...new Set(candidates.map(row => row.purchaseId))])
      .eq('transaction_type', 'PURCHASE');
    if (purchases.error) throw purchases.error;
    const assetByPurchase = new Map((purchases.data ?? []).map(row => [scoped(row.organization_id, row.id), row.asset_account_id]));

    for (let j = 0; j < candidates.length; j += 8) {
      await Promise.all(candidates.slice(j, j + 8).map(async ({ flow, item, purchaseId }) => {
        const assetId = assetByPurchase.get(scoped(item.organization_id, purchaseId));
        if (!assetId || seen.has(flow.id)) return;
        seen.add(flow.id);
        const { data, error } = await supabase.rpc('read_asset_supplier_schedule', { p_asset_id: assetId });
        if (error?.message.includes('ASSET_SUPPLIER_SCHEDULE_DENIED')) return;
        if (error) throw error;
        const schedule = data as SupplierSchedule | null;
        if (!schedule || schedule.asset_id !== assetId || schedule.purchase_id !== purchaseId ||
            schedule.event_id !== item.event_id || schedule.obligation_id !== item.obligation_id ||
            schedule.native_forecast_id !== flow.id) return;
        const rows = installments(flow, item, schedule);
        if (rows) replacements[flow.id] = rows;
      }));
    }
  }
  return replacements;
}
