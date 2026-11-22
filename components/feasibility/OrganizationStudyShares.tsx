'use client';

import { useEffect, useState } from 'react';
import {InvitationDocuments} from './InvitationDocuments';
import Link from 'next/link';
import {RoyalIcon} from './RoyalIcon';
import CompanyStudyInvitations from './CompanyStudyInvitations';
import { CompanyDirectorySearch } from './CompanyInvitationDirectory';
import { shareAccessSchema, sharingModeSchema, shareAuditEventsSchema, shareAuditEventLabels, type ShareAuditEvent } from '@/lib/feasibility/sharing-permissions';
import { proposalReviewHref, proposalStateLabel, type ProposalState } from '@/lib/feasibility/share-proposals';

type Share = { recipient_organization_id: string; source_revision: number; expires_at: string; revoked_at: string | null; access_mode?: 'read' | 'edit' };
type Proposal = { id: string; state: ProposalState; submitted_at: string; recipient_name: string };

export default function OrganizationStudyShares({ locale, organization, project, revision, saved, audit = false }: {
  locale: string; organization: string; project: string; revision: number; saved: boolean; audit?: boolean;
}) {
  const ar = locale === 'ar';
  const invitations = process.env.NEXT_PUBLIC_FEASIBILITY_COMPANY_INVITATIONS === 'true';
  const [mode, setMode] = useState<'disabled' | 'read' | 'edit'>();
  const [access, setAccess] = useState<'read' | 'edit'>('read');
  const [documentMode,setDocumentMode]=useState('none');
  const [documents,setDocuments]=useState<string[]>([]);
  const [shares, setShares] = useState<Share[]>();
  const [recipient, setRecipient] = useState('');
  useEffect(()=>{setDocumentMode('none');setDocuments([]);setAccess('read')},[organization,project,recipient]);
  const [days, setDays] = useState('30');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [proposals, setProposals] = useState<Proposal[]>();
  const [activity, setActivity] = useState<ShareAuditEvent[]>();
  const [activityError, setActivityError] = useState(false);
  const [proposalError, setProposalError] = useState(false);

  function message(code: string) {
    if (code === 'FEASIBILITY_SHARING_DISABLED') return ar ? 'أوقفت إدارة المنصة المشاركة.' : 'Sharing is turned off by the platform.';
    if (code === 'FEASIBILITY_SHARE_EDIT_FORBIDDEN') return ar
      ? 'التعديل يتطلب سماح إدارة المنصة واشتراك المؤسسة المستلمة.' : 'Editing requires platform permission and an active recipient subscription.';
    if (code === 'FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS') return ar
      ? 'وصول المؤسسة غير المشتركة ينتهي خلال 30 يومًا من المشاركة الأولى. اختر مدة ضمن الفترة المتبقية.'
      : 'An unsubscribed organization has at most 30 days from the first share. Choose a duration within the remaining period.';
    if (code === 'FEASIBILITY_INVITATION_RECEPTION_DISABLED' || code === 'FEASIBILITY_INVITATION_PILOT_RESTRICTED') return ar
      ? 'هذه الدعوة غير متاحة وفق إعدادات الاستقبال ونطاق المشاركة.' : 'This invitation is unavailable under the current reception and sharing settings.';
    if (code === 'FEASIBILITY_COMPANY_INVITATION_PENDING') return ar
      ? 'اسحب الدعوة المعلقة قبل إرسال دعوة بشروط جديدة.' : 'Withdraw the pending invitation before sending new terms.';
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

  useEffect(() => {
    if (!audit) return;
    const controller = new AbortController();
    const params = new URLSearchParams({action:'audit', organization, project});
    setActivity(undefined);
    setActivityError(false);
    fetch('/api/feasibility/organization-shares?' + params, {
      cache:'no-store', signal:controller.signal,
    }).then(async response => {
      if (!response.ok) throw Error('AUDIT_UNAVAILABLE');
      const rows = shareAuditEventsSchema.parse(await response.json());
      if (!controller.signal.aborted) setActivity(rows);
    }).catch(() => { if (!controller.signal.aborted) setActivityError(true); });
    return () => controller.abort();
  }, [audit, organization, project, reload]);

  async function submit(action: 'share' | 'revoke', id: string) {
    setBusy(true);
    setError('');
    try {
      const issue = invitations && action === 'share';
      const response = await fetch(issue ? '/api/feasibility/company-invitations' : '/api/feasibility/organization-shares', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: issue ? 'issue' : action, organization, project, recipient: id,
          ...(issue && {documentMode,documents:documentMode==='selected'?documents:[]}),
          ...(action === 'share' ? { revision, days: Number(days), access } : {}) }),
      });
      if (!response.ok) throw Error((await response.json()).error);
      if (action === 'share') setRecipient('');
      setReload(value => value + 1);
    } catch (e) {
      setError(message(e instanceof Error ? e.message : ''));
    } finally { setBusy(false); }
  }

  const notExpired=(share:Share)=>!share.revoked_at&&Date.parse(share.expires_at)>Date.now();
  return <section className="card fs-panel fs-handoff fs-royal-organization-sharing">
    <h3>{audit ? (ar ? 'صلاحيات المؤسسات وقرارات المراجعة' : 'Organization permissions and review decisions') : (ar ? 'مشاركة الدراسة مع مؤسسة' : 'Share with an organization')}</h3>
    <p>{invitations ? (ar ? 'تصل الدعوة داخل يقين، ويبدأ الوصول عند قبول مسؤول في المؤسسة المستلمة.'
      : 'The invitation is delivered inside Yaqeen. Access begins when a recipient administrator accepts.') : ar ? 'تُشارك نسخة من الدراسة المحفوظة. للمؤسسة غير المشتركة صلاحية قراءة لمدة تصل إلى 30 يومًا من أول مشاركة.'
      : 'Share a copy of the saved study. Unsubscribed organizations can view it for up to 30 days from the first share.'}</p>
    {!audit && <form className="fs-form-grid" onSubmit={event => { event.preventDefault(); void submit('share', recipient.trim()); }}>
      {invitations && <CompanyDirectorySearch ar={ar} organization={organization} onChoose={setRecipient}/>}
      <label className="fs-field">{ar ? 'معرّف المؤسسة المستلمة' : 'Receiving organization ID'}
        <input dir="ltr" value={recipient} onChange={event => setRecipient(event.target.value)} required /></label>
      <label className="fs-field">{ar ? 'مدة الوصول بالأيام' : 'Access duration in days'}
        <input type="number" min={1} step={1} value={days} onChange={event => setDays(event.target.value)} required /></label>
      {(mode === 'read' || mode === 'edit') && <label className="fs-field">{ar ? 'صلاحية المؤسسة المستلمة' : 'Recipient permission'}
        <select value={access} onChange={event => setAccess(shareAccessSchema.parse(event.target.value))}>
          <option value="read">{ar ? 'قراءة فقط' : 'Read only'}</option>
          {mode === 'edit' && <option value="edit">{ar ? 'قراءة وتعديل' : 'Read and edit'}</option>}
        </select>
      </label>}
      {invitations && <label className="fs-field">{ar?'المستندات المشمولة':'Documents to share'}
        <select value={documentMode} onChange={e=>setDocumentMode(e.target.value)}>
          <option value="none">{ar?'بدون مستندات':'Without documents'}</option>
          <option value="all">{ar?'جميع مستندات الإصدار الحالي':'All documents in this revision'}</option>
          <option value="selected">{ar?'تحديد مستندات':'Select documents'}</option>
        </select></label>}
      {invitations && documentMode==='selected' && <InvitationDocuments ar={ar} project={project} organization={organization} selected={documents} onSelect={setDocuments}/>}
      <div><button className="fs-btn" disabled={(invitations && documentMode==='selected' && !documents.length) || busy || !saved || !mode || mode === 'disabled'}>{invitations ? (ar ? 'إرسال دعوة' : 'Send invitation') : (ar ? 'مشاركة النسخة' : 'Share revision')}</button></div>
    </form>}
    {mode === 'disabled' && <p>{ar ? 'المشاركة غير متاحة حاليًا.' : 'Sharing is currently unavailable.'}</p>}
    {!saved && <p>{ar ? 'احفظ الدراسة لتتمكن من مشاركة الإصدار الحالي.' : 'Save the study to share its current revision.'}</p>}
    {error && <p role="alert">{error}</p>}
    {invitations && !audit && <CompanyStudyInvitations locale={locale} organization={organization} project={project} reload={reload}/>}
    <section className="card fs-panel">
    <h3 className="fs-royal-report-title"><RoyalIcon name="users"/>{ar?'سجل النسخ المشتركة':'Shared revision register'}</h3>
    {shares===undefined&&!error&&<p role="status">{ar?'جارٍ تحميل المشاركات…':'Loading shares…'}</p>}
    {shares?.length===0&&<p>{ar?'لا توجد نسخ مشتركة.':'No revisions have been shared.'}</p>}
    {!!shares?.length&&<div className="fs-table-wrap"><table className="fs-table fs-royal-access-table">
     <thead><tr>{(ar?['المؤسسة المستلمة','الإصدار','الصلاحية الممنوحة','تاريخ الانتهاء','الحالة','إجراء']:
      ['Recipient organization','Revision','Granted permission','Expires','Status','Action'])
      .map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
     <tbody>{shares.map(share=><tr key={share.recipient_organization_id}>
      <th scope="row"><bdi>{share.recipient_organization_id}</bdi></th>
      <td>{share.source_revision}</td>
      <td>{share.access_mode==='edit'?(ar?'قراءة وتعديل':'Read and edit'):(ar?'قراءة فقط':'Read only')}</td>
      <td><time dateTime={share.expires_at}>{new Date(share.expires_at).toLocaleString(locale)}</time></td>
      <td>{share.revoked_at?(ar?'ملغاة':'Revoked'):notExpired(share)?(ar?'سارية':'Current'):(ar?'منتهية':'Expired')}</td>
      <td>{!share.revoked_at&&<button type="button" className="fs-btn fs-btn--secondary"
       disabled={busy} onClick={()=>void submit('revoke',share.recipient_organization_id)}>
        {ar?'إلغاء الوصول':'Revoke access'}</button>}</td>
     </tr>)}</tbody>
    </table></div>}
    <p className="fs-hint">{ar?'يحدد وضع المنصة واشتراك المؤسسة الصلاحية الفعلية عند الوصول إلى الدراسة.':
     'Platform policy and the recipient subscription determine effective access when the study is opened.'}</p>
    </section>
    {audit&&<section className="card fs-panel">
      <h3 className="fs-royal-report-title"><RoyalIcon name="clipboard"/>{ar?'سجل نشاط المشاركة':'Sharing activity'}</h3>
      <p className="fs-hint">{ar?'يعرض آخر 100 نشاط مسجل لهذه الدراسة.':'Shows the latest 100 activities recorded for this study.'}</p>
      {activityError?<p role="alert">{ar?'تعذر تحميل سجل نشاط المشاركة.':'Sharing activity could not be loaded.'}</p>:
       activity===undefined?<p role="status">{ar?'جارٍ تحميل سجل النشاط…':'Loading sharing activity…'}</p>:
       activity.length===0?<p>{ar?'لا يوجد نشاط مسجل لهذه الدراسة.':'There is no activity recorded for this study.'}</p>:
       <div className="fs-table-wrap"><table className="fs-table fs-royal-share-audit">
         <thead><tr>{(ar?['النشاط','التاريخ والوقت','المؤسسة المستلمة','الإصدار','طلب التعديل']:
          ['Activity','Date and time','Recipient organization','Revision','Change request'])
          .map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
         <tbody>{activity.map(event=><tr key={event.id}>
           <th scope="row">{shareAuditEventLabels[event.kind][ar?0:1]}</th>
           <td><time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString(locale)}</time></td>
           <td><bdi>{event.recipient_organization_id??'—'}</bdi></td>
           <td>{event.approved_revision!==null?(ar?'معتمد · ':'Approved · ')+event.approved_revision:
            event.shared_revision!==null?(ar?'مشترك · ':'Shared · ')+event.shared_revision:
            event.source_revision!==null?(ar?'المصدر · ':'Source · ')+event.source_revision:'—'}</td>
           <td>{event.proposal_id?<Link href={proposalReviewHref(locale,organization,project,event.proposal_id)}>
            {ar?'عرض الطلب':'View request'}</Link>:'—'}</td>
         </tr>)}</tbody>
       </table></div>}
    </section>}
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
