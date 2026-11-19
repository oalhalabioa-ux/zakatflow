import { handoffReadiness } from '@/lib/feasibility/handoff';
import type { evaluateStudy, FeasibilityStudy } from '@/lib/feasibility/engine';
import { evaluateWater } from '@/lib/feasibility/water-model';
import { RoyalCashTrend } from './RoyalCharts';
import { RoyalIcon, type RoyalIconName } from './RoyalIcon';

const taskPriority = {
  HIGH: ['عالية', 'High'], NORMAL: ['متوسطة', 'Medium'], LOW: ['منخفضة', 'Low'],
} as const;
const priorityRank = { HIGH: 0, NORMAL: 1, LOW: 2 };
const readinessLabels: Record<string, readonly [string, string]> = {
  decision: ['قرار المشروع', 'Project decision'], identity: ['مدخلات المشروع', 'Project inputs'],
  model: ['التحليل المالي', 'Financial analysis'], finance: ['التمويل النقدي', 'Cash funding'],
  legal: ['التحقق القانوني', 'Legal verification'], blockers: ['الموانع النظامية', 'Legal blockers'],
};
const taskStatus = {
  TODO: ['لم يبدأ', 'To do'], IN_PROGRESS: ['قيد التنفيذ', 'In progress'],
  BLOCKED: ['معلق', 'Blocked'], DONE: ['مكتمل', 'Completed'],
} as const;

