'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { shareAccessSchema, sharingModeSchema } from '@/lib/feasibility/sharing-permissions';
import { proposalReviewHref, proposalStateLabel, type ProposalState } from '@/lib/feasibility/share-proposals';

type Share = { recipient_organization_id: string; source_revision: number; expires_at: string; revoked_at: string | null; access_mode?: 'read' | 'edit' };
type Proposal = { id: string; state: ProposalState; submitted_at: string; recipient_name: string };

export default function OrganizationStudyShares({ locale, organization, project, revision, saved, audit = false }: {
  locale: string; organization: string; project: string; revision: number; saved: boolean; audit?: boolean;
}) {
  const ar = locale === 'ar';
  const [mode, setMode] = useState<'disabled' | 'read' | 'edit'>('disabled');
  const [access, setAccess] = useState<'read' | 'edit'>('read');
  const [shares, setShares] = useState<Share[]>([]);
  const [recipient, setRecipient] = useState('');
  const [days, setDays] = useState('30');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [proposals, setProposals] = useState<Proposal[]>();
  const [proposalError, setProposalError] = useState(false);

  function message(code: string) {
    if (code === 'FEASIBILITY_SHARING_DISABLED') return ar ? 'أوقفت إدارة المنصة المشاركة.' : 'Sharing is turned off by the platform.';
    if (code === 'FEASIBILITY_SHARE_EDIT_FORBIDDEN') return ar
      ? 'التعديل يتطلب سماح إدارة المنصة واشتراك المؤسسة المستلمة.' : 'Editing requires platform permission and an active recipient subscription.';
    if (code === 'FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS') return ar
      ? 'وصول المؤسسة غير المشتركة ينتهي خلال 30 يومًا من المشاركة الأولى. اختر مدة ضمن الفترة المتبقية.'
      : 'An unsubscribed organization has at most 30 days from the first share. Choose a duration within the remaining period.';
    if (code === 'FEASIBILITY_STALE_SHARE_REVISION') return ar
      ? 'تغيرت نسخة الدراسة. أعد تحميلها واحفظها قبل المشاركة.' : 'The study revision changed. Reload and save it before sharing.';
    return ar ? 'تعذر إتمام المشاركة. تحقق من معرّف المؤسسة وصلاحياتك.' : 'Sharing could not be completed. Check the organization ID and your permissions.';
  }

  useEffect(() => {
    const controller = new AbortController();
    const read = async (action: 'outbox' | 'policy') => {
      const response = await fetch('/api/feasibility/organization-shares?' + new URLSearchParams({ action, organization, project }),
        { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw Error();
      return response.json();
    };
    Promise.all([read('outbox'), read('policy')])
      .then(([data, policy]) => {
        if (controller.signal.aborted) return;
        if (Array.isArray(data)) setShares(data);
        const next = sharingModeSchema.parse(policy);
        setMode(next);
        if (next !== 'edit') setAccess('read');
      })
      .catch(() => { if (!controller.signal.aborted) setError(ar ? 'تعذر تحميل المشاركات.' : 'Could not load shares.'); });
    return () => controller.abort();
  }, [ar, organization, project, reload]);

  useEffect(() => {
    const stop = new AbortController();
    const query = new URLSearchParams({ action: 'list', organization, project });
    const refresh = () => fetch('/api/feasibility/share-proposals?' + query, { cache: 'no-store', signal: stop.signal })
      .then(async response => {
        if (!response.ok) throw Error();
        const rows = await response.json();
        if (!stop.signal.aborted) {
          setProposalError(false);
          setProposals(rows);
        }
      }).catch(() => { if (!stop.signal.aborted) setProposalError(true); });
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { stop.abort(); window.removeEventListener('focus', refresh); };
  }, [organization, project]);

  async function submit(action: 'share' | 'revoke', id: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/feasibility/organization-shares', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, organization, project, recipient: id,
          ...(action === 'share' ? { revision, days: Number(days), access } : {}) }),
      });
      if (!response.ok) throw Error((await response.json()).error);
      if (action === 'share') setRecipient('');
      setReload(value => value + 1);
    } catch (e) {
      setError(message(e instanceof Error ? e.message : ''));
    } finally { setBusy(false); }
  }

  return <section className="card fs-panel fs-handoff">
    <h3>{audit ? (ar ? 'صلاحيات المؤسسات وقرارات المراجعة' : 'Organization permissions and review decisions') : (ar ? 'مشاركة الدراسة مع مؤسسة' : 'Share with an organization')}</h3>
    <p>{ar ? 'تُشارك نسخة من الدراسة المحفوظة. للمؤسسة غير المشتركة صلاحية قراءة لمدة تصل إلى 30 يومًا من أول مشاركة.'
      : 'Share a copy of the saved study. Unsubscribed organizations can view it for up to 30 days from the first share.'}</p>
    {!audit && <form className="fs-form-grid" onSubmit={event => { event.preventDefault(); void submit('share', recipient.trim()); }}>
      <label className="fs-field">{ar ? 'معرّف المؤسسة المستلمة' : 'Receiving organization ID'}
        <input dir="ltr" value={recipient} onChange={event => setRecipient(event.target.value)} required /></label>
      <label className="fs-field">{ar ? 'مدة الوصول بالأيام' : 'Access duration in days'}
        <input type="number" min={1} step={1} value={days} onChange={event => setDays(event.target.value)} required /></label>
      {mode !== 'disabled' && <label className="fs-field">{ar ? 'صلاحية المؤسسة المستلمة' : 'Recipient permission'}
        <select value={access} onChange={event => setAccess(shareAccessSchema.parse(event.target.value))}>
          <option value="read">{ar ? 'قراءة فقط' : 'Read only'}</option>
          {mode === 'edit' && <option value="edit">{ar ? 'قراءة وتعديل' : 'Read and edit'}</option>}
        </select>
      </label>}
      <div><button className="fs-btn" disabled={busy || !saved || mode === 'disabled'}>{ar ? 'مشاركة النسخة' : 'Share revision'}</button></div>
    </form>}
    {mode === 'disabled' && <p>{ar ? 'المشاركة غير متاحة حاليًا.' : 'Sharing is currently unavailable.'}</p>}
    {!saved && <p>{ar ? 'احفظ الدراسة لتتمكن من مشاركة الإصدار الحالي.' : 'Save the study to share its current revision.'}</p>}
    {error && <p role="alert">{error}</p>}
    {shares.map(share => <div className="fs-row" key={share.recipient_organization_id}>
      <span dir="ltr">{share.recipient_organization_id}</span>
      <span>{ar ? 'النسخة' : 'Revision'} {share.source_revision}</span>
      {mode !== 'disabled' && <span>{share.access_mode === 'edit' && mode === 'edit'
        ? (ar ? 'قراءة وتعديل' : 'Read and edit') : (ar ? 'قراءة فقط' : 'Read only')}</span>}
      <time dateTime={share.expires_at}>{new Date(share.expires_at).toLocaleString(locale)}</time>
      {share.revoked_at ? <span>{ar ? 'ملغاة' : 'Revoked'}</span> : <button type="button" className="fs-btn fs-btn--secondary"
        disabled={busy} onClick={() => void submit('revoke', share.recipient_organization_id)}>
        {ar ? 'إلغاء الوصول' : 'Revoke access'}
      </button>}
    </div>)}
    <h3>{ar ? 'طلبات تعديل الدراسة' : 'Study change requests'}</h3>
    {proposalError && <p role="alert">{ar ? 'تعذر تحميل طلبات التعديل.' : 'Change requests could not be loaded.'}</p>}
    {proposals?.length === 0 && <p>{ar ? 'لا توجد طلبات تعديل.' : 'There are no change requests.'}</p>}
    {proposals?.map(proposal => <div className="fs-row" key={proposal.id}>
      <strong>{proposal.recipient_name}</strong>
      <span>{proposalStateLabel(proposal.state, ar)}</span>
      <time dateTime={proposal.submitted_at}>{new Date(proposal.submitted_at).toLocaleString(locale)}</time>
      <Link href={proposalReviewHref(locale, organization, project, proposal.id)}>
        {ar ? 'عرض التعديلات' : 'View changes'}
      </Link>
    </div>)}
  </section>;
}
