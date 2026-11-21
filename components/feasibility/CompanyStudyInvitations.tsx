'use client';

import { useEffect, useState } from 'react';

const endpoint = '/api/feasibility/company-invitations';
type State = 'pending' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'revoked';
type Invitation = {
  id: string;
  state: State;
  source_name?: string;
  recipient_name?: string;
  access_mode: 'read' | 'edit';
  days: number;
  expires_at: string;
};
type Action = 'accept' | 'decline' | 'withdraw' | 'revoke';

const names: Record<State, [string, string]> = {
  pending: ['بانتظار الرد', 'Awaiting response'],
  accepted: ['مقبولة', 'Accepted'],
  declined: ['مرفوضة', 'Declined'],
  withdrawn: ['مسحوبة', 'Withdrawn'],
  expired: ['منتهية', 'Expired'],
  revoked: ['ألغي الوصول', 'Access revoked'],
};
const labels: Record<Action, [string, string]> = {
  accept: ['قبول', 'Accept'],
  decline: ['رفض', 'Decline'],
  withdraw: ['سحب الدعوة', 'Withdraw invitation'],
  revoke: ['إلغاء الوصول', 'Revoke access'],
};

export default function CompanyStudyInvitations({ locale, organization, project, reload = 0, onChanged }: {
  locale: string; organization: string; project?: string; reload?: number; onChanged?: () => void;
}) {
  const ar = locale === 'ar';
  const language = ar ? 0 : 1;
  const [rows, setRows] = useState<Invitation[]>();
  const [feedback, setFeedback] = useState<{ text: string; error: boolean }>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stop = new AbortController();
    const query = new URLSearchParams({ organization, action: project ? 'outbox' : 'inbox' });
    if (project) query.set('project', project);
    fetch(endpoint + '?' + query, { cache: 'no-store', signal: stop.signal })
      .then(async response => {
        if (response.status === 403) {
          if (!stop.signal.aborted) setRows(undefined);
          return;
        }
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!Array.isArray(data)) throw Error();
        if (!stop.signal.aborted) setRows(data);
      })
      .catch(() => {
        if (!stop.signal.aborted) setFeedback({ error: true, text: ar ? 'تعذر تحميل الدعوات.' : 'Could not load invitations.' });
      });
    return () => stop.abort();
  }, [ar, organization, project, refresh, reload]);

  async function decide(action: Action, invitation: string) {
    setBusy(true);
    setFeedback(undefined);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, invitation, organization }),
      });
      const result = await response.json();
      if (response.status === 409 && result.error === 'FEASIBILITY_COMPANY_INVITATION_RESOLVED') {
        setFeedback({ error: false, text: ar ? 'حُسمت هذه الدعوة بالفعل. تم طلب تحديث القائمة.'
          : 'This invitation was already decided. Refreshing the list.' });
        setRefresh(value => value + 1);
        onChanged?.();
        return;
      }
      if (!response.ok) throw Error(result.error);
      const state = result.state as State;
      setFeedback({ error: state === 'expired', text: names[state][language] });
      setRefresh(value => value + 1);
      onChanged?.();
    } catch (error) {
      const stale = error instanceof Error && error.message === 'FEASIBILITY_STALE_SHARE_REVISION';
      setFeedback({ error: true, text: stale
        ? (ar ? 'تغير إصدار الدراسة. اطلب من المؤسسة المرسلة إرسال دعوة جديدة.' : 'The study revision changed. Ask the sender for a new invitation.')
        : (ar ? 'تعذر إتمام الإجراء. حدّث قائمة الدعوات وحاول مجددًا.' : 'Could not complete the action. Refresh the invitations and try again.') });
      setRefresh(value => value + 1);
    } finally {
      setBusy(false);
    }
  }

  if (!rows && !feedback) return null;
  return <section className="card fs-panel">
    <h3>{project ? (ar ? 'الدعوات المرسلة' : 'Sent invitations') : (ar ? 'دعوات المؤسسات' : 'Company invitations')}</h3>
    {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    {rows?.length === 0 && <p>{ar ? 'لا توجد دعوات.' : 'No invitations.'}</p>}
    {rows?.map(row => {
      const actions: Action[] = row.state === 'pending' ? (project ? ['withdraw'] : ['accept', 'decline'])
        : row.state === 'accepted' && !project ? ['revoke'] : [];
      return <div className="fs-panel" key={row.id}>
        <strong><bdi>{row.source_name ?? row.recipient_name}</bdi></strong>
        <p>{names[row.state][language]} · {row.access_mode === 'edit'
          ? (ar ? 'قراءة وتعديل' : 'Read and edit') : (ar ? 'قراءة فقط' : 'Read only')}
          {' · '}{ar ? 'مدة الوصول بالأيام' : 'Access duration in days'} {row.days}</p>
        {row.state === 'pending' && <p>{ar ? 'مهلة قبول الدعوة' : 'Accept by'}{' '}
          <time dateTime={row.expires_at}>{new Date(row.expires_at).toLocaleString(locale)}</time></p>}
        <div className="fs-actions">{actions.map(action => <button type="button" key={action} disabled={busy}
          className={action === 'accept' ? 'fs-btn' : 'fs-btn fs-btn--secondary'}
          onClick={() => void decide(action, row.id)}>{labels[action][language]}</button>)}</div>
      </div>;
    })}
  </section>;
}
