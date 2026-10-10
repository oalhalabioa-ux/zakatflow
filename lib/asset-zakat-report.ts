import Decimal from 'decimal.js';

export type AssetCycleScope = 'DISPLAYED' | 'ALL' | 'CLOSED' | 'OPEN';

/** One referenced snapshot per cycle; superseded open previews never accumulate. */
export function assetReportAssessments(cycles: any[], assessments: any[]) {
  const byId = new Map(assessments.map(a => [a.id, a]));
  return cycles.flatMap(c => {
    const closed = ['CLOSED', 'PAID'].includes(c.status);
    if (!closed && !['OPEN', 'ACTIVE'].includes(c.status)) return [];
    const a = byId.get(closed ? (c.final_assessment_id ?? c.assessment_id) : c.assessment_id);
    if (!a || a.status === 'CANCELLED' || (!closed && (a.superseded_by || a.status === 'DRAFT'))) return [];
    return [{ assessment: a, cycle: c, closed }];
  });
}

/** Sum each cycle's own balance so overpayment cannot erase another cycle's estimate. */
export function assetReportCalculation(calculations: any[], scope: AssetCycleScope) {
  const selected = calculations.filter(c => scope === 'ALL' || (scope === 'CLOSED' ? c.cycle_closed : !c.cycle_closed));
  if (!selected.length) return null;
  const sum = (key: string) => selected.reduce((s, c) => s.add(c[key] ?? 0), new Decimal(0)).toNumber();
  return {
    ...selected[0], report_scope: scope, cycle_calculations: selected,
    zakat_amount: sum('zakat_amount'), paid_amount: sum('paid_amount'),
    remaining_amount: sum('remaining_amount'), credit_amount: sum('credit_amount'),
    market_value: sum('market_value'), eligible_value: sum('eligible_value'),
    statuses: [...new Set(selected.flatMap(c => c.statuses ?? []))],
    lots: selected.flatMap(c => c.lots ?? []),
  };
}
