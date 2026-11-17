import { handoffReadiness } from '@/lib/feasibility/handoff';
import type { FeasibilityStudy } from '@/lib/feasibility/engine';
import { RoyalIcon } from './RoyalIcon';

export default function RoyalOverview({ study, locale, onTasks }: {
  study: FeasibilityStudy; locale: string; onTasks: () => void;
}) {
  const ar = locale === 'ar';
  const text = (arabic: string, english: string) => ar ? arabic : english;
  const readiness = handoffReadiness(study);
  const completed = readiness.checks.filter(check => check.passed).length;
  const tasks = study.tasks.filter(task => task.status !== 'DONE' && task.priority === 'HIGH').slice(0, 5);
  const profile = [
    [text('الدولة','Country'), study.country],
    [text('المنطقة','Region'), study.region],
    [text('العملة','Currency'), study.currency],
    [text('معد الدراسة','Prepared by'), study.preparedBy],
    [text('تاريخ الدراسة','Study date'), study.studyDate],
  ];
  return <section className="fs-columns" aria-label={text('تشخيص القرار وملخص المشروع','Decision readiness and project summary')}>
    <div className="card fs-panel">
      <h3 className="fs-royal-report-title"><RoyalIcon name="check"/>{text('تشخيص القرار والجاهزية','Decision and readiness')}</h3>
      <div className="fs-row"><strong>{text('متطلبات الجاهزية المكتملة','Completed readiness requirements')}</strong>
        <b>{completed} / {readiness.checks.length}</b></div>
      <progress value={completed} max={readiness.checks.length} aria-label={text('جاهزية الدراسة','Study readiness')}/>
      <ul className="fs-royal-checks">{readiness.checks.map(check => <li key={check.key}>
        <span>{ar ? check.ar : check.en}</span><strong data-complete={check.passed}>
          {check.passed ? text('مكتمل','Complete') : text('يحتاج مراجعة','Review needed')}</strong>
      </li>)}</ul>
    </div>
    <div className="fs-block">
      <section className="card fs-panel">
        <h3 className="fs-royal-report-title"><RoyalIcon name="clipboard"/>{text('المهام المفتوحة ذات الأولوية','High-priority open tasks')}</h3>
        {tasks.length ? <ul className="fs-royal-checks">{tasks.map(task => <li key={task.id}>
          <span>{task.title}</span><span>{task.owner || task.due || '—'}</span>
        </li>)}</ul> : <p>{text('لا توجد مهام مفتوحة ذات أولوية عالية.','There are no high-priority open tasks.')}</p>}
        <div className="fs-actions"><button type="button" className="fs-btn fs-btn--secondary" onClick={onTasks}>
          {text('عرض المهام','View tasks')}</button></div>
      </section>
      <section className="card fs-panel">
        <h3 className="fs-royal-report-title"><RoyalIcon name="file"/>{text('ملخص بيانات الدراسة','Study profile summary')}</h3>
        <dl className="fs-royal-checks">{profile.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value || '—'}</dd></div>)}</dl>
      </section>
    </div>
  </section>;
}