export default function RoyalOverview({ study, locale, model, sectorLabel, statusLabel, onTasks }: {
  study: FeasibilityStudy; locale: string; model: ReturnType<typeof evaluateStudy>;
  sectorLabel: string; statusLabel: string; onTasks: () => void;
}) {
  const ar = locale === 'ar';
  const t = (arabic: string, english: string) => ar ? arabic : english;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const money = (amount: number) => Number.isFinite(amount) ? [number.format(amount), study.currency].filter(Boolean).join(' ') : '—';
  const ratio = (value: number | null) => value == null || !Number.isFinite(value) ? '—' : percent.format(value / 100);
  const readiness = handoffReadiness(study);
  const completed = readiness.checks.filter(check => check.passed).length;
  const tasks = study.tasks.filter(task => task.status !== 'DONE')
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])
    .slice(0, 5);
  const water = study.water ? evaluateWater(study.water) : null;
  const economic = water ?? model;
  const investment = water ? water.cashRequired + water.land : model.totalInvestment;
  const metrics: Array<{ icon: RoyalIconName; label: string; value: string; hint: string }> = [
    { icon: 'coins', label: t('إجمالي الاستثمار الاقتصادي', 'Economic investment'), value: money(investment), hint: t('استثمار تأسيسي', 'Initial investment') },
    { icon: 'chart', label: t('صافي القيمة الحالية NPV', 'Net present value (NPV)'), value: economic.ready && economic.npv != null ? money(economic.npv) : '—', hint: t('على أساس التدفق الاقتصادي', 'Based on project cash flow') },
    { icon: 'chart', label: t('معدل العائد الداخلي IRR', 'Internal rate of return (IRR)'), value: economic.ready ? ratio(economic.irr) : '—', hint: t('عائد المشروع التقديري', 'Indicative project return') },
    { icon: 'check', label: t('جاهزية الدراسة', 'Study readiness'), value: percent.format(completed / readiness.checks.length), hint: t('متطلبات الجاهزية المكتملة', 'Readiness checks passed') },
  ];
  const ownership = study.water ? {
    transfer: t('نقل ملكية الأرض', 'Land ownership transfer'),
    lease: t('إيجار الأرض', 'Land lease'),
    right: t('حق انتفاع', 'Right of use'),
  }[study.water.deal.landMode] : study.landTransferred ? t('نقل ملكية الأرض', 'Land ownership transfer') : '—';
  const profile = [
    [t('القطاع', 'Sector'), sectorLabel],
    [t('الدولة', 'Country'), study.country],
    [t('عملة الدراسة', 'Study currency'), study.currency],
    [t('نموذج ملكية الأرض', 'Land ownership model'), ownership],
    [t('حالة الدراسة', 'Study status'), statusLabel],
    [t('تاريخ الدراسة', 'Study date'), study.studyDate],
  ];
  return <section className="fs-block" aria-label={t('ملخص لوحة المشروع', 'Project dashboard summary')}>
    <div className="fs-kpis fs-royal-overview-kpis">{metrics.map(metric =>
      <div className="fs-metric" key={metric.label}>
        <RoyalIcon name={metric.icon}/><small>{metric.label}</small>
        <strong><bdi>{metric.value}</bdi></strong><span>{metric.hint}</span>
      </div>)}</div>
    <div className="fs-royal-overview-grid">
      <div className="fs-royal-overview-column">
        <section className="card fs-panel fs-royal-overview-readiness">
          <h3 className="fs-royal-report-title"><RoyalIcon name="check"/>{t('تشخيص القرار والاستعداد', 'Decision and readiness')}</h3>
          <p className="fs-hint">{t('نتائج استرشادية. تحقق من الافتراضات والتمويل والتراخيص قبل اعتماد القرار الاستثماري.', 'Indicative results. Verify assumptions, financing and licences before approving the investment decision.')}</p>
          <ul className="fs-royal-checks">{readiness.checks.map(check =>
            <li key={check.key}>
              <span id={'fs-readiness-' + check.key} title={ar ? check.ar : check.en}>
                {readinessLabels[check.key]?.[ar ? 0 : 1] ?? (ar ? check.ar : check.en)}</span>
              <div className="fs-royal-check-progress"><progress value={Number(check.passed)} max={1} aria-labelledby={'fs-readiness-' + check.key}/>
               <strong data-complete={check.passed}>{check.passed ? t('مكتمل', 'Complete') : t('يحتاج مراجعة', 'Review needed')}</strong></div>
            </li>)}</ul>
        </section>
        <section className="card fs-panel fs-royal-overview-tasks">
          <h3 className="fs-royal-report-title"><RoyalIcon name="clipboard"/>{t('المهام المفتوحة ذات الأولوية', 'Priority open tasks')}</h3>
          {tasks.length ? <div className="fs-table-wrap"><table className="fs-table fs-royal-priority-table">
            <thead><tr><th scope="col">{t('المهمة', 'Task')}</th><th scope="col">{t('المسؤول', 'Owner')}</th>
             <th scope="col">{t('الأولوية', 'Priority')}</th><th scope="col">{t('الحالة', 'Status')}</th></tr></thead>
            <tbody>{tasks.map(task => <tr key={task.id}><th scope="row">{task.title}</th><td>{task.owner || '—'}</td>
              <td><span className="fs-royal-tag" data-priority={task.priority}>{taskPriority[task.priority][ar ? 0 : 1]}</span></td>
              <td><span className="fs-royal-tag" data-task-status={task.status}>{taskStatus[task.status][ar ? 0 : 1]}</span></td></tr>)}</tbody>
          </table></div> : <p>{t('لا توجد مهام مفتوحة.', 'There are no open tasks.')}</p>}
          <div className="fs-actions"><button type="button" className="fs-btn fs-btn--secondary" onClick={onTasks}>
            {t('عرض المهام', 'View tasks')}</button></div>
        </section>
      </div>
      <div className="fs-royal-overview-column">
        <div className="fs-royal-overview-trend">
          {economic.ready
            ? <RoyalCashTrend title={t('التدفق النقدي التراكمي', 'Cumulative cash flow')} locale={locale} unit={study.currency} flows={economic.flows}/>
            : <section className="card fs-panel">
               <h3 className="fs-royal-report-title"><RoyalIcon name="chart"/>{t('التدفق النقدي التراكمي', 'Cumulative cash flow')}</h3>
               <p>{t('يظهر التدفق بعد استكمال مدخلات الاستثمار والتشغيل.', 'Complete the investment and operating inputs to see cash flow.')}</p>
              </section>}
        </div>
        <section className="card fs-panel fs-royal-overview-profile">
          <h3 className="fs-royal-report-title"><RoyalIcon name="file"/>{t('ملخص بيانات الدراسة', 'Study profile summary')}</h3>
          <dl className="fs-royal-checks">{profile.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value || '—'}</dd></div>)}</dl>
        </section>
      </div>
    </div>
  </section>;
}
