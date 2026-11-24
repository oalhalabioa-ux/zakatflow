import {Money} from '@/components/DisplayCurrency';
import type {RealizedProfit} from '@/lib/asset-realized-profit';

export function realizedProfitText(result: RealizedProfit | undefined, ar: boolean) {
  if (result?.status === 'incomplete') return ar ? 'بيانات غير مكتملة' : 'Incomplete data';
  return '—';
}

export function realizedProfitBasis(ar: boolean) {
  return ar
    ? 'الربح المسجل من البيع بعد تكلفة الجزء المباع، باستبعاد ضريبة المبيعات. مصاريف البيع المسجلة منفصلة تحتاج إلى ربطها بسند البيع قبل خصمها.'
    : 'Recorded sale proceeds less the cost sold, excluding sales tax. Separately recorded selling expenses need a voucher link before they can be deducted.';
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
