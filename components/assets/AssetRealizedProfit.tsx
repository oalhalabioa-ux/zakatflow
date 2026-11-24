import {Money} from '@/components/DisplayCurrency';
import type {RealizedProfit} from '@/lib/asset-realized-profit';

export function realizedProfitText(result: RealizedProfit | undefined, ar: boolean) {
  if (result?.status === 'incomplete') return ar ? 'بيانات غير مكتملة' : 'Incomplete data';
  return '—';
}

export function realizedProfitBasis(ar: boolean) {
  return ar
    ? 'حصيلة البيع دون ضريبة المخرجات، مطروحاً منها تكلفة الجزء المباع ومصاريف البيع المرتبطة بالسند.'
    : 'Sale proceeds excluding output VAT, less the cost sold and direct expenses linked to the voucher.';
}

export function AssetRealizedProfit({result, ar, organizationId}: {result?: RealizedProfit; ar: boolean; organizationId?: string}) {
  if (result?.status !== 'recorded') return <span className="muted">{realizedProfitText(result, ar)}</span>;
  return <Money value={result.amount} currency={result.currency} organizationId={organizationId} preservePrint/>;
}

export function AssetRealizedProfitNote({ar, loading, failed}: {ar: boolean; loading: boolean; failed: boolean}) {
  if (loading) return <p className="muted" role="status">{ar ? 'جاري تحميل الأرباح المحققة…' : 'Loading realized profit…'}</p>;
  if (failed) return <p className="muted" role="status">{ar ? 'تعذر تحميل الأرباح المحققة. حدّث الصفحة لإعادة المحاولة.' : 'Could not load realized profit. Reload the page to retry.'}</p>;
  return <p className="muted">{realizedProfitBasis(ar)}</p>;
}
