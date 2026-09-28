export type LiquidityForecastFlow = {
  direction: 'INFLOW' | 'OUTFLOW';
  due_date: string;
  status: 'ACTUAL' | 'CONFIRMED' | 'EXPECTED';
  base_amount: number | string;
};
export type ForecastWeek = { label: string; from: string; to: string; balance: number; inflow: number; outflow: number };
const dateKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
export function buildLiquidityForecast(available: number, flows: LiquidityForecastFlow[], startDate: string, count = 13): ForecastWeek[] {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  let balance = Number(available || 0);
  return Array.from({ length: count }, (_, index) => {
    const fromDate = new Date(start); fromDate.setUTCDate(start.getUTCDate() + index * 7);
    const toDate = new Date(fromDate); toDate.setUTCDate(fromDate.getUTCDate() + 6);
    const from = dateKey(fromDate), to = dateKey(toDate);
    const due = flows.filter(flow => flow.status !== 'ACTUAL' && flow.due_date >= from && flow.due_date <= to);
    const inflow = due.filter(flow => flow.direction === 'INFLOW').reduce((sum, flow) => sum + Number(flow.base_amount || 0), 0);
    const outflow = due.filter(flow => flow.direction === 'OUTFLOW').reduce((sum, flow) => sum + Number(flow.base_amount || 0), 0);
    balance += inflow - outflow;
    return { label: fromDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }), from, to, balance, inflow, outflow };
  });
}
export function buildScenarioForecast(available: number, flows: LiquidityForecastFlow[], startDate: string, delayReceiptsDays: number, expenseIncreasePercent: number, count = 13): ForecastWeek[] {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const adjusted = flows.filter(flow => flow.status !== 'ACTUAL').map(flow => {
    if (flow.direction === 'INFLOW') {
      const shifted = new Date(`${flow.due_date}T00:00:00.000Z`);
      shifted.setUTCDate(shifted.getUTCDate() + delayReceiptsDays);
      return { ...flow, due_date: dateKey(shifted) };
    }
    return { ...flow, base_amount: Number(flow.base_amount) * (1 + expenseIncreasePercent / 100) };
  });
  return buildLiquidityForecast(available, adjusted, dateKey(start), count);
}
export function lowestForecastBalance(available: number, weeks: Pick<ForecastWeek,'balance'>[]) {
  return Math.min(Number(available || 0), ...weeks.map(week => week.balance));
}
