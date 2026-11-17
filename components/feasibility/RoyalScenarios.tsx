import {
  evaluateStudy, scenarioFactors, scenarioLabels,
  type FeasibilityStudy, type Scenario, type ScenarioFactors,
} from '@/lib/feasibility/engine';
import { RoyalBars } from './RoyalCharts';
import { RoyalIcon } from './RoyalIcon';

const scenarios = ['CONSERVATIVE', 'BASE', 'OPTIMISTIC'] as const;
const factors = [
  ['volume', 'حجم المبيعات', 'Sales volume'],
  ['price', 'مستوى السعر', 'Price level'],
  ['variable', 'التكلفة المتغيرة', 'Variable cost'],
] as const;

export default function RoyalScenarios({ study, locale, selected, onSelect, onChange }: {
  study: FeasibilityStudy;
  locale: string;
  selected: Scenario;
  onSelect: (scenario: Scenario) => void;
  onChange: (assumptions: FeasibilityStudy['scenarioAssumptions']) => void;
}) {
  const ar = locale === 'ar';
  const t = (arabic: string, english: string) => ar ? arabic : english;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 });
  const money = (value: number | null | undefined) => value == null ? '—'
    : [number.format(value), study.currency].filter(Boolean).join(' ');
  const results = scenarios.map(scenario => ({
    scenario,
    label: scenarioLabels[scenario][ar ? 'ar' : 'en'],
    assumptions: scenarioFactors(study, scenario),
    result: evaluateStudy(study, scenario),
  }));

  const update = (scenario: Scenario, factors: ScenarioFactors, key: keyof ScenarioFactors, value: number) => {
    onChange({ ...study.scenarioAssumptions, [scenario]: { ...factors, [key]: Math.min(1000, Math.max(0, value)) } });
  };

  return <section className="fs-block">
    <section className="card fs-panel">
      <h3 className="fs-royal-report-title"><RoyalIcon name="chart"/>{t('تعريف السيناريوهات', 'Scenario assumptions')}</h3>
      <div className="fs-table-wrap"><table className="fs-table">
        <thead><tr>
          <th scope="col">{t('السيناريو', 'Scenario')}</th>
          {factors.map(([key, arabic, english]) => <th key={key} scope="col">{t(arabic, english)} %</th>)}
          <th scope="col">{t('الاستثمار', 'Investment')}</th>
          <th scope="col">{t('EBITDA السنة الأولى', 'Year 1 EBITDA')}</th>
          <th scope="col">NPV</th><th scope="col">IRR</th>
        </tr></thead>
        <tbody>{results.map(({ scenario, label, assumptions, result }) => <tr key={scenario}>
          <th scope="row"><span className="fs-royal-tag">{label}</span></th>
          {factors.map(([key, arabic, english]) => <td key={key}><input type="number" inputMode="decimal"
            aria-label={t(arabic, english) + ' % · ' + label} min={0} max={1000} step="any"
            value={assumptions[key]}
            onChange={event => update(scenario, assumptions, key, Number(event.currentTarget.value) || 0)}/></td>)}
          <td><bdi>{money(result.totalInvestment)}</bdi></td>
          <td><bdi>{money(result.ready ? result.annual[0]?.ebitda : null)}</bdi></td>
          <td><bdi>{money(result.npv)}</bdi></td>
          <td><bdi>{result.irr == null ? '—' : percent.format(result.irr / 100)}</bdi></td>
        </tr>)}</tbody>
      </table></div>
      <div className="fs-actions">
        <label className="fs-field"><span>{t('السيناريو النشط في اللوحة', 'Active dashboard scenario')}</span>
          <select value={selected} onChange={event => onSelect(event.currentTarget.value as Scenario)}>
            {results.map(({ scenario, label }) => <option key={scenario} value={scenario}>{label}</option>)}
          </select>
        </label>
      </div>
    </section>
    <RoyalBars title={t('صافي القيمة الحالية حسب السيناريو', 'Net present value by scenario')}
      locale={locale} unit={study.currency}
      data={results.flatMap(({ label, result }) => result.npv == null ? [] : [{ label, value: result.npv }])}/>
  </section>;
}
