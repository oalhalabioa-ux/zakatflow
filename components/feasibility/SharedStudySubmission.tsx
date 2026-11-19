'use client';

import { useEffect, useState } from 'react';
import { proposalStateLabel, type ProposalState } from '@/lib/feasibility/share-proposals';

type Status = { can_submit: boolean; state: ProposalState | null; reason: string | null; needs_new_share: boolean };

export default function SharedStudySubmission({ ar, organization, project, revision }: {
  ar: boolean; organization: string; project: string; revision: number;
}) {
  const [status, setStatus] = useState<Status>();
  const [reload, setReload] = useState(0);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const stop = new AbortController();
    const query = new URLSearchParams({ action: 'recipient', organization, project });
    const refresh = () => fetch('/api/feasibility/share-proposals?' + query, { cache: 'no-store', signal: stop.signal })
      .then(async response => {
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!stop.signal.aborted) setStatus(data);
      }).catch(() => { if (!stop.signal.aborted) setStatus(undefined); });
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { stop.abort(); window.clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [organization, project, revision, reload]);

  async function submit() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch('/api/feasibility/share-proposals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', organization, project, revision }),
      });
      if (!response.ok) throw Error();
      setStatus({ can_submit: false, state: 'pending', reason: null, needs_new_share: false });
      setSent(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      setReload(value => value + 1);
    }
  }

  return <>
    {status?.can_submit && <button type="button" className="fs-btn" disabled={busy}
      onClick={() => void submit()}>{ar ? 'إرسال التعديلات للمراجعة' : 'Send changes for review'}</button>}
    {sent && <p role="status">{ar ? 'أُرسلت التعديلات إلى مالك الدراسة.' : 'The changes were sent to the study owner.'}</p>}
    {status?.state && <p>{ar ? 'حالة آخر طلب' : 'Latest request'} · {proposalStateLabel(status.state, ar)}
      {status.reason && ' · ' + status.reason}</p>}
    {status?.needs_new_share && <p>{ar ? 'اطلب من المالك مشاركة الإصدار الحالي لإرسال تعديلات على هذه الدراسة.'
      : 'Ask the owner to share the current revision before sending changes to this study.'}</p>}
    {error && <p role="alert">{ar ? 'تعذر إرسال التعديلات. تحقّق من حالة الطلب الحالي.'
      : 'The changes could not be sent. Check the current request status.'}</p>}
  </>;
}
