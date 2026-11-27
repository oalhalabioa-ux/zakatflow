'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

const endpoint = '/api/personal-income/receivable-terms';
const ratings = {
  EXCELLENT: ['ممتاز', 'Excellent'],
  GOOD: ['جيد', 'Good'],
  BAD: ['سيئ', 'Bad'],
} as const;

type TermsEvent = {
  id: number;
  due_date: string;
  classification: keyof typeof ratings;
  effective_date: string;
  recorded_at: string;
};

export default function PersonalIncomeReceivableTerms({ documentId, documentDate, today, ar }: {
  documentId: string; documentDate: string; today: string; ar: boolean;
}) {
  const t = (arabic: string, english: string) => ar ? arabic : english;
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<TermsEvent[] | null>(null);
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  const current = events?.find(event => event.effective_date <= today);

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setLoadError(false);
    fetch(endpoint + '?' + new URLSearchParams({ document: documentId }), {
      signal: controller.signal, cache: 'no-store',
    }).then(async response => {
      if (!response.ok) throw new Error();
      const result: { events: TermsEvent[] } = await response.json();
      if (!controller.signal.aborted) setEvents(result.events);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError(true);
    });
    return () => controller.abort();
  }, [documentId, expanded, reload]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const input = {
      documentId,
      dueDate: form.get('dueDate'),
      classification: form.get('classification'),
      effectiveDate: form.get('effectiveDate'),
    };
    const key = JSON.stringify(input);
    if (pending.current?.key !== key) pending.current = { key, requestId: crypto.randomUUID() };
    setSaving(true);
    setStatus('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, requestId: pending.current.requestId }),
      });
      if (!response.ok) {
        const { error } = await response.json();
        setStatus(error === 'INVALID_TERMS'
          ? t('راجع التصنيف والتواريخ. يجب أن يكون تاريخا الاستحقاق والنفاذ في تاريخ المستند أو بعده.', 'Check the classification and dates. The due and effective dates must be on or after the document date.')
          : t('تعذّر تأكيد الحفظ. أعد المحاولة بالبيانات نفسها.', 'Save could not be confirmed. Retry with the same details.'));
        return;
      }
      pending.current = null;
      setStatus(t('تم حفظ شروط الذمة.', 'Receivable terms saved.'));
      setEvents(null);
      setReload(count => count + 1);
    } catch {
      setStatus(t('تعذّر تأكيد الحفظ. أعد المحاولة بالبيانات نفسها.', 'Save could not be confirmed. Retry with the same details.'));
    } finally {
      setSaving(false);
    }
  }

  return <section>
    <button type="button" aria-expanded={expanded} disabled={saving} onClick={() => setExpanded(open => !open)}>
      {t('الاستحقاق وتصنيف الذمة', 'Receivable due date and classification')}
    </button>
    {expanded && <>
      {loadError && <p role="alert">{t('تعذّر تحميل شروط الذمة.', 'Unable to load receivable terms.')} <button type="button" onClick={() => setReload(count => count + 1)}>{t('إعادة المحاولة', 'Retry')}</button></p>}
      {!events && !loadError && <p role="status">{t('جارٍ تحميل شروط الذمة…', 'Loading receivable terms…')}</p>}
      {status && <p role="status">{status}</p>}
      {events && !loadError && <>
        <form onSubmit={save}>
          <fieldset disabled={saving} className="vat-form-grid">
            <label>{t('تاريخ الاستحقاق', 'Due date')}<input name="dueDate" type="date" min={documentDate} defaultValue={current?.due_date} required /></label>
            <label>{t('التصنيف', 'Classification')}<select name="classification" defaultValue={current?.classification ?? ''} required>
              <option value="">{t('اختر تصنيفًا', 'Choose a classification')}</option>
              {Object.entries(ratings).map(([value, names]) => <option key={value} value={value}>{names[ar ? 0 : 1]}</option>)}
            </select></label>
            <label>{t('تاريخ نفاذ التصنيف', 'Effective date')}<input name="effectiveDate" type="date" min={documentDate} defaultValue={today} required /></label>
            <button className="vat-button" type="submit">{t('حفظ شروط الذمة', 'Save receivable terms')}</button>
          </fieldset>
        </form>
        {events.length > 0 && <table>
          <caption>{t('سجل شروط الذمة', 'Receivable terms history')}</caption>
          <thead><tr>
            <th scope="col">{t('تاريخ النفاذ', 'Effective date')}</th>
            <th scope="col">{t('الاستحقاق', 'Due date')}</th>
            <th scope="col">{t('التصنيف', 'Classification')}</th>
            <th scope="col">{t('وقت التسجيل', 'Recorded at')}</th>
          </tr></thead>
          <tbody>{events.map(event => <tr key={event.id} aria-current={current?.id === event.id ? 'true' : undefined}>
            <td>{event.effective_date}</td><td>{event.due_date}</td>
            <td>{ratings[event.classification][ar ? 0 : 1]}</td>
            <td>{new Date(event.recorded_at).toLocaleString(ar ? 'ar-SA-u-ca-gregory' : 'en-GB', { timeZone: 'Asia/Riyadh' })}</td>
          </tr>)}</tbody>
        </table>}
      </>}
    </>}
  </section>;
}
