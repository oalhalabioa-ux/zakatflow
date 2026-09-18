import Link from 'next/link';
import type {CSSProperties, ReactNode} from 'react';
import {allocationSegments, hawlProgress} from '@/lib/dashboard-presentation';

const colors = ['#0b684e', '#35b780', '#399ee2', '#edb94b', '#8595a7', '#a08ade', '#62c4bd', '#bd8d67', '#597188'];
const types: Record<string, [string, string]> = {
  CASH: ['النقد', 'Cash'], BANK: ['الحسابات البنكية', 'Bank accounts'],
  GOLD: ['الذهب', 'Gold'], SILVER: ['الفضة', 'Silver'], STOCK: ['الأسهم', 'Stocks'],
  INVENTORY: ['المخزون التجاري', 'Inventory'], RECEIVABLE: ['الذمم المدينة', 'Receivables'],
  REAL_ESTATE: ['العقارات', 'Real estate'], OTHER: ['أصول أخرى', 'Other assets'],
};

function Icon({kind}: {kind: string}) {
  const paths: Record<string, ReactNode> = {
    assets: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 4 16 4 16 0V5M4 11v6c0 4 16 4 16 0v-6"/></>,
    pool: <><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 10h1m3 0h1m3 0h1M8 14h1m3 0h1m3 0h1M8 18h1m3 0h5"/></>,
    due: <><path d="M3 15h5l4 3h6l3-3M3 21h7l10-5M12 3c-5 0-5 7 0 7s5-7 0-7zM12 1v11"/></>,
    paid: <><rect x="3" y="3" width="18" height="18" rx="5"/><path d="m7 12 3 3 7-7"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind] || paths.assets}</svg>;
}

function Panel({title, href, action, children}: {title: string; href: string; action: string; children: ReactNode}) {
  return <section className="ed-panel"><header><h2>{title}</h2><Link href={href}>{action}<span aria-hidden="true"> ←</span></Link></header>{children}</section>;
}

