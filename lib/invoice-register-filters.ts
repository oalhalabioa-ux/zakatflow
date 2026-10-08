export type InvoiceFilters = {
  query: string; status: string; category: string; currency: string; payment: string;
  from: string; to: string; sort: string;
};
export const emptyInvoiceFilters: InvoiceFilters = {
  query: '', status: 'ALL', category: 'ALL', currency: 'ALL', payment: 'ALL', from: '', to: '', sort: 'DATE_DESC',
};
export type InvoiceSearchRow = {
  id: string; number: string; name: string; date: string; due?: string | null;
  status?: string; category?: string; currency: string; baseAmount: number;
  flow?: { amount: string | number; settled_amount: string | number } | null;
};
export function invoicePaymentState(row: InvoiceSearchRow) {
  if (!row.flow) return 'UNLINKED';
  const amount = Number(row.flow.amount), settled = Number(row.flow.settled_amount);
  if (amount > 0 && settled >= amount) return 'PAID';
  return settled > 0 ? 'PARTIAL' : 'UNPAID';
}
export function filterInvoiceRows<T>(items: T[], filters: InvoiceFilters, rowFor: (item: T) => InvoiceSearchRow,
  today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Riyadh' }).format(new Date())): T[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return items.map(item => ({ item, row: rowFor(item) })).filter(({ row }) => {
    const state = invoicePaymentState(row);
    return (!query || `${row.number} ${row.name}`.toLocaleLowerCase().includes(query))
      && (filters.status === 'ALL' || row.status === filters.status)
      && (filters.category === 'ALL' || row.category === filters.category)
      && (filters.currency === 'ALL' || row.currency === filters.currency)
      && (!filters.from || row.date >= filters.from) && (!filters.to || row.date <= filters.to)
      && (filters.payment === 'ALL' || (filters.payment === 'OVERDUE'
        ? Boolean(row.flow && Number(row.flow.amount)>0 && state !== 'PAID' && row.due && row.due < today)
        : state === filters.payment));
  }).sort(({ row: a }, { row: b }) => {
    let comparison = 0;
    switch (filters.sort) {
      case 'DATE_ASC': comparison = a.date.localeCompare(b.date); break;
      case 'NUMBER_ASC': comparison = a.number.localeCompare(b.number, undefined, { numeric: true }); break;
      case 'NAME_ASC': comparison = a.name.localeCompare(b.name); break;
      case 'AMOUNT_DESC': comparison = b.baseAmount - a.baseAmount; break;
      case 'DUE_ASC': comparison = (a.due || '9999').localeCompare(b.due || '9999'); break;
      default: comparison = b.date.localeCompare(a.date);
    }
    return comparison || a.number.localeCompare(b.number, undefined, { numeric: true }) || a.id.localeCompare(b.id);
  }).map(({ item }) => item);
}
