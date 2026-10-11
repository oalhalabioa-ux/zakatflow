import {assetCurrentValue} from './asset-table-preferences';

export const indicatorPercent = (value: number, base: number) => base > 0 ? value / base * 100 : 0;

/** Inputs are the same rows shown by the report, after scope and all filters. */
export function assetPageIndicators(rows: any[], today: string) {
  const active = rows.filter(r => (r.lifecycle_status || 'ACTIVE') === 'ACTIVE');
  const total = active.reduce((s, r) => s + assetCurrentValue(r), 0);
  const cost = active.reduce((s, r) => s + Number(r.current_cost_value || 0), 0);
  const sum = (key: string) => rows.reduce((s, r) => s + Number(r.zakat_calculation?.[key] || 0), 0);
  const completed = rows.filter(r => r.is_zakatable && r.zakat_calculation?.statuses?.includes('ELIGIBLE'));
  const zakatable = active.filter(r => r.is_zakatable);
  const nextDue = (r: any) => {
    // Monitor the new Hawl, not the frozen dates of a prior closed cycle.
    const currentDates=(r.lots||[]).map((l:any)=>l.current_hawl_due_date).filter(Boolean);
    if(currentDates.length)return currentDates.filter((d:string)=>d>=today).sort()[0];
    const openLots = (r.zakat_cycle_calculations || []).filter((c: any) => !c.cycle_closed).flatMap((c: any) => c.lots || []);
    return [...openLots, ...(r.lots || [])].map((l: any) => l.hawl_due_date).filter((d: string) => d && d >= today).sort()[0];
  };
  const near = zakatable.filter(r => {
    const d = nextDue(r);
    return d && (Date.parse(d + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000 <= 30;
  });
  return {active, total, cost, gain: total - cost, totalDue: sum('zakat_amount'), totalPaid: sum('paid_amount'), eligibleValue: sum('eligible_value'), completed, near, zakatable, nextDue};
}