export default function ElegantDashboard({d, locale, currency}: {d: any; locale: string; currency: string}) {
  const ar = locale === 'ar', t = (a: string, e: string) => ar ? a : e;
  const money = (v: unknown) => new Intl.NumberFormat('en-US', {maximumFractionDigits: 2}).format((Number(v) || 0) / (currency === 'USD' ? 3.75 : 1));
  const amount = (v: unknown) => <bdi>{money(v)} <span className="ed-unit">{currency}</span></bdi>;
  const path = (p: string) => `/${locale}/${p}`;
  const c = d.activeCycle;
  const progress = hawlProgress(c?.hawl_start_date, c?.hawl_due_date, d.asOfDate);
  const paid = Math.max(0, Math.min(100, Number(d.zakatPaymentPct) || 0));
  const segments = allocationSegments(d.assetAllocation || []);
  const gradient = segments.length ? `conic-gradient(${segments.map((s, i) => `${colors[i % colors.length]} ${s.start}% ${s.end}%`).join(',')})` : '#e7efec';
  // Each bar is a saved assessment, not an invented annual observation.
  const history = [...(d.latestAssessments || [])].slice(0, 6).reverse();
  const maxDue = Math.max(1, ...history.map((x: any) => Number(x.zakat_due) || 0));
  const health = d.dataHealth || {};
  const missing = d.loadError || Object.values(health).some(v => v === false);
  const assessmentKnown = !d.loadError && health.assessments !== false && health.cycles !== false;
  const paymentKnown = assessmentKnown && health.allocations !== false;
  const metrics = [
    {key: 'assets', label: t('إجمالي الأصول', 'Total assets'), value: d.totalCurrentSar, known: !d.loadError, note: `${d.assetCount || 0} ${t('أصل نشط', 'active assets')}`},
    {key: 'pool', label: t('الوعاء الزكوي', 'Zakatable amount'), value: d.zakatableValueSar, known: assessmentKnown, note: d.latestAssessmentDate ? `${t('آخر احتساب', 'Assessed')} · ${d.latestAssessmentDate}` : t('وفق الأصول المسجلة', 'Based on registered assets')},
    {key: 'due', label: t('الزكاة المستحقة', 'Zakat due'), value: d.explicitZakahDueSar, known: assessmentKnown, note: t('الدورة الحالية · وفق الاحتساب', 'Current cycle · assessed amount')},
    {key: 'paid', label: t('المسدّد حتى الآن', 'Paid so far'), value: d.allocatedZakahPaidSar, known: paymentKnown, note: `${paid.toFixed(1)}% ${t('من المستحق', 'of amount due')}`, percent: paid},
    {key: 'clock', label: t('المتبقي للسداد', 'Remaining'), value: d.remainingZakahSar, known: paymentKnown, note: d.daysToDue == null ? t('لم يُحدّد تاريخ الاستحقاق', 'No due date set') : Number(d.daysToDue) < 0 ? `${t('متأخر', 'Overdue')} ${Math.abs(d.daysToDue)} ${t('يومًا', 'days')}` : `${t('يستحق خلال', 'Due in')} ${d.daysToDue} ${t('يومًا', 'days')}`, percent: Number(d.explicitZakahDueSar) > 0 ? 100 - paid : 0},
  ];
  const steps = [
    {title: t('تسجيل الأصول', 'Assets recorded'), detail: `${d.assetCount || 0} ${t('أصل نشط', 'active assets')}`, done: Number(d.assetCount) > 0},
    {title: t('الاحتساب الزكوي', 'Zakat assessment'), detail: d.latestAssessmentDate || t('لا يوجد احتساب بعد', 'Not assessed yet'), done: !!d.latestAssessmentDate && health.assessments !== false},
    {title: t('السداد', 'Payments'), detail: paymentKnown ? `${money(d.allocatedZakahPaidSar)} ${currency}` : '—', done: paymentKnown && Number(d.allocatedZakahPaidSar) > 0},
    {title: t('اكتمال السداد', 'Payment completed'), detail: paymentKnown ? `${t('المتبقي', 'Remaining')}: ${money(d.remainingZakahSar)} ${currency}` : '—', done: paymentKnown && Number(d.explicitZakahDueSar) > 0 && Number(d.remainingZakahSar) === 0},
  ];
  return <div className="ed-dashboard" dir={ar ? 'rtl' : 'ltr'}>
    <header className="ed-welcome">
      <div><p className="ed-eyebrow">ZAKATFLOW</p><h1>{t('نظرة عامة على زكاتك', 'Your Zakat overview')}</h1><p>{t('أصولك، استحقاقاتك، وخطوتك التالية في مكان واحد.', 'Your assets, obligations and next steps in one place.')}</p></div>
      <div className="ed-cycle-control"><Link className="ed-cycle-link" href={path('assessments')}><Icon kind="clock"/>{c ? `${t('الدورة الزكوية', 'Zakat cycle')} #${c.cycle_no}` : t('إعداد الدورة الزكوية', 'Set up Zakat cycle')}<span aria-hidden="true">‹</span></Link><small><bdi>{c?.hawl_start_date || '—'}</bdi> — <bdi>{c?.hawl_due_date || '—'}</bdi></small><nav aria-label={t('عملة العرض', 'Display currency')} className="ed-currency">{['SAR', 'USD'].map(x => <Link key={x} aria-current={currency === x ? 'true' : undefined} href={`${path('dashboard')}?currency=${x}`}>{x}</Link>)}</nav></div>
    </header>
    {missing && <p className="ed-warning" role="status">{t('تعذر تحميل بعض البيانات. المؤشرات غير المتاحة معروضة بشرطة، وليست رصيدًا صفريًا.', 'Some data could not be loaded. Unavailable indicators show a dash, not a zero balance.')}</p>}
    <section className="ed-kpis" aria-label={t('المؤشرات المالية', 'Financial indicators')}>{metrics.map(m => <article key={m.key} className={`ed-metric ed-metric-${m.key}`}><div className="ed-metric-heading"><h2>{m.label}</h2><span className="ed-icon"><Icon kind={m.key}/></span></div><strong className="ed-number">{m.known ? amount(m.value) : '—'}</strong><p>{m.known ? m.note : t('البيانات غير متاحة', 'Data unavailable')}</p>{m.percent != null && m.known && <progress max={100} value={m.percent} aria-label={m.label}/>}</article>)}</section>
    {Number(d.priorCyclesUnpaidSar) > 0 && <aside className="ed-warning">{t('رصيد مستحق من دورات سابقة', 'Prior-cycle balance')}: {amount(d.priorCyclesUnpaidSar)} <Link href={path('payments')}>{t('مراجعة السداد', 'Review payments')} ←</Link></aside>}
    <div className="ed-grid">
      <Panel title={t('توزيع الأصول', 'Asset allocation')} href={path('assets')} action={t('عرض الكل', 'View all')}>
        <div className="ed-allocation"><div className="ed-ring" style={{background: gradient}} role="img" aria-label={t('توزيع قيمة الأصول حسب الفئة؛ التفاصيل في القائمة المجاورة', 'Asset value by category; details in adjacent list')}><div><strong><bdi>{money(d.totalCurrentSar)}</bdi></strong><small>{currency}</small></div></div><ul className="ed-legend">{segments.map((s, i) => <li key={s.type}><span className="ed-dot" style={{background: colors[i % colors.length]}}/><span>{types[s.type]?.[ar ? 0 : 1] || s.type}</span><bdi>{money(s.value)}</bdi><small><bdi>{s.percent.toFixed(1)}%</bdi></small></li>)}</ul></div>
        {!segments.length && <p className="ed-empty">{t('لا توجد قيم موجبة مسجلة لعرض التوزيع.', 'No positive asset values available.')}</p>}
      </Panel>
      <Panel title={t('اتجاه الزكاة', 'Zakat trend')} href={path('reports')} action={t('عرض التقرير', 'View report')}>
        <p className="ed-caption">{t('المستحق في آخر الاحتسابات المحفوظة', 'Due across recent saved assessments')}</p>
        {health.assessments === false || !history.length ? <p className="ed-empty">{t('يظهر الاتجاه بعد حفظ احتساب زكوي.', 'Save an assessment to see the trend.')}</p> : <div className="ed-chart" aria-label={t('مبالغ الزكاة بحسب تاريخ الاحتساب', 'Zakat by assessment date')}>{history.map((x: any) => <div className="ed-bar-column" key={x.id}><div className="ed-bar-space"><div className="ed-bar" style={{height: `${Math.max(0, Number(x.zakat_due) || 0) / maxDue * 100}%`}}/></div><bdi>{new Intl.NumberFormat('en-US', {maximumFractionDigits: 2}).format(Number(x.zakat_due) || 0)}</bdi><small>{x.currency || 'SAR'}</small><time dateTime={x.assessment_date}>{x.assessment_date}</time></div>)}</div>}
      </Panel>
      <Panel title={t('تقدم السنة الزكوية', 'Zakat year progress')} href={path('lots')} action={t('عرض التفاصيل', 'View details')}>
        {progress ? <><div className="ed-hawl"><div className="ed-ring ed-hawl-ring" style={{background: `conic-gradient(#087653 ${progress.percent}%, #dcefe6 0)`}}><div><strong>{Math.round(progress.percent)}%</strong></div></div><div><strong className="ed-days">{progress.elapsed} <small>{t('يومًا', 'days')}</small></strong><p>{t('من أصل', 'of')} {progress.total} {t('يومًا', 'days')}</p></div></div><div className="ed-timeline"><div><span/>{t('البداية', 'Start')}<time>{c.hawl_start_date}</time></div><div><span/>{t('اليوم', 'Today')}<time>{d.asOfDate}</time></div><div><span/>{t('الاستحقاق', 'Due')}<time>{c.hawl_due_date}</time></div></div></> : <p className="ed-empty">{t('حدّد بداية الحول وتاريخ الاستحقاق لعرض التقدم.', 'Set the Hawl start and due date to see progress.')}</p>}
      </Panel>
      <Panel title={t('أحدث المدفوعات', 'Recent payments')} href={path('payments')} action={t('عرض الكل', 'View all')}>
        <ul className="ed-list">{(health.payments === false ? [] : d.recentPayments || []).slice(0, 5).map((p: any) => <li key={p.id}><span className="ed-list-icon"><Icon kind="paid"/></span><div><span>{p.beneficiary || t('دفعة زكاة', 'Zakat payment')}</span><time>{p.payment_date}</time></div><strong><bdi>{new Intl.NumberFormat('en-US', {maximumFractionDigits: 2}).format(Number(p.amount) || 0)} <span className="ed-unit">{p.currency}</span></bdi></strong></li>)}</ul>
        {(!d.recentPayments?.length || health.payments === false) && <p className="ed-empty">{health.payments === false ? t('المدفوعات غير متاحة حاليًا', 'Payments unavailable') : t('لا توجد مدفوعات مسجلة بعد', 'No payments recorded yet')}</p>}
      </Panel>
      <Panel title={t('أهم الأصول', 'Top assets')} href={path('assets')} action={t('عرض الأصول', 'View assets')}>
        <ul className="ed-list">{(d.topAssets || []).slice(0, 5).map((a: any, i: number) => <li key={a.id}><span className="ed-list-icon" style={{color: colors[i]}}><Icon kind="assets"/></span><div><span>{a.name}</span><small>{types[a.type]?.[ar ? 0 : 1] || a.type}</small></div><strong>{amount(a.value)}</strong><small><bdi>{Number(d.totalCurrentSar) > 0 ? (Number(a.value) / Number(d.totalCurrentSar) * 100).toFixed(1) : '—'}%</bdi></small></li>)}</ul>
        {!d.topAssets?.length && <p className="ed-empty">{t('أضف أصلًا لعرض محفظتك هنا.', 'Add an asset to see your portfolio here.')}</p>}
      </Panel>
      <Panel title={t('حالة الزكاة', 'Zakat status')} href={path('assessments')} action={t('عرض التفاصيل', 'View details')}>
        <ol className="ed-steps">{steps.map((s, i) => <li key={s.title} className={s.done ? 'is-done' : ''}><span className="ed-step-icon" aria-hidden="true">{s.done ? '✓' : i + 1}</span><div><strong>{s.title}</strong><small>{s.detail}</small></div></li>)}</ol>
      </Panel>
    </div>
    <p className="ed-footnote">{t('القيم حسب البيانات المسجلة. الاحتساب والسداد مرتبطان بالدورة الزكوية الحالية.', 'Values reflect recorded data. Assessment and payments relate to the current Zakat cycle.')}{currency === 'USD' && t(' · تحويل العرض: 1 USD = 3.75 SAR.', ' · Display conversion: 1 USD = 3.75 SAR.')}</p>
  </div>;
}
