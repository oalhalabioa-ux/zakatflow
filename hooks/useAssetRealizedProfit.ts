import {useEffect, useState} from 'react';
import type {RealizedProfit} from '@/lib/asset-realized-profit';
import type {AssetTableScope} from '@/lib/asset-table-preferences';

export function useAssetRealizedProfit(enabled: boolean, scope: AssetTableScope, assets: unknown[]) {
  const [report, setReport] = useState<{scope: AssetTableScope; assets: unknown[]; rows: Record<string, RealizedProfit> | null} | null>(null);
  useEffect(() => {
    if (!enabled) { setReport(null); return; }
    const controller = new AbortController();
    fetch(`/api/assets/realized-profit?scope=${scope}`, {cache: 'no-store', signal: controller.signal})
      .then(response => response.ok ? response.json() : null)
      .then(rows => { if (!controller.signal.aborted) setReport({scope, assets, rows}); })
      .catch(() => { if (!controller.signal.aborted) setReport({scope, assets, rows: null}); });
    return () => controller.abort();
  }, [enabled, scope, assets]);
  const current = enabled && report?.scope === scope && report.assets === assets ? report : null;
  return {loading: enabled && !current, failed: Boolean(current && !current.rows), rows: current?.rows ?? null};
}
