import Decimal from 'decimal.js';

export type ConsolidationLine = { entityId:string; entityName:string; assessmentId:string; zakatableValue:Decimal.Value; zakatDue:Decimal.Value; currency:string };
export function consolidate(lines: ConsolidationLine[], baseCurrency:string) {
  let value = new Decimal(0), due = new Decimal(0);
  const normalized = lines.map(l => { const v=new Decimal(l.zakatableValue); const z=new Decimal(l.zakatDue); value=value.plus(v); due=due.plus(z); return {...l, zakatableValue:v.toFixed(2), zakatDue:z.toFixed(2)}; });
  return { baseCurrency, totalZakatableValue:value.toFixed(2), totalZakatDue:due.toFixed(2), lineCount:normalized.length, lines:normalized };
}
