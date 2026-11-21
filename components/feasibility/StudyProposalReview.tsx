'use client';

import { useEffect, useState } from 'react';
import { evaluateStudy, type FeasibilityStudy } from '@/lib/feasibility/engine';
import { evaluateWater } from '@/lib/feasibility/water-model';
import { cloudDraftWrite } from '@/lib/feasibility/draft-schema';
import { sharedStudyFields, type SharedStudyField } from '@/lib/feasibility/sharing-permissions';
import { proposalStateLabel, type ProposalResolution, type ProposalState } from '@/lib/feasibility/share-proposals';

type Change = {
  field: SharedStudyField | 'title' | 'notes';
  before: string | number | null;
  after: string | number;
  current: string | number | null;
  submission_reason: string | null;
  decision_reason: string | null;
  conflict: boolean;
  can_apply: boolean;
  resolution: ProposalResolution | null;
  path: [string] | ['water', 'ops', string];
};
type Review = {
  state: ProposalState;
  reason: string | null;
  recipient_name: string;
  submitter_name: string | null;
  submitted_at: string;
  source_title: string;
  revision: number;
  can_approve: boolean;
  changes: Change[];
  current: unknown;
};

function metrics(study: FeasibilityStudy) {
  const result = study.water ? evaluateWater(study.water) : evaluateStudy(study);
  return result.ready ? result : null;
}

