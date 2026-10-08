'use client';
import { useEffect, useMemo, useState } from 'react';
import { UnifiedInvoiceActions } from './unified-invoice-actions';
import { InvoiceRegisterFilters } from './invoice-register-filters';
import { InvoicePaymentBadge } from './invoice-payment-badge';
import { emptyInvoiceFilters, filterInvoiceRows, invoicePaymentState } from '@/lib/invoice-register-filters';
import type { UnifiedInvoice } from '@/lib/unified-invoice-register';
const accountingLabels: Record<string, [string,string]> = { ACTUAL: ['مرحّلة','Posted'], COMMITTED: ['بانتظار الترحيل','Pending posting'], PLANNED: ['مخططة','Planned'], DRAFT: ['مسودة','Draft'], REVERSED: ['معكوسة','Reversed'], UNLINKED: ['غير مرتبطة','Unlinked'] };
const issueLabels: Record<string, [string,string]> = { DRAFT: ['مسودة','Draft'], NOT_ISSUED: ['غير مصدرة','Not issued'], ISSUED: ['صادرة — QR المرحلة الأولى','Issued — Phase 1 QR'], CLEARED: ['معتمدة','Cleared'], REPORTED: ['مبلّغ عنها','Reported'], SUBMITTED: ['مرسلة','Submitted'], REJECTED: ['مرفوضة','Rejected'], VOID: ['ملغاة','Void'] };
const kindLabels: Record<string, [string,string]> = { INVOICE: ['فاتورة','Invoice'], CREDIT_NOTE: ['إشعار دائن','Credit note'], DEBIT_NOTE: ['إشعار مدين','Debit note'] };
const label = (labels: Record<string,[string,string]>, key: string, ar: boolean) => labels[key]?.[ar ? 0 : 1] || key;
const money = (value: number | string, currency: string) => `${Number(value).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:2})} ${currency}`;
export function UnifiedInvoiceRegister({ organizationId, ar, refresh }: { organizationId: string; ar: boolean; refresh: number }) {
  const [rows, setRows] = useState<UnifiedInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState({ ...emptyInvoiceFilters });
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [side, setSide] = useState('ALL');
  const [accounting, setAccounting] = useState('ALL');
  const [actionRow, setActionRow] = useState<UnifiedInvoice | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setRows([]); setLoading(true); setError(false); setSelectedId(null);
    async function load() {
      let offset: number | null = 0;
      const collected = new Map<string, UnifiedInvoice>();
      while (offset !== null) {
        const response = await fetch(`/api/vat/register?organization_id=${encodeURIComponent(organizationId)}&offset=${offset}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('REGISTER_LOAD_FAILED');
        const body: { rows: UnifiedInvoice[]; nextOffset: number | null } = await response.json();
        for (const row of body.rows) collected.set(row.id, row);
        if (body.nextOffset !== null && body.nextOffset <= offset) throw new Error('REGISTER_PAGINATION_FAILED');
        offset = body.nextOffset;
      }
      if (!controller.signal.aborted) setRows([...collected.values()]);
    }
    void load().catch(() => { if (!controller.signal.aborted) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [organizationId, refresh, revision]);
  const visible = useMemo(() => filterInvoiceRows(rows.filter(row => (includeDrafts || row.status !== 'DRAFT') && (side === 'ALL' || row.side === side) && (accounting === 'ALL' || row.accountingStatus === accounting)), filters, row => row), [rows, includeDrafts, side, accounting, filters]);
  const selected = visible.find(row => row.id === selectedId);
  const counts = useMemo(() => ({ drafts: rows.filter(r => r.status === 'DRAFT').length, posted: rows.filter(r => r.accountingStatus === 'ACTUAL').length, unpaid: rows.filter(r => r.kind === 'INVOICE' && invoicePaymentState(r) === 'UNPAID').length, notes: rows.filter(r => r.kind !== 'INVOICE').length }), [rows]);
  return <section className="vat-panel vat-unified-register" aria-busy={loading}>
    <div className="vat-panel-head"><div><h2>{ar ? 'سجل الفواتير الموحد' : 'Unified invoice register'}</h2><p>{ar ? 'كل تواريخ الشركة المختارة · المبيعات والمشتريات والإشعارات دون تكرار' : 'All dates for the selected company · Sales, purchases and notes without duplication'}</p></div><button type="button" className="vat-button secondary" disabled={loading} onClick={() => setRevision(v => v + 1)}>{ar ? 'تحديث السجل' : 'Refresh'}</button></div>
    {loading ? <p role="status">{ar ? 'جارٍ تحميل السجل الكامل…' : 'Loading the complete register…'}</p> : error ? <p role="alert">{ar ? 'تعذر تحميل السجل. اضغط تحديث لإعادة المحاولة.' : 'Could not load the register. Refresh to retry.'}</p> : <>
      <div className="vat-unified-metrics">{[[ar?'المستندات':'Documents',rows.length],[ar?'مرحّلة محاسبيًا':'Posted',counts.posted],[ar?'فواتير غير مسددة':'Unpaid invoices',counts.unpaid],[ar?'الإشعارات':'Notes',counts.notes]].map(([title,value]) => <div key={title}><small>{title}</small><strong>{value}</strong></div>)}</div>
      <div className="vat-unified-controls"><label>{ar?'الاتجاه':'Direction'}<select value={side} onChange={e => setSide(e.target.value)}><option value="ALL">{ar?'الكل':'All'}</option><option value="SALES">{ar?'مبيعات':'Sales'}</option><option value="PURCHASE">{ar?'مشتريات':'Purchases'}</option></select></label><label>{ar?'المحاسبة':'Accounting'}<select value={accounting} onChange={e => setAccounting(e.target.value)}><option value="ALL">{ar?'الكل':'All'}</option>{Object.keys(accountingLabels).map(key => <option key={key} value={key}>{label(accountingLabels,key,ar)}</option>)}</select></label><label className="vat-unified-drafts"><input type="checkbox" role="switch" checked={includeDrafts} onChange={e => setIncludeDrafts(e.target.checked)} />{ar?'إظهار المسودات':'Show drafts'} ({counts.drafts})</label></div>
      <InvoiceRegisterFilters value={filters} onChange={setFilters} ar={ar} currencies={[...new Set(rows.map(row => row.currency))].sort()} statuses={Object.keys(issueLabels).map(key => [key,label(issueLabels,key,ar)])} categories={Object.keys(kindLabels).map(key => [key,label(kindLabels,key,ar)])} count={visible.length} total={rows.length} />
      <p className="vat-disclaimer">{ar ? 'حالة الإصدار مستقلة عن الترحيل والسداد. «صادرة — QR المرحلة الأولى» لا تعني اعتماد الربط بالمرحلة الثانية. إظهار المسودات هنا لا يغيّر التقرير الضريبي.' : 'Issuance, accounting and payment are separate states. Phase 1 QR issuance does not mean Phase 2 clearance. Showing drafts here does not change the tax report.'}</p>
      <div className="vat-table-wrap"><table className="vat-table vat-unified-table"><caption className="vat-unified-caption">{ar?'الفواتير والإشعارات للشركة المختارة':'Invoices and notes for the selected company'}</caption><thead><tr>{(ar?['المستند / الجهة','التاريخ','النوع','الإجمالي','المحاسبة','الإصدار','السداد / التسوية','المتبقي','الإجراءات']:['Document / contact','Date','Type','Total','Accounting','Issuance','Payment / settlement','Outstanding','Actions']).map(title => <th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{visible.map(row => <tr key={row.id} className={selectedId === row.id ? 'selected' : ''}><td><strong>{row.number}</strong><small>{row.name}</small>{row.originalNumber && <small>{ar?'مرتبط بـ: ':'Linked to: '}{row.originalNumber}</small>}</td><td><span dir="ltr">{row.date}</span>{row.due && <small>{ar?'استحقاق: ':'Due: '}{row.due}</small>}</td><td>{row.side === 'SALES' ? (ar?'مبيعات':'Sales') : (ar?'مشتريات':'Purchases')}<small>{label(kindLabels,row.kind,ar)}</small></td><td dir="ltr">{money(row.total,row.currency)}</td><td><span className={`vat-payment-badge ${row.accountingStatus === 'ACTUAL' ? 'paid' : 'unlinked'}`}>{label(accountingLabels,row.accountingStatus,ar)}</span></td><td><span className="vat-unified-issue">{label(issueLabels,row.status,ar)}</span></td><td><InvoicePaymentBadge flow={row.flow} ar={ar} note={row.kind !== 'INVOICE'} />{row.kind !== 'INVOICE' && row.flow && <small>{row.flow.direction === 'OUTFLOW' ? (ar?'مبلغ مستحق للدفع':'Payable settlement') : (ar?'مبلغ مستحق للتحصيل':'Receivable settlement')}</small>}</td><td dir="ltr">{row.flow ? money(Math.max(0,Number(row.flow.amount)-Number(row.flow.settled_amount)),row.flow.currency) : '—'}</td><td><div className="vat-unified-actions"><button type="button" className="vat-button secondary" aria-expanded={selectedId === row.id} aria-controls="vat-unified-details" onClick={() => setSelectedId(selectedId === row.id ? null : row.id)}>{ar?'التفاصيل':'Details'}</button><button type="button" className="vat-button primary" onClick={() => setActionRow(row)}>{ar?'الإجراءات':'Actions'}</button></div></td></tr>)}</tbody></table></div>
      {visible.length === 0 && <p className="vat-empty">{rows.length ? (ar?'لا توجد مستندات تطابق الفلاتر.':'No documents match these filters.') : (ar?'لا توجد فواتير للشركة المختارة.':'No invoices for the selected company.')}</p>}
      <div id="vat-unified-details">{selected && <aside className="vat-unified-details" aria-label={ar?'تفاصيل المستند':'Document details'}><div className="vat-panel-head"><h3>{selected.number} · {selected.name}</h3><button className="vat-button secondary" type="button" onClick={() => setSelectedId(null)}>{ar?'إغلاق':'Close'}</button></div><dl><div><dt>{ar?'المستند الأصلي':'Original document'}</dt><dd>{selected.originalNumber || '—'}</dd></div><div><dt>{ar?'ضريبة المستند':'Document VAT'}</dt><dd dir="ltr">{money(selected.kind === 'CREDIT_NOTE' ? -selected.tax : selected.tax,selected.currency)}</dd></div><div><dt>{ar?'المسدد / المسوّى':'Paid / settled'}</dt><dd dir="ltr">{selected.flow ? money(selected.flow.settled_amount,selected.flow.currency) : '—'}</dd></div><div><dt>{ar?'ارتباط السيولة':'Liquidity link'}</dt><dd>{selected.flow ? (ar?'مرتبط':'Linked') : (ar?'غير مرتبط':'Unlinked')}</dd></div></dl><p>{ar?'يمكن تنفيذ الطباعة والتعديل والإصدار وسندات القبض من زر الإجراءات هنا، أو من شاشة الفواتير الحالية. الإشعارات تعدّل الذمة والضريبة عند ترحيلها، وحركة البنك تحتاج تسوية معتمدة.':'Use Actions here or the existing invoice workspace for printing, editing, issuance and receipts. Posted notes adjust the obligation and VAT; a bank movement requires an approved settlement.'}</p>{selected.flow && <a className="vat-button secondary" href={ar?'/ar/liquidity':'/en/liquidity'}>{ar?'فتح السيولة':'Open liquidity'}</a>}</aside>}</div>
    </>}
    {actionRow && <UnifiedInvoiceActions key={actionRow.id} row={rows.find(row=>row.id===actionRow.id) || actionRow} organizationId={organizationId} ar={ar} onClose={()=>{setActionRow(null);setRevision(v=>v+1);}} onChanged={()=>setRevision(v=>v+1)} />}
  </section>;
}
