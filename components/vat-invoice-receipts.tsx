'use client';

import { FormEvent, useEffect, useState } from 'react';

type Receipt = { event_id: string; settlement_id: string | null; status: string; amount: string | number; currency: string; date: string; account_id: string; account_name: string; editable: boolean };
type Account = { id: string; name: string; currency: string };

export function VatInvoiceReceipts({ organizationId, documentId, invoiceNumber, accounts, canEdit, ar, onClose, onPosted }: {
  organizationId: string; documentId: string; invoiceNumber: string; accounts: Account[]; canEdit: boolean; ar: boolean; onClose: () => void; onPosted: () => void;
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Receipt | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setEditing(null);
    fetch(`/api/vat/receipts?organization_id=${encodeURIComponent(organizationId)}&document_id=${encodeURIComponent(documentId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'RECEIPT_LOAD_FAILED');
        if (!controller.signal.aborted) setReceipts(body.receipts ?? []);
      }).catch(() => { if (!controller.signal.aborted) setMessage(ar ? 'تعذر تحميل سندات القبض. أعد المحاولة.' : 'Could not load receipts. Retry.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [organizationId, documentId, ar, revision]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || saving) return;
    const form = new FormData(event.currentTarget);
    setSaving(true); setMessage('');
    try {
      const response = await fetch('/api/vat/receipts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        organization_id: organizationId, event_id: editing.event_id, account_id: form.get('account_id'),
        settlement_date: form.get('date'), amount: Number(form.get('amount')),
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'RECEIPT_SAVE_FAILED');
      setReceipts((current) => current.map((row) => row.event_id === editing.event_id ? {
        ...row, amount: Number(form.get('amount')), date: String(form.get('date')), account_id: String(form.get('account_id')),
        account_name: accounts.find((account) => account.id === form.get('account_id'))?.name ?? row.account_name,
      } : row));
      setEditing(null);
      setMessage(ar ? 'حُفظ تعديل سند القبض؛ يبقى بانتظار الموافقة والترحيل، ولا يتغير رصيد البنك الآن.' : 'Receipt changes saved pending approval and posting; the bank balance is unchanged.');
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setMessage(code === 'RECEIPT_EDIT_LOCKED'
        ? (ar ? 'السند معتمد أو مرحّل ولا يقبل التعديل المباشر.' : 'Approved or posted receipts cannot be edited directly.')
        : code === 'SETTLEMENT_EXCEEDS_FLOW_OUTSTANDING'
          ? (ar ? 'المبلغ يتجاوز المتبقي الحالي للفاتورة.' : 'Amount exceeds the current invoice balance.')
          : (ar ? 'تعذر حفظ تعديل السند. تحقق من الحساب والتاريخ والمبلغ.' : 'Could not save receipt changes. Check account, date and amount.'));
    } finally { setSaving(false); }
  }

  async function post(receipt: Receipt) {
    if (saving) return;
    setSaving(true); setMessage('');
    try {
      const response = await fetch('/api/vat/receipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organization_id: organizationId, event_id: receipt.event_id }) });
      const body = await response.json();
      if (response.status === 202) {
        setMessage(ar ? 'السند محفوظ ويحتاج موافقة مستخدم مخوّل وفق سياسة المنشأة؛ لم يتحرك رصيد البنك.' : 'Receipt saved; an authorized approver is required under organization policy. The bank balance is unchanged.');
      } else {
        if (!response.ok || !body.posted) throw new Error(body.error || 'RECEIPT_POST_FAILED');
        setMessage(ar ? 'تم اعتماد وترحيل سند القبض وتحديث رصيد العميل والسيولة.' : 'Receipt approved and posted; receivable and liquidity updated.');
        onPosted();
      }
      setRevision((value) => value+1);
    } catch { setMessage(ar ? 'تعذر ترحيل السند. راجع الموافقة والمبلغ المتبقي.' : 'Could not post the receipt. Check approval and outstanding balance.'); }
    finally { setSaving(false); }
  }

  const statusLabel = (receipt: Receipt) => receipt.status === 'POSTED' ? (ar ? 'مرحّل' : 'Posted')
    : receipt.status === 'REVERSED' ? (ar ? 'معكوس' : 'Reversed')
    : receipt.status === 'CANCELLED' ? (ar ? 'ملغى' : 'Cancelled')
    : receipt.editable ? (ar ? 'بانتظار الموافقة' : 'Pending approval') : (ar ? 'معتمد / بانتظار الترحيل' : 'Approved / awaiting posting');
  return <section className="vat-import-panel" aria-label={ar ? 'سندات القبض' : 'Receipts'}>
    <div className="vat-section-heading"><h4>{ar ? 'سندات قبض الفاتورة' : 'Invoice receipts'} · {invoiceNumber}</h4><button type="button" className="vat-button secondary" disabled={saving} onClick={onClose}>{ar ? 'إغلاق' : 'Close'}</button></div>
    {message && <p role="status" className="vat-inline-warning">{message}</p>}
    {loading ? <p>{ar ? 'جارٍ تحميل السندات…' : 'Loading receipts…'}</p> : <>
      {!receipts.length && <p>{ar ? 'لا توجد سندات قبض محفوظة لهذه الفاتورة.' : 'No saved receipts for this invoice.'}</p>}
      <div className="vat-table-wrap"><table><thead><tr><th>{ar ? 'مرجع السند' : 'Receipt reference'}</th><th>{ar ? 'التاريخ' : 'Date'}</th><th>{ar ? 'الحساب' : 'Account'}</th><th>{ar ? 'المبلغ' : 'Amount'}</th><th>{ar ? 'الحالة' : 'Status'}</th><th>{ar ? 'الإجراء' : 'Action'}</th></tr></thead><tbody>
        {receipts.map((receipt) => <tr key={receipt.event_id}><td title={receipt.settlement_id ?? receipt.event_id}>{(receipt.settlement_id ?? receipt.event_id).slice(0,8)}</td><td>{receipt.date}</td><td>{receipt.account_name}</td><td>{Number(receipt.amount).toLocaleString(ar ? 'ar-SA' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {receipt.currency}</td><td>{statusLabel(receipt)}</td><td>{canEdit && receipt.editable && <button type="button" className="vat-button secondary" disabled={saving} onClick={() => setEditing(receipt)}>{ar ? 'تعديل' : 'Edit'}</button>}{canEdit && !receipt.settlement_id && ['DRAFT','PLANNED','COMMITTED'].includes(receipt.status) && <button type="button" className="vat-button primary" disabled={saving} onClick={() => void post(receipt)}>{ar ? 'اعتماد وترحيل' : 'Approve & post'}</button>}</td></tr>)}
      </tbody></table></div>
      <button type="button" className="vat-button secondary" disabled={saving} onClick={() => setRevision((value) => value+1)}>{ar ? 'تحديث السندات' : 'Refresh receipts'}</button>
    </>}
    {editing && <form key={editing.event_id} onSubmit={save}><div className="vat-form-grid">
      <label><span>{ar ? 'مبلغ القبض' : 'Receipt amount'}</span><input name="amount" type="number" min="0.01" step="0.01" required defaultValue={editing.amount} /></label>
      <label><span>{ar ? 'تاريخ القبض' : 'Receipt date'}</span><input name="date" type="date" required defaultValue={editing.date} /></label>
      <label><span>{ar ? 'حساب القبض' : 'Receipt account'}</span><select name="account_id" required defaultValue={editing.account_id}>
        {!accounts.some((account) => account.id === editing.account_id && account.currency === editing.currency) && <option value="">{ar ? 'اختر حسابًا نشطًا' : 'Choose an active account'}</option>}
        {accounts.filter((account) => account.currency === editing.currency).map((account) => <option key={account.id} value={account.id}>{account.name} ({account.currency})</option>)}
      </select></label>
    </div><div className="vat-form-actions"><button type="button" className="vat-button secondary" disabled={saving} onClick={() => setEditing(null)}>{ar ? 'إلغاء' : 'Cancel'}</button><button className="vat-button primary" disabled={saving}>{saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ تعديل السند' : 'Save receipt changes')}</button></div></form>}
    <p className="vat-einvoice-help">{ar ? 'السند المرحّل لا يُعدّل مباشرة؛ تصحيحه يتم بعكسه ثم تسجيل سند صحيح للحفاظ على الرصيد وسجل المراجعة.' : 'Posted receipts are corrected through reversal and a replacement receipt to preserve balances and the audit trail.'}</p>
  </section>;
}