export default function StudyProposalReview({ locale, organization, project, proposal }: {
  locale: string; organization: string; project: string; proposal: string;
}) {
  const ar = locale === 'ar';
  const [review, setReview] = useState<Review>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [reasons, setReasons] = useState<Record<string,string>>({});
  const [choices, setChoices] = useState<Record<string, ProposalResolution>>({});

  useEffect(() => {
    const stop = new AbortController();
    const query = new URLSearchParams({ action: 'review', organization, project, proposal });
    fetch('/api/feasibility/share-proposals?' + query, { cache: 'no-store', signal: stop.signal })
      .then(async response => {
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!stop.signal.aborted) setReview(data);
      }).catch(() => {
        if (!stop.signal.aborted) setError(ar ? 'تعذر فتح طلب المراجعة.' : 'The review could not be opened.');
      });
    return () => stop.abort();
  }, [ar, organization, project, proposal, reload]);

  async function decide(action: 'approve' | 'reject') {
    if (!review || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/feasibility/share-proposals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, organization, project, proposal,
          revision: review.revision, resolutions: choices, reasons }),
      });
      if (response.status === 409) {
        setChoices({});
        setReasons({});
        setReload(value => value + 1);
        setError(ar ? 'تغيّرت الدراسة أو الصلاحيات. راجع القيم المحدثة قبل اتخاذ القرار.' : 'The study or permissions changed. Review the refreshed values before deciding.');
        return;
      }
      if (!response.ok) {
        const code = (await response.json()).error;
        setError(code === 'FEASIBILITY_PROPOSAL_NO_CHANGES'
          ? (ar ? 'لا توجد قيمة مختلفة لاعتمادها.' : 'There are no different values to approve.')
          : (ar ? 'تعذر حفظ القرار.' : 'The decision could not be saved.'));
        return;
      }
      setChoices({});
        setReasons({});
      setReload(value => value + 1);
      setReview(undefined);
    } catch {
      setError(ar ? 'تعذر حفظ القرار.' : 'The decision could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const label = (field: Change['field']) => field === 'title' ? (ar ? 'اسم الدراسة' : 'Study title')
    : field === 'notes' ? (ar ? 'الملاحظات' : 'Notes') : sharedStudyFields[field]?.[ar ? 0 : 1] ?? field;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 12 });
  const value = (input: Change['before']) => typeof input === 'number' && Number.isFinite(input) ? number.format(input) : input ?? '—';
  const parsed = cloudDraftWrite.safeParse({ study: review?.current });
  const current = parsed.success ? parsed.data.study : undefined;
  const preview = current ? structuredClone(current) : undefined;
  for (const change of review?.changes ?? []) {
    if (!preview || !change.can_apply || choices[change.field] !== 'proposed') continue;
    if (change.path.length === 3 && preview.water)
      Object.assign(preview.water.ops, { [change.path[2]]: change.after });
    else Object.assign(preview, { [change.field]: change.after });
  }
  const before = current && metrics(current);
  const after = preview && metrics(preview);
  const incomplete = review?.changes.some(change => !choices[change.field] || !reasons[change.field]?.trim());
  const approving = Object.values(choices).includes('proposed');

  return <main className="container fs-page" dir={ar ? 'rtl' : 'ltr'}>
    <header className="fs-head"><h1>{ar ? 'مراجعة تعديلات الدراسة المشتركة' : 'Review shared study changes'}</h1></header>
    {error && <p role="alert">{error}</p>}
    {!review && !error && <p role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>}
    {review && <section className="card fs-panel">
      <h2>{review.source_title}</h2>
      <p>{review.recipient_name}{review.submitter_name && ' · ' + review.submitter_name}{' · '}
        <time dateTime={review.submitted_at}>{new Date(review.submitted_at).toLocaleString(locale)}</time></p>
      <p role="status">{proposalStateLabel(review.state, ar)}</p>
      {review.reason && <p>{review.reason}</p>}
      <div className="fs-table-wrap"><table className="fs-table">
        <caption>{ar ? 'الحقول التي غيّرتها المؤسسة' : 'Fields changed by the organization'}</caption>
        <thead><tr><th>{ar ? 'الحقل' : 'Field'}</th><th>{ar ? 'عند المشاركة' : 'At sharing'}</th>
          <th>{ar ? 'قيمة الأصل عند المراجعة' : 'Source at review'}</th><th>{ar ? 'المقترح' : 'Proposed'}</th>
          <th>{ar ? 'سبب الاقتراح' : 'Proposal reason'}</th><th>{ar ? 'القرار وسببه' : 'Decision and reason'}</th></tr></thead>
        <tbody>{review.changes.map(change => <tr key={change.field}>
          <th>{label(change.field)}</th><td>{value(change.before)}</td><td>{value(change.current)}</td><td>{value(change.after)}</td>
          <td>{change.submission_reason ?? '—'}</td>
          {review.state === 'pending' && <td><select
            aria-label={(ar ? 'القيمة المعتمدة لحقل ' : 'Resolve field ') + label(change.field)} value={choices[change.field] ?? ''}
            onChange={event => {
              const next = event.currentTarget.value;
              setChoices(previous => {
                const updated = { ...previous };
                if (next === 'current' || next === 'proposed') updated[change.field] = next;
                else delete updated[change.field];
                return updated;
              });
            }}>
            <option value="">{ar ? 'اختر القيمة' : 'Choose a value'}</option>
            <option value="current">{ar ? 'الإبقاء على الأصل' : 'Keep source value'}</option>
            {review.can_approve && change.can_apply && <option value="proposed">{ar ? 'اعتماد المقترح' : 'Use proposed value'}</option>}
          </select><textarea aria-label={(ar ? 'سبب القرار بشأن ' : 'Decision reason for ') + label(change.field)} maxLength={2000} value={reasons[change.field] ?? ''} onChange={e => setReasons({...reasons,[change.field]:e.target.value})}/></td>}
          {review.state !== 'pending' && <td>{review.state === 'rejected' || change.resolution === 'current' ? (ar ? 'مرفوض' : 'Declined') : (ar ? 'مقبول' : 'Accepted')} · {change.decision_reason ?? '—'}</td>}
        </tr>)}</tbody>
      </table></div>
      {review.state === 'pending' && current && (before || after) && <div className="fs-table-wrap"><table className="fs-table">
        <caption>{ar ? 'أثر التعديلات على النموذج المالي الأساسي' : 'Impact on the base financial model'}</caption>
        <thead><tr><th>{ar ? 'المؤشر' : 'Metric'}</th><th>{ar ? 'الأصل الحالي' : 'Current source'}</th><th>{ar ? 'بعد التعديلات المحددة' : 'With selected changes'}</th></tr></thead>
        <tbody>
          <tr><th>NPV {current.currency}</th><td>{value(before?.npv ?? null)}</td><td>{value(after?.npv ?? null)}</td></tr>
          <tr><th>IRR %</th><td>{value(before?.irr ?? null)}</td><td>{value(after?.irr ?? null)}</td></tr>
          {(before?.flows ?? after?.flows)?.map((_, index) => <tr key={index}>
            <th>{ar ? 'التدفق النقدي للسنة' : 'Cash flow in year'} {index}</th>
            <td>{value(before?.flows[index] ?? null)}</td><td>{value(after?.flows[index] ?? null)}</td>
          </tr>)}
        </tbody>
      </table></div>}
      {review.state === 'pending' && <>
        {!review.can_approve && <p>{ar ? 'القبول غير متاح بموجب صلاحيات المشاركة الحالية.' : 'Approval is unavailable under the current sharing permissions.'}</p>}
        <button className="fs-btn" type="button" disabled={busy || incomplete || (approving && !review.can_approve)}
          onClick={() => void decide(approving ? 'approve' : 'reject')}>{ar ? 'حفظ قرارات البنود' : 'Save item decisions'}</button>
      </>}
    </section>}
  </main>;
}
