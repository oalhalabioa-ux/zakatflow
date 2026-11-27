'use client';

import dynamic from 'next/dynamic';
import {useEffect, useMemo, useRef, useState} from 'react';
import ActionButton, {ActionIconGlyph} from './ActionButton';
import DetailsDialog from './assets/DetailsDialog';
import {operationalReportQuery, type ReportScopeSelection} from '../lib/operational-report-scope';
import {fixedReportToday, type FixedMetric, type FixedReport} from '../lib/fixed-asset-report';
import {vatReportPrintHtml} from '../lib/vat-report-print';
import {reportCsv} from '../lib/vat-financial-reports';
import './fixed-asset-report-center.css';

const AssetOperationDetails = dynamic(() => import('./assets/AssetOperationDetails'));
const byMetric: Record<FixedMetric, [string, string]> = {
 gross: ['تكلفة الأصول القائمة', 'Gross cost in use'],
 accumulated: ['مجمع الإهلاك', 'Accumulated depreciation'],
 book: ['صافي القيمة الدفترية', 'Net book value'],
 depreciation: ['إهلاك الفترة', 'Period depreciation'],
 maintenance: ['صيانة الفترة', 'Period maintenance'],
 improvements: ['التحسينات الرأسمالية', 'Capital improvements'],
};
const views = [
 ['register', 'سجل الأصول', 'Asset register'],
 ['depreciation', 'الإهلاك المرحّل', 'Posted depreciation'],
 ['exits', 'البيع والاستبعاد', 'Sales and disposals'],
] as const;
type View = typeof views[number][0];
type NamedRecord = {id: string; name: string; organization_id?: string};
type Catalog = {organizations: NamedRecord[]; entities: NamedRecord[]; cost_centers?: NamedRecord[]};

