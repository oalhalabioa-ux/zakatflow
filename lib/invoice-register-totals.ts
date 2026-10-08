import Decimal from 'decimal.js';
export type InvoiceTotalRow = { side?: string; kind: string; status?: string; currency: string; net: string | number; tax: string | number; gross: string | number; flow?: { currency: string; amount: string | number; settled_amount: string | number } | null };
export function invoiceRegisterTotals(rows: InvoiceTotalRow[]) {
  const groups = new Map<string,{side:string;currency:string;net:Decimal;tax:Decimal;gross:Decimal;count:number}>();
  const cash = new Map<string,{side:string;currency:string;paid:Decimal;due:Decimal}>();
  for (const row of rows) {
    if (['VOID','REJECTED'].includes(row.status || '')) continue;
    const side = row.side || 'SALES', key = `${side}:${row.currency}`;
    const group = groups.get(key) || {side,currency:row.currency,net:new Decimal(0),tax:new Decimal(0),gross:new Decimal(0),count:0};
    const sign = row.kind === 'CREDIT_NOTE' ? -1 : 1;
    group.net = group.net.plus(new Decimal(row.net).mul(sign));group.tax = group.tax.plus(new Decimal(row.tax).mul(sign));group.gross = group.gross.plus(new Decimal(row.gross).mul(sign));group.count++;groups.set(key,group);
    // Refund obligations on notes remain separate; don't count them as original invoice collections/payments.
    if (row.kind === 'INVOICE' && row.flow) {
      const cashKey = `${side}:${row.flow.currency}`;
      const summary = cash.get(cashKey) || {side,currency:row.flow.currency,paid:new Decimal(0),due:new Decimal(0)};
      summary.paid=summary.paid.plus(row.flow.settled_amount || 0);summary.due=summary.due.plus(Decimal.max(0,new Decimal(row.flow.amount).minus(row.flow.settled_amount || 0)));cash.set(cashKey,summary);
    }
  }
  return { groups:[...groups.values()].map(g=>({...g,net:g.net.toFixed(2),tax:g.tax.toFixed(2),gross:g.gross.toFixed(2)})), cash:[...cash.values()].map(g=>({...g,paid:g.paid.toFixed(2),due:g.due.toFixed(2)})) };
}
