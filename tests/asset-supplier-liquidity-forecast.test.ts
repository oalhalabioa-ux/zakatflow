import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { buildLiquidityForecast, buildScenarioForecast } from '../lib/liquidity-forecast';
import { loadAssetSupplierForecasts } from '../services/asset-supplier-liquidity-forecast';

const forecast = {
  id: 'forecast', organization_id: 'org', currency: 'SAR', source_module: 'ASSETS_INTEGRATION',
  status: 'CONFIRMED', direction: 'OUTFLOW', due_date: '2026-03-01', base_amount: 64_000,
} as const;
const payable = {
  organization_id: 'org', event_id: 'event', obligation_id: 'payable', obligation_type: 'PAYABLE',
  source_module: 'ASSETS_INTEGRATION', source_record_id: 'purchase', outstanding_base_amount: 64_000,
};
const schedule = {
  asset_id: 'asset', purchase_id: 'purchase', event_id: 'event', obligation_id: 'payable',
  native_forecast_id: 'forecast', status: 'ACTUAL', currency: 'SAR', remaining: '64000',
  entries: [
    { due_date: '2026-03-01', remaining: '0' },
    { due_date: '2026-04-01', remaining: '0' },
    ...Array.from({ length: 8 }, (_, i) => ({ due_date: `2026-${String(i + 5).padStart(2, '0')}-01`, remaining: '8000' })),
  ],
};

function client(data: unknown, error: { message: string } | null = null, linkOrganization = 'org') {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const scopeFilters = vi.fn();
  const records = {
    financial_event_links: [{ organization_id: linkOrganization, target_record_id: 'forecast', event_id: 'event' }],
    transactions: [{ organization_id: 'org', id: 'purchase', asset_account_id: 'asset' }],
  };
  const from = (table: keyof typeof records) => {
    const query = {
      select: () => query,
      in: (column: string, values: string[]) => { scopeFilters(table, column, values); return query; },
      eq: () => query,
      then: (resolve: (value: { data: typeof records[typeof table]; error: null }) => void) =>
        resolve({ data: records[table], error: null }),
    };
    return query;
  };
  return { supabase: { from, rpc } as unknown as SupabaseClient, rpc, scopeFilters };
}

describe('supplier instalment forecast', () => {
  it('substitutes verified dates once and preserves the source flow and posted cash', async () => {
    const { supabase, rpc, scopeFilters } = client(schedule);
    const projection = await loadAssetSupplierForecasts(supabase, ['org'], [forecast], [payable]);
    expect(rpc).toHaveBeenCalledWith('read_asset_supplier_schedule', { p_asset_id: 'asset' });
    expect(scopeFilters).toHaveBeenCalledWith('financial_event_links', 'organization_id', ['org']);
    expect(scopeFilters).toHaveBeenCalledWith('transactions', 'organization_id', ['org']);
    expect(projection.forecast).toHaveLength(8);
    expect(projection.forecast.reduce((sum, row) => sum + Number(row.base_amount), 0)).toBe(64_000);
    const weeks = buildLiquidityForecast(114_000, projection.forecast, '2026-04-30');
    expect(weeks.reduce((sum, week) => sum + week.outflow, 0)).toBe(24_000);
    expect(weeks.at(-1)?.balance).toBe(90_000);
    const scenario = buildScenarioForecast(114_000, projection.forecast, '2026-04-30', 0, 10);
    expect(scenario.at(-1)?.balance).toBeCloseTo(87_600);
    expect(forecast).toMatchObject({ due_date: '2026-03-01', base_amount: 64_000 });
  });

  it('uses two dates for the hosted case that previously projected 80,000 in one week', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      due_date: new Date(Date.UTC(2026, 11 + i, 27)).toISOString().slice(0, 10), remaining: '8000',
    }));
    const { supabase } = client({ ...schedule, remaining: '80000', entries });
    const row = { ...forecast, base_amount: 80_000, due_date: '2026-12-27' };
    const projection = await loadAssetSupplierForecasts(supabase, ['org'], [row], [{ ...payable, outstanding_base_amount: 80_000 }]);
    const weeks = buildLiquidityForecast(130_000, projection.forecast, '2026-11-27');
    expect(weeks.reduce((sum, week) => sum + week.outflow, 0)).toBe(16_000);
  });

  it.each([null, { ...schedule, obligation_id: 'different' }, { ...schedule, remaining: '1' },
    { ...schedule, status: 'REVERSED' }])('leaves the original flow with no verified schedule (%j)', async data => {
    const { supabase } = client(data);
    expect(await loadAssetSupplierForecasts(supabase, ['org'], [forecast], [payable])).toEqual({});
  });

  it('preserves access when the existing reader denies schedule access', async () => {
    const { supabase } = client(null, { message: 'ASSET_SUPPLIER_SCHEDULE_DENIED' });
    expect(await loadAssetSupplierForecasts(supabase, ['org'], [forecast], [payable])).toEqual({});
  });

  it('ignores another organization and avoids settled or actual cash flows', async () => {
    const { supabase, rpc } = client(schedule, null, 'other-org');
    expect(await loadAssetSupplierForecasts(supabase, ['org'], [forecast], [payable])).toEqual({});
    expect(await loadAssetSupplierForecasts(supabase, ['org'], [{ ...forecast, status: 'ACTUAL' }], [payable])).toEqual({});
    expect(rpc).not.toHaveBeenCalled();
  });
});
