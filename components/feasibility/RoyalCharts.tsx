import { RoyalIcon } from './RoyalIcon';

type Datum = { label: string; value: number };
type Labels = { title: string; locale: string; unit?: string };

function display(locale: string, value: number, unit?: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value) + (unit ? ' ' + unit : '');
}

export function RoyalBars({ title, locale, unit, data }: Labels & { data: Datum[] }) {
  const values = data.filter(point => Number.isFinite(point.value));
  if (!values.length) return null;
  const max = Math.max(1, ...values.map(point => Math.abs(point.value)));
  const mixed = values.some(point => point.value < 0);
  return <figure className="fs-royal-chart">
    <figcaption><RoyalIcon name="chart"/>{title}</figcaption>
    <div className={'fs-royal-bars' + (mixed ? ' fs-royal-bars--mixed' : '')}>
      {values.map((point, index) => <div className="fs-royal-bar" key={point.label}>
        <strong dir="auto">{display(locale, point.value, unit)}</strong>
        <div className="fs-royal-bar-track" aria-hidden="true">
          <i data-gold={index % 3 === 1} data-negative={point.value < 0}
            style={{ height: Math.abs(point.value) / max * (mixed ? 50 : 100) + '%' }}/>
        </div>
        <small>{point.label}</small>
      </div>)}
    </div>
  </figure>;
}

export function RoyalOwnership({ title, locale, data, showAllocation = false }: Labels & {
  data: Datum[];
  showAllocation?: boolean;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return null;
  const ar = locale === 'ar';
  const shares = data.map(item => ({ ...item, percentage: item.value / total * 100 }));
  let offset = 0;
  return <figure className="fs-royal-chart">
    <figcaption><RoyalIcon name="users"/>{title}</figcaption>
    <div className={'fs-royal-ownership' + (showAllocation ? ' fs-royal-ownership--allocation' : '')}>
      <div className="fs-royal-ownership-ring" aria-hidden="true">
        <svg viewBox="0 0 42 42">
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--fs-line)" strokeWidth="5"/>
          {shares.map(({ label, percentage }, index) => {
            const start = offset;
            offset += percentage;
            return <circle key={label} cx="21" cy="21" r="15.9" pathLength="100" fill="none"
              stroke={index % 2 ? 'var(--fs-gold)' : 'var(--fs-green)'} strokeWidth="5"
              strokeDasharray={percentage + ' ' + (100 - percentage)} strokeDashoffset={-start}
              transform="rotate(-90 21 21)"/>;
          })}
        </svg>
        {showAllocation && <div className="fs-royal-ownership-ratio">
          <strong dir="ltr">{shares.map(item => display(locale, item.percentage)).join(' / ')}</strong>
          <small>{ar ? 'تقديري فقط' : 'Indicative only'}</small>
        </div>}
      </div>
      <ul>{shares.map((item, index) => <li key={item.label}><i data-gold={index % 2 === 1}/>
        <span>{item.label}</span><strong>{display(locale, item.percentage, '%')}</strong>
      </li>)}</ul>
    </div>
    {showAllocation && <p className="fs-royal-ownership-note">
      <RoyalIcon name="check"/>
      {ar ? 'تستند هذه النسب إلى التقييمات والمساهمات المدخلة. تُحدَّد الملكية النهائية في الاتفاق القانوني.'
        : 'These percentages use the entered valuations and contributions. Final ownership is determined in the legal agreement.'}
    </p>}
  </figure>;
}

export function RoyalCashTrend({ title, locale, unit, flows }: Labels & { flows: number[] }) {
  let cumulative = 0;
  const values = flows.map(value => cumulative += value);
  if (!values.length || values.some(value => !Number.isFinite(value))) return null;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const y = (value: number) => 129 - (value - min) / (max - min || 1) * 112;
  const points = values.map((value, index) => [18 + index * 564 / Math.max(1, values.length - 1), y(value)]);
  const path = points.map(point => point.join(',')).join(' ');
  const ar = locale === 'ar';
  return <figure className="fs-royal-chart">
    <figcaption><RoyalIcon name="chart"/>{title}</figcaption>
    <svg className="fs-royal-trend" viewBox="0 0 600 145" aria-hidden="true">
      {[17,54,91,129].map(line => <path key={line} d={'M18 '+line+'H582'} stroke="var(--fs-line)"/>)}
      <polygon points={points[0][0]+','+y(0)+' '+path+' '+points.at(-1)![0]+','+y(0)}
        fill="var(--fs-green)" opacity=".12"/>
      <polyline points={path} fill="none" stroke="var(--fs-green)" strokeWidth="2"/>
      {points.map(([x, vertical], index) => <circle key={index} cx={x} cy={vertical} r="2.7" fill="var(--fs-gold)"/>)}
    </svg>
    <div className="fs-royal-trend-labels">
      <span>{ar ? 'السنة 0' : 'Year 0'} · <bdi>{display(locale, values[0], unit)}</bdi></span>
      <span>{ar ? 'السنة' : 'Year'} {values.length - 1} · <bdi>{display(locale, values.at(-1)!, unit)}</bdi></span>
    </div>
    <details><summary>{ar ? 'القيم السنوية' : 'Annual values'}</summary>
      <ol start={0}>{values.map((value, index) => <li key={index}>{display(locale, value, unit)}</li>)}</ol>
    </details>
  </figure>;
}
