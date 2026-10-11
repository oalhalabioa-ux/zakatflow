type Point = { label: string; value: number };
const format = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);

/** Presentation of already computed balances; never derives financial facts. */
export default function DashboardGraphic({ title, points, currency, line = false, ar }: {
  title: string; points: Point[]; currency: string; line?: boolean; ar: boolean;
}) {
  const valid = points.length > 0 && points.every(point => Number.isFinite(point.value));
  if (!valid) return <figure className="dashboard-graphic"><figcaption>{title}</figcaption><p className="dashboard-graphic-empty">{ar ? 'لا تتوفر بيانات للرسم' : 'Chart data unavailable'}</p></figure>;
  const min = Math.min(0, ...points.map(point => point.value));
  const max = Math.max(0, ...points.map(point => point.value));
  const range = max - min || 1;
  const y = (value: number) => 122 - (value - min) / range * 100;
  const x = (index: number) => points.length === 1 ? 200 : 24 + index * 352 / (points.length - 1);
  const zero = y(0);
  const path = points.map((point, index) => `${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
  const compact = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return <figure className="dashboard-graphic">
    <figcaption><span>{title}</span><small>{currency}</small></figcaption>
    {line ? <>
      <svg viewBox="0 0 400 152" role="img" aria-label={title}>
        <title>{title}</title>
        {[22, 72, 122].map(level => <line key={level} x1="24" x2="376" y1={level} y2={level} stroke="currentColor" opacity=".1" />)}
        <line x1="24" x2="376" y1={zero} y2={zero} stroke="currentColor" opacity=".35" />
        <polyline points={path} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
        {points.map((point, index) => <circle key={index} cx={x(index)} cy={y(point.value)} r="3.5" fill={point.value < 0 ? '#b74436' : 'currentColor'}><title>{`${point.label}: ${format(point.value)} ${currency}`}</title></circle>)}
        <text x="24" y="146" textAnchor="start">{points[0].label}</text><text x="376" y="146" textAnchor="end">{points[points.length - 1].label}</text>
        <text x="24" y="14" textAnchor="start">{compact(max)}</text>
      </svg>
      <details className="dashboard-graphic-details"><summary>{ar ? 'عرض قيم الفترات' : 'View period values'}</summary><dl>{points.map((point, index) => <div key={index}><dt>{point.label}</dt><dd><bdi>{format(point.value)} {currency}</bdi></dd></div>)}</dl></details>
    </> : <dl className="dashboard-graphic-bars">{points.map((point, index) => <div key={index}>
      <dt>{point.label}</dt><dd><bdi>{format(point.value)} {currency}</bdi></dd>
      <div className="dashboard-graphic-track" aria-hidden="true"><i className="dashboard-graphic-zero" style={{ left: `${(-min / range) * 100}%` }} /><span style={{ left: `${((Math.min(0, point.value) - min) / range) * 100}%`, width: `${Math.abs(point.value) / range * 100}%`, background: point.value < 0 ? '#b74436' : undefined }} /></div>
    </div>)}</dl>}
  </figure>;
}
