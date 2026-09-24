export type VatFilingFrequency = 'MONTHLY' | 'QUARTERLY';

export function getVatPeriod(
  periodMonth: string,
  frequency: VatFilingFrequency,
  periodStartMonth = 1,
) {
  const match = /^(\d{4})-(\d{2})$/.exec(periodMonth);
  if (!match) throw new Error('INVALID_PERIOD_MONTH');
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) throw new Error('INVALID_PERIOD_MONTH');

  const span = frequency === 'MONTHLY' ? 1 : 3;
  const offset = (monthIndex - (periodStartMonth - 1) + 12) % 12;
  const startIndex = monthIndex - (offset % span);
  const startYear = year + Math.floor(startIndex / 12);
  const normalizedStartMonth = ((startIndex % 12) + 12) % 12;
  const finalMonthIndex = normalizedStartMonth + span - 1;
  const endYear = startYear + Math.floor(finalMonthIndex / 12);
  const endMonthIndex = finalMonthIndex % 12;
  const lastDay = new Date(Date.UTC(endYear, endMonthIndex + 1, 0)).getUTCDate();
  const date = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return {
    from: date(startYear, normalizedStartMonth, 1),
    to: date(endYear, endMonthIndex, lastDay),
  };
}
