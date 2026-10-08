import type { ReactNode } from 'react';
export type InvoiceIconName = 'print' | 'delete' | 'edit' | 'post' | 'receipt' | 'pay' | 'collect' | 'issue' | 'credit' | 'debit' | 'users' | 'month' | 'quarter' | 'lock' | 'unlock';
export function InvoiceIcon({ name }: { name: InvoiceIconName }) {
  const paths: Record<InvoiceIconName, ReactNode> = {
    print: <><path d="M6 9V3h12v6M6 17H4V9h16v8h-2"/><path d="M6 14h12v7H6zM16 11h.01"/></>,
    delete: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
    edit: <><path d="m16 3 5 5-12 12H4v-5L16 3ZM13 6l5 5"/></>,
    post: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
    receipt: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3ZM8 8h8M8 12h8M8 16h4"/></>,
    pay: <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 14h3"/></>,
    collect: <><path d="M12 3v11m-4-4 4 4 4-4M4 14v7h16v-7"/></>,
    issue: <><path d="M6 3h8l4 4v5M14 3v5h5M6 3v18h6m3-4 2 2 4-5"/></>,
    credit: <><path d="M6 3h8l4 4v14H6V3ZM14 3v5h4M9 14h6"/></>,
    debit: <><path d="M6 3h8l4 4v14H6V3ZM14 3v5h4M9 14h6M12 11v6"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/></>,
    month: <><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
    quarter: <><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14v4M12 14v4M16 14v4"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
    unlock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0M12 14v3"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
export function InvoiceActionLabel({ icon, children }: { icon: InvoiceIconName; children: ReactNode }) {
  return <span className="vat-action-icon-content"><InvoiceIcon name={icon} /><span className="vat-action-tooltip">{children}</span></span>;
}
