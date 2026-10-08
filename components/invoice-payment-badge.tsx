import { invoicePaymentState } from '@/lib/invoice-register-filters';
export function InvoicePaymentBadge({ flow, ar, note = false }: { flow?: { amount: string | number; settled_amount: string | number; settlement_status?: string } | null; ar: boolean; note?: boolean }) {
  if (note) return <span className="vat-payment-badge neutral">{ar ? 'تسوية / إشعار' : 'Adjustment / note'}</span>;
  const state = invoicePaymentState({ id:'', number:'', name:'', date:'', currency:'', baseAmount:0, flow });
  const closedByNote = flow && Number(flow.amount) === 0 && flow.settlement_status === 'SETTLED';
  const label = closedByNote ? (ar ? 'مغلقة بالإشعار' : 'Closed by note') : state === 'PAID' ? (ar ? 'مسددة' : 'Paid') : state === 'PARTIAL' ? (ar ? 'مسددة جزئيًا' : 'Partially paid') : state === 'UNPAID' ? (ar ? 'غير مسددة' : 'Unpaid') : (ar ? 'غير مرتبطة بالسداد' : 'No settlement link');
  return <span className={`vat-payment-badge ${state.toLowerCase()}`}>{label}</span>;
}
