import Decimal from 'decimal.js';

export const SAMA_SAR_PER_USD = 3.75;
export const SAMA_FX_SOURCE_URL = 'https://sama.gov.sa/en-US/EconomicReports/Financial%20Stability%20Report/Financial%20Stablity%20Report%202016_en.pdf';

// SAMA documents the start year as 1986. Use the first full calendar year.
const firstCoveredDate = '1987-01-01';
const riyadhDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function samaReferenceToday(now = new Date()) {
  return riyadhDate.format(now);
}

export function samaFixedFxReference(from: string, to: string, date: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < firstCoveredDate || date > samaReferenceToday(now)) return null;
  const parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;

  if (from === 'USD' && to === 'SAR') return { rate: SAMA_SAR_PER_USD, date };
  if (from === 'SAR' && to === 'USD') return { rate: new Decimal(1).div(SAMA_SAR_PER_USD).toNumber(), date };
  return null;
}
