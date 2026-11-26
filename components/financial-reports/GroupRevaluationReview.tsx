'use client';

import { useEffect, useRef, useState } from 'react';
import { financialSourceRowsCsv } from '../../lib/financial-budget-source';
import { groupRevaluationRows, type GroupRevaluationReview as Review } from '../../lib/financial-group-revaluation-export';
import type { listGroupV2Revaluations } from '../../services/financial-group-v2-revaluation';

type JournalList = Awaited<ReturnType<typeof listGroupV2Revaluations>>;
type Choice = JournalList['choices'][number];
const endpoint = '/api/financial-reporting/group-v2-revaluation?';
const choiceKey = (choice: Choice) => `${choice.organization}/${choice.journal}`;

export default function GroupRevaluationReview({ organization, from, to, en }: {
  organization: string; from: string; to: string; en: boolean;
}) {
  const t = (ar: string, english: string) => en ? english : ar;
  const [list, setList] = useState<JournalList | null>(null);
  const [selected, setSelected] = useState('');
  const [translate, setTranslate] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const query = { organization, from, to };
  const choice = list?.choices.find(item => choiceKey(item) === selected);
  const rows = review && choice ? groupRevaluationRows(review, choice.name, from, en) : null;

  async function read(params: Record<string, string>, accept: (data: unknown) => void) {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setError(false);
    setReview(null);
    try {
      const response = await fetch(endpoint + new URLSearchParams({ ...query, ...params }), {
        cache: 'no-store', signal: request.signal,
      });
      if (!response.ok) throw Error('UNAVAILABLE');
      const data: unknown = await response.json();
      if (!request.signal.aborted) accept(data);
    } catch {
      if (!request.signal.aborted) setError(true);
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }

  function loadList() {
    setList(null);
    setSelected('');
    void read({ action: 'list' }, value => {
      const data = value as JournalList;
      if (data.status !== 'V2_GROUP_REVALUATION_LIST' || data.query.organization !== organization ||
        data.query.from !== from || data.query.to !== to || !Array.isArray(data.choices)) throw Error('INVALID_RESPONSE');
      setList(data);
    });
  }

  function loadReview(exportCsv = false) {
    if (!choice) return;
    const params = { member: choice.organization, journal: choice.journal,
      ...(translate ? { translation: 'NON_HYPERINFLATIONARY' } : {}) };
    void read(params, value => {
      const data = value as Review;
      if (data.status !== 'V2_GROUP_REVALUATION_REVIEW_ONLY' || data.group !== organization ||
        data.ledger.journalId !== choice.journal || data.ledger.asOf !== to || data.ledger.cutoff !== choice.cutoff)
        throw Error('INVALID_RESPONSE');
      if (exportCsv) {
        const content = financialSourceRowsCsv(groupRevaluationRows(data, choice.name, from, en));
        const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `group-revaluation-review-${from}-${to}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setReview(data);
    });
  }

  return <section className="fs-source-statements" data-group-revaluation-review="true">
    <h2>{t('مراجعة إعادة تقييم العملات', 'Foreign currency revaluation review')}</h2>
    <p>{t('مراجعة قيد مثبت في دفتر شركة ضمن سجل سيطرة المجموعة. النتائج ورقة مراجعة قبل التوحيد.',
      'Review a posted journal from a company in the group control registry. Results are a pre-consolidation worksheet.')}</p>
    <button type="button" disabled={busy || !organization || !from || !to || from > to} onClick={loadList}>
      {t('قراءة قيود إعادة التقييم', 'Load revaluation journals')}
    </button>
    {list?.ambiguousJournals ? <p role="status">{t('استُبعدت القيود المرتبطة بأكثر من مستند إثبات.', 'Journals with multiple evidence records are excluded.')}</p> : null}
    {list && !list.choices.length && <p role="status">{t('لا توجد قيود مرتبطة قابلة للمراجعة في الفترة.', 'No linked journals are available for review in this period.')}</p>}
    {list && list.choices.length > 0 && <div className="fs-filters is-open">
      <label>{t('قيد إعادة التقييم', 'Revaluation journal')}
        <select value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setReview(null); setError(false); }}>
          <option value="">{t('اختر قيدًا', 'Select a journal')}</option>
          {list.choices.map(item => <option key={choiceKey(item)} value={choiceKey(item)}>
            {item.name} · {item.cutoff} · {item.journal.slice(0, 8)}
          </option>)}
        </select>
      </label>
      <label><input type="checkbox" checked={translate} disabled={busy}
        onChange={event => { setTranslate(event.target.checked); setReview(null); setError(false); }}/>
        {t('ترجمة الشركة وفق سياسة المؤسسة (اقتصاد غير مفرط التضخم)', 'Translate using the institution policy (non-hyperinflationary economy)')}
      </label>
      <button type="button" disabled={busy || !choice} onClick={() => loadReview()}>{t('مراجعة القيد', 'Review journal')}</button>
    </div>}
    {busy && <p role="status">{t('جارٍ التحقق من مصادر القيد…', 'Verifying journal sources…')}</p>}
    {error && <p role="alert">{t('تعذّر التحقق من القيد أو صلاحية المجموعة لهذه الفترة.', 'The journal or group access could not be verified for this period.')}</p>}
    {rows && <>
      <button type="button" onClick={() => loadReview(true)}>{t('تصدير المراجعة CSV', 'Export review CSV')}</button>
      <div className="fs-table-scroll"><table className="fs-table"><tbody>
        {rows.map(([label, ...values], index) => <tr key={index}><th scope="row">{label}</th>
          {values.map((value, column) => <td key={column}><bdi>{value}</bdi></td>)}
        </tr>)}
      </tbody></table></div>
    </>}
  </section>;
}