export default function FixedAssetReportCenter({ar, selection, catalog, organizationIds}: {
 ar: boolean; selection: ReportScopeSelection; catalog: Catalog; organizationIds: string[];
}) {
 const t = (a: string, e: string) => ar ? a : e;
 const personal = selection.scope === 'PERSONAL';
 const today = useMemo(fixedReportToday, []);
 const [view, setView] = useState<View>('register');
 const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
 const [to, setTo] = useState(today);
 const [search, setSearch] = useState('');
 const [category, setCategory] = useState('');
 const [center, setCenter] = useState('');
 const [state, setState] = useState('');
 const [offset, setOffset] = useState(0);
 const [sort, setSort] = useState({column: 'name', order: 'asc'});
 const [hidden, setHidden] = useState<string[]>([]);
 const [source, setSource] = useState<string | null>(null);
 const [revision, setRevision] = useState(0);
 const [exporting, setExporting] = useState(false);
 const [exportError, setExportError] = useState(false);
 const exportRequest = useRef<AbortController | null>(null);
 const [result, setResult] = useState<{url: string; revision: number; data?: FixedReport; error?: number} | null>(null);
 const [query, setQuery] = useState('');
 useEffect(() => {
  const task = window.setTimeout(() => {setQuery(search.trim());setOffset(0);}, 240);
  return () => window.clearTimeout(task);
 }, [search]);
 const scopeParams = operationalReportQuery(selection);
 const dateValid = !from || !to || from <= to;
 let url = '';
 if (scopeParams && dateValid) {
  scopeParams.set('view', view);
  scopeParams.set('offset', String(offset));
  scopeParams.set('sort', sort.column);
  scopeParams.set('order', sort.order);
  if (from) scopeParams.set('from', from);
  if (to) scopeParams.set('to', to);
  if (query) scopeParams.set('query', query);
  if (category) scopeParams.set('category', category);
  if (state) scopeParams.set('state', state);
  if (!personal && center) scopeParams.set('center', center);
  url = `/api/reports/fixed-assets?${scopeParams}`;
 }
 useEffect(() => {
  setExporting(false);
  setExportError(false);
  return () => exportRequest.current?.abort();
 }, [url]);
 useEffect(() => {
  if (!url) return;
  const controller = new AbortController();
  async function load() {
   try {
    const response = await fetch(url, {signal: controller.signal, cache: 'no-store'});
    if (!response.ok) {
     if (!controller.signal.aborted) setResult({url, revision, error: response.status});
     return;
    }
    const data = await response.json();
    if (!controller.signal.aborted) setResult({url, revision, data});
   } catch {
    if (!controller.signal.aborted) setResult({url, revision, error: 500});
   }
  }
  void load();
  return () => controller.abort();
 }, [url, revision]);

 const current = result?.url === url && result.revision === revision ? result : null;
 const data = current?.data;
 const formatter = useMemo(() => new Intl.NumberFormat(ar ? 'ar-SA' : 'en-GB', {maximumFractionDigits: 2}), [ar]);
 const currencyText = (currency: string) => ar && currency === 'SAR' ? 'ر.س' : currency;
 const amount = (value: string | null, currency: string) => value == null ? '—' : (
  <bdi className="fixed-amount">{formatter.format(value as `${number}`)} <small>{currencyText(currency)}</small></bdi>
 );
 const kindLabel = (kind: string) => kind === 'SALE' ? t('بيع', 'Sale') : kind === 'DISPOSAL' ? t('استبعاد', 'Disposal') : t('إهلاك', 'Depreciation');
 const stateLabel = (state: string) => state === 'ACTIVE' ? t('قائم', 'In register') : state === 'EXITED' ? t('خارج السجل', 'Exited') :
  state === 'PENDING' ? t('بانتظار الترحيل', 'Unposted') : t('بحاجة إلى دليل', 'Unverified');
 const categoryLabel = (code: string) => code === 'PPE' ? t('ممتلكات وآلات ومعدات', 'Property, plant & equipment') :
  code === 'INTANGIBLE' ? t('أصول غير ملموسة', 'Intangible assets') : t('عقارات قديمة غير مصنفة', 'Legacy real estate');
 const columns = view === 'register' ? [
  ['name', t('الأصل', 'Asset')], ['class', t('الفئة', 'Class')], ['acquisition', t('الاقتناء', 'Acquired')],
  ['quantity', t('الكمية القائمة', 'Quantity in use')], ['gross', t('التكلفة القائمة', 'Gross cost')], ['accumulated', t('المجمع', 'Accumulated')], ['book', t('صافي الدفترية', 'Net book value')],
  ['state', t('الحالة', 'Status')],
 ] : [
  ['name', t('الأصل', 'Asset')], ['date', t('التاريخ', 'Date')], ['kind', t('الحركة', 'Movement')],
  ['cost', view === 'exits' ? t('الدفترية المستبعدة', 'Book value removed') : t('إهلاك مرحّل', 'Posted amount')],
  ...(view === 'exits' ? [['proceeds', t('المقابل', 'Proceeds')], ['gain', t('نتيجة سند البيع', 'Recorded sale result')]] : []),
  ['state', t('الحالة', 'Status')],
 ];
 const visible = columns.filter(([key]) => !hidden.includes(key));
 function selectView(next: View) {setView(next);setHidden([]);setOffset(0);setExportError(false);}
 function sortBy(column: string) {
  setOffset(0);
  setSort(value => ({column, order: value.column === column && value.order === 'asc' ? 'desc' : 'asc'}));
 }
 function exportRows(report: FixedReport) {
  const measure = (value: string | null, currency: string) => value == null ? '' : `${value} ${currency}`;
  const records = view === 'register' ? report.register.map(row => ({
   name: row.name, class: categoryLabel(row.classCode), acquisition: row.acquisition ?? '', quantity: row.quantity ?? '', gross: measure(row.gross, row.currency),
   accumulated: measure(row.accumulated, row.currency), book: measure(row.book, row.currency), state: stateLabel(row.state), source: row.sourceId ?? '',
  })) : report.movements.map(row => ({
   name: row.assetName, date: row.date, kind: kindLabel(row.kind), cost: measure(row.cost, row.currency), proceeds: measure(row.proceeds, row.currency),
   gain: measure(row.gain, row.currency), state: row.posted ? t('مسجل', 'Recorded') : t('بحاجة إلى دليل', 'Unverified'), source: row.id,
  }));
  return [visible.map(([, label]) => label).concat(t('مرجع المصدر', 'Source ID')),
   ...records.map(record => visible.map(([key]) => (record as Record<string, string>)[key] ?? '').concat(record.source))];
 }
 async function exportReport(format: 'CSV' | 'PDF') {
  const preview = format === 'PDF' ? window.open('', '_blank') : null;
  if (format === 'PDF' && !preview) {setExportError(true);return;}
  if (preview) preview.opener = null;
  const controller = new AbortController();
  exportRequest.current = controller;
  setExporting(true);setExportError(false);
  try {
   const response = await fetch(`${url}&full=1`, {cache: 'no-store', signal: controller.signal});
   if (!response.ok) throw Error('FIXED_ASSET_EXPORT_FAILED');
   const report = await response.json();
   if (controller.signal.aborted) {preview?.close();return;}
   const [headings, ...rows] = exportRows(report);
   if (preview) {
    const title = views.find(row => row[0] === view)![ar ? 1 : 2];
    preview.document.write(vatReportPrintHtml(title, `${scopeLabel} · ${from} — ${to}`, headings, rows, ar, '#10243a',
     {footer: t('القيم بعملة المصدر. الحركات بحسب الفترة المختارة.', 'Values in source currency. Movements follow the selected period.')}));
    preview.document.close();
    return;
   }
   const download = URL.createObjectURL(new Blob([reportCsv([headings, ...rows])], {type: 'text/csv;charset=utf-8'}));
   const link = document.createElement('a');
   link.href = download;link.download = `fixed-assets-${view}.csv`;link.click();
   window.setTimeout(() => URL.revokeObjectURL(download), 1000);
  } catch {
   preview?.close();
   if (!controller.signal.aborted) setExportError(true);
  } finally {
   if (!controller.signal.aborted) setExporting(false);
  }
 }
 const centerOptions = catalog.cost_centers?.filter(item => !personal && item.organization_id && organizationIds.includes(item.organization_id)) ?? [];
 const scopeLabel = personal ? t('الشخصي', 'Personal') : catalog.organizations.find(item => item.id === selection.organization)?.name ?? t('المؤسسي', 'Organization');
 const records = view === 'register' ? data?.register.map(row => ({
  id: row.id, source: row.sourceId, cells: {
   name: row.name, class: categoryLabel(row.classCode), acquisition: row.acquisition ?? '—', quantity: row.quantity == null ? '—' : formatter.format(row.quantity as `${number}`), gross: amount(row.gross, row.currency),
   accumulated: amount(row.accumulated, row.currency), book: amount(row.book, row.currency),
   state: <span data-state={row.state} className="fixed-state">{stateLabel(row.state)}</span>,
  },
 })) : data?.movements.map(row => ({
  id: row.id, source: row.id, cells: {name: row.assetName, date: row.date, kind: kindLabel(row.kind), cost: amount(row.cost, row.currency),
   proceeds: amount(row.proceeds, row.currency), gain: amount(row.gain, row.currency),
   state: <span data-state={row.posted ? 'ACTIVE' : 'UNVERIFIED'} className="fixed-state">{row.posted ? t('مسجل', 'Recorded') : t('بحاجة إلى دليل', 'Unverified')}</span>,
  },
 }));
 return <section className="fixed-assets" aria-labelledby="fixed-assets-title">
  <header className="fixed-assets-heading">
   <div className="fixed-heading-icon" aria-hidden="true"><ActionIconGlyph name="details"/></div>
   <div><p className="fixed-scope">{scopeLabel}</p><h2 id="fixed-assets-title">{t('مركز إدارة وتقارير الأصول الثابتة', 'Fixed assets management & reporting')}</h2></div>
  </header>
  {!scopeParams && dateValid && <p className="fixed-message">{t('اختر المؤسسة من الشريط العلوي لعرض أصولها.', 'Choose an organization from the top bar to view its assets.')}</p>}
  {data?.summary.map(summary => <div className="fixed-kpi-group" key={summary.currency}>
   <div className="fixed-kpi-meta"><strong>{summary.currency}</strong><span>{formatter.format(summary.recognized)} {t('أصل مسجل', 'recorded assets')}</span></div>
   <div className="fixed-kpis">{Object.keys(byMetric).map(metric => {
    const key = metric as FixedMetric;
    return <div className="fixed-kpi" key={key} data-key={key}><span>{byMetric[key][ar ? 0 : 1]}</span>
     <strong>{amount(summary[key], summary.currency)}</strong></div>;
   })}</div>
  </div>)}
  <div className="fixed-workbench">
   <nav className="fixed-views" aria-label={t('أقسام مركز الأصول', 'Fixed asset reports')}>
    {views.map(([key, label, en]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => selectView(key)}>{ar ? label : en}</button>)}
   </nav>
   <div className="fixed-controls">
    <label className="fixed-search">{t('بحث بالأصل', 'Find an asset')}<input type="search" value={search} maxLength={120} onChange={event => setSearch(event.target.value)}/></label>
    <details><summary>{t('الفلاتر', 'Filters')}</summary><div className="fixed-menu fixed-filters">
     <label>{t('من تاريخ', 'From')}<input type="date" value={from} max={to} onChange={event => {setFrom(event.target.value);setOffset(0);}}/></label>
     <label>{t('إلى تاريخ', 'To')}<input type="date" value={to} min={from} onChange={event => {setTo(event.target.value);setOffset(0);}}/></label>
     <label>{t('الفئة', 'Class')}<select value={category} onChange={event => {setCategory(event.target.value);setOffset(0);}}>
      <option value="">{t('كل الفئات', 'All classes')}</option>{['PPE', 'INTANGIBLE', 'LEGACY_REAL_ESTATE'].map(code => <option key={code} value={code}>{categoryLabel(code)}</option>)}
     </select></label>
     <label>{t('حالة الأصل الحالية', 'Current asset status')}<select value={state} onChange={event => {setState(event.target.value);setOffset(0);}}>
      <option value="">{t('كل الحالات', 'All statuses')}</option>{['ACTIVE', 'EXITED', 'PENDING', 'UNVERIFIED'].map(code => <option key={code} value={code}>{stateLabel(code)}</option>)}
     </select></label>
     {centerOptions.length > 0 && <label>{t('مركز التكلفة', 'Cost center')}<select value={center} onChange={event => {setCenter(event.target.value);setOffset(0);}}>
      <option value="">{t('كل المراكز', 'All cost centers')}</option>{centerOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
     </select></label>}
    </div></details>
    <details><summary>{t('الأعمدة', 'Columns')}</summary><div className="fixed-menu">
     {columns.map(([key, label]) => <label className="fixed-checkbox" key={key}><input type="checkbox" disabled={key === 'name'} checked={!hidden.includes(key)}
      onChange={event => setHidden(items => event.target.checked ? items.filter(item => item !== key) : [...items, key])}/>{label}</label>)}
    </div></details>
    <ActionButton icon="download" label={t('تصدير CSV', 'Export CSV')} showLabel disabled={!data?.total || exporting} onClick={() => void exportReport('CSV')}/>
    <ActionButton icon="print" label={t('طباعة PDF', 'Print PDF')} showLabel disabled={!data?.total || exporting} onClick={() => void exportReport('PDF')}/>
   </div>
   <p className="fixed-caption"><span>{t('الرصيد الحالي · حركات الفترة', 'Current balances · Period movements')}</span><bdi>{from || '—'} — {to || '—'}</bdi></p>
   {!dateValid && <p role="alert" className="fixed-message">{t('راجع تاريخ بداية الفترة ونهايتها.', 'Review the period start and end dates.')}</p>}
   {url && !current && <p role="status" className="fixed-message">{t('جارٍ تحميل الأصول…', 'Loading fixed assets…')}</p>}
   {current?.error && <p role="alert" className="fixed-message">{current.error === 403 ? t('لا تملك صلاحية عرض أصول هذا النطاق.', 'You do not have access to assets in this scope.') :
    current.error === 422 ? t('تعذر استخراج رصيد هذا النطاق. جرّب تضييق الفلاتر.', 'Unable to extract balances for this scope. Try narrower filters.') :
     t('تعذر تحميل التقرير.', 'Unable to load the report.')} <button className="fixed-inline" onClick={() => setRevision(value => value + 1)}>{t('إعادة المحاولة', 'Retry')}</button></p>}
   {view === 'exits' && <p className="fixed-caption">{t('راجع مصاريف البيع والتسويات المرتبطة في السند الأصلي.', 'Review selling costs and related settlements in the source voucher.')}</p>}
   {exportError && <p role="alert" className="fixed-message">{t('تعذر تنزيل التقرير.', 'Unable to download the report.')}</p>}
   {data && <><div className="fixed-table-scroll" tabIndex={0} aria-label={t('جدول الأصول', 'Asset table')}>
    <table><thead><tr>{visible.map(([key, label]) => {
     const sortable = view === 'register' && (key === 'name' || key === 'acquisition');
     return <th key={key} scope="col" aria-sort={sortable ? sort.column === key ? sort.order === 'asc' ? 'ascending' : 'descending' : 'none' : undefined}>
      {sortable ? <button type="button" onClick={() => sortBy(key)}>{label} {sort.column === key && (sort.order === 'asc' ? '↑' : '↓')}</button> : label}</th>;
    })}<th scope="col">{t('المصدر', 'Source')}</th></tr></thead>
     <tbody>{records?.map(row => <tr key={row.id}>{visible.map(([key]) => <td key={key}>{row.cells[key as keyof typeof row.cells]}</td>)}
      <td>{row.source ? <ActionButton icon="details" label={t('فتح السند الأصلي', 'Open source voucher')} onClick={() => setSource(row.source)}/> : '—'}</td></tr>)}
      {!data.total && <tr><td colSpan={visible.length + 1}>{t('لا توجد أصول أو حركات مطابقة.', 'No assets or movements match the filters.')}</td></tr>}
     </tbody></table></div>
    {data.total > 0 && <footer className="fixed-pagination"><span>{formatter.format(offset + 1)}–{formatter.format(Math.min(offset + 25, data.total))} / {formatter.format(data.total)}</span>
     <button type="button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 25))}>{t('السابق', 'Previous')}</button>
     <button type="button" disabled={offset + 25 >= data.total} onClick={() => setOffset(value => value + 25)}>{t('التالي', 'Next')}</button>
    </footer>}
   </>}
  </div>
  <p className="fixed-note">{t('الشرطة تعني أن البيانات اللازمة لإثبات الرقم غير متاحة. الرصيد الافتتاحي الدفتري قد لا يبيّن التكلفة ومجمع الإهلاك كلًا على حدة.', 'A dash marks a figure without sufficient source evidence. Opening book balances may not identify gross cost and accumulated depreciation separately.')}</p>
  {personal && <p className="fixed-note">{t('الإهلاك الشخصي التقديري خارج أرقام هذا التقرير.', 'Personal depreciation estimates are excluded from these figures.')}</p>}
  {source && <DetailsDialog label={t('السند الأصلي', 'Source voucher')} onClose={() => setSource(null)}>
   <AssetOperationDetails record={{id: source}} ar={ar} onClose={() => setSource(null)} onChanged={() => setRevision(value => value + 1)}/>
  </DetailsDialog>}
 </section>;
}
