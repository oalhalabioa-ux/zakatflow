'use client';

import {useEffect, useState} from 'react';
import type {SaleExpense} from '@/lib/asset-realized-profit';
import {Money} from '@/components/DisplayCurrency';

type Props = {
  saleId: string;
  organizationId?: string | null;
  currency: string;
  ar: boolean;
  editable: boolean;
  onChanged: () => void;
};

export default function AssetSaleExpenses({saleId, organizationId, currency, ar, editable, onChanged}: Props) {
  const t = (arabic: string, english: string) => ar ? arabic : english;
  const endpoint = `/api/assets/sale-expenses/${saleId}`;
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SaleExpense[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [unlink, setUnlink] = useState<SaleExpense | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(endpoint, {cache: 'no-store', signal: controller.signal}).then(async response => {
      if (!response.ok) throw Error('SALE_EXPENSE_REQUEST_FAILED');
      const data = await response.json();
      if (!controller.signal.aborted) setRows(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError('SALE_EXPENSE_REQUEST_FAILED');
    });
    return () => controller.abort();
  }, [endpoint, open, revision]);

  const messages: Record<string, string> = {
    SALE_EXPENSE_REQUEST_FAILED: t('تعذر تحميل أو حفظ مصاريف البيع.', 'Could not load or save selling expenses.'),
    SALE_EXPENSE_SOURCE_UNAVAILABLE: t('اختر سند مصروف مؤهلاً ضمن نفس نطاق البيع وعملة الأساس.', 'Choose an eligible expense voucher in the sale scope and base currency.'),
    SALE_EXPENSE_ALREADY_LINKED: t('هذا المصروف مرتبط بسند بيع آخر.', 'This expense is linked to another sale.'),
    SALE_EXPENSE_SALE_INACTIVE: t('سند البيع غير نشط. افتح السند الحالي.', 'The sale voucher is inactive. Open the current voucher.'),
    SALE_EXPENSE_ACCESS_DENIED: t('صلاحية ربط المصاريف غير متاحة.', 'You do not have permission to link expenses.'),
  };

  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({source: unlink?.source_id ?? source, reason, remove: Boolean(unlink)}),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setSource('');
      setReason('');
      setUnlink(null);
      setSaved(true);
      setRevision(value => value + 1);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SALE_EXPENSE_REQUEST_FAILED');
    } finally {
      setBusy(false);
    }
  }

  return <details className="section" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t('مصاريف البيع المرتبطة', 'Linked selling expenses')}</summary>
    {error && <p role="alert">{messages[error] ?? messages.SALE_EXPENSE_REQUEST_FAILED}</p>}
    {saved && <p role="status">{t('تم حفظ ربط المصروف.', 'Expense link saved.')}</p>}
    {open && !rows && !error && <p role="status">{t('جارٍ التحميل…', 'Loading…')}</p>}
    {rows?.length === 0 && <p className="muted">{t('لا توجد مصاريف مرتبطة بهذا السند.', 'No expenses are linked to this voucher.')}</p>}
    {Boolean(rows?.length) && <ul>{rows!.map((item, index) => <li key={item.source_id ?? index}>
      <bdi>{item.voucher ?? item.source_id ?? '—'}</bdi>{' · '}
      {item.state === 'RECORDED' && item.amount !== null ? <Money value={item.amount} currency={currency} organizationId={organizationId}/>
        : item.state === 'REVERSED' ? t('معكوس', 'Reversed') : t('بيانات غير مكتملة', 'Incomplete data')}{' '}
      {editable && item.source_id && <button className="btn secondary" type="button" disabled={busy}
        onClick={() => {setUnlink(item); setReason(''); setSaved(false);}}>{t('فك الربط', 'Unlink')}</button>}
    </li>)}</ul>}
    {editable && <form className="section form-grid" onSubmit={event => {event.preventDefault(); void save();}}>
      {unlink ? <p>{t('فك ربط المصروف', 'Unlink expense')} <bdi>{unlink.voucher ?? unlink.source_id}</bdi></p>
        : <label>{t('رقم سند المصروف', 'Expense voucher number')}
            <input value={source} onChange={event => setSource(event.target.value)} maxLength={80} required disabled={busy}/>
          </label>}
      <label>{t('سبب الربط أو فكه', 'Reason for linking or unlinking')}
        <input value={reason} onChange={event => setReason(event.target.value)} minLength={5} maxLength={500} required disabled={busy}/>
      </label>
      <button className="btn" type="submit" disabled={busy}>{unlink ? t('تأكيد فك الربط', 'Confirm unlink') : t('ربط المصروف', 'Link expense')}</button>
      {unlink && <button className="btn secondary" type="button" disabled={busy} onClick={() => {setUnlink(null);setReason('');}}>{t('إلغاء', 'Cancel')}</button>}
    </form>}
  </details>;
}
