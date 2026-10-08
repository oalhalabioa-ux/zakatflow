'use client';
import { emptyInvoiceFilters, type InvoiceFilters } from '@/lib/invoice-register-filters';

export function InvoiceRegisterFilters({ value, onChange, currencies, statuses = [], categories = [], ar, count, total,
  showSearch = true }: {
  value: InvoiceFilters; onChange: (value: InvoiceFilters) => void; currencies: string[];
  statuses?: Array<[string, string]>; categories?: Array<[string, string]>; ar: boolean; count: number; total: number; showSearch?: boolean;
}) {
  const change = (key: keyof InvoiceFilters, next: string) => onChange({ ...value, [key]: next });
  const select = (key: keyof InvoiceFilters, label: string, options: Array<[string, string]>) =>
    <label className="vat-invoice-filter"><span>{label}</span><select value={value[key]} onChange={event => change(key, event.target.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>;
  const all: [string, string] = ['ALL', ar ? 'الكل' : 'All'];
  return <div className="vat-register-filters">
    <div className="vat-register-filter-grid">
      {showSearch && <label className="vat-invoice-filter vat-filter-search"><span>{ar ? 'البحث' : 'Search'}</span><input type="search" value={value.query} onChange={event => change('query', event.target.value)} placeholder={ar ? 'رقم الفاتورة أو اسم الجهة' : 'Invoice number or contact name'} /></label>}
      {statuses.length > 0 && select('status', ar ? 'حالة الفاتورة' : 'Invoice status', [all, ...statuses])}
      {categories.length > 0 && select('category', ar ? 'الفئة' : 'Category', [all, ...categories])}
      {select('currency', ar ? 'العملة' : 'Currency', [all, ...currencies.map(code => [code, code] as [string, string])])}
      {select('payment', ar ? 'حالة التحصيل / السداد' : 'Collection / payment', [all, ['UNPAID', ar ? 'غير مسددة' : 'Unpaid'], ['PARTIAL', ar ? 'مسددة جزئيًا' : 'Partially paid'], ['PAID', ar ? 'مسددة بالكامل' : 'Fully paid'], ['OVERDUE', ar ? 'متأخرة' : 'Overdue'], ['UNLINKED', ar ? 'غير مرتبطة بالسيولة' : 'No cash flow']])}
      <label className="vat-invoice-filter"><span>{ar ? 'من تاريخ الفاتورة' : 'Invoice date from'}</span><input type="date" value={value.from} onChange={event => change('from', event.target.value)} /></label>
      <label className="vat-invoice-filter"><span>{ar ? 'إلى تاريخ' : 'To date'}</span><input type="date" min={value.from || undefined} value={value.to} onChange={event => change('to', event.target.value)} /></label>
      {select('sort', ar ? 'ترتيب العرض' : 'Sort by', [['DATE_DESC', ar ? 'الأحدث أولًا' : 'Newest first'], ['DATE_ASC', ar ? 'الأقدم أولًا' : 'Oldest first'], ['NUMBER_ASC', ar ? 'رقم الفاتورة' : 'Invoice number'], ['NAME_ASC', ar ? 'اسم الجهة' : 'Contact name'], ['AMOUNT_DESC', ar ? 'الأعلى بالعملة الأساسية' : 'Highest in base currency'], ['DUE_ASC', ar ? 'أقرب استحقاق' : 'Earliest due']])}
    </div>
    <div className="vat-filter-footer"><span>{count} {ar ? 'من' : 'of'} {total} {ar ? 'فاتورة' : 'invoices'}</span><button type="button" className="vat-button secondary" onClick={() => onChange({ ...emptyInvoiceFilters })}>{ar ? 'مسح الفلاتر' : 'Reset filters'}</button></div>
    {value.from && value.to && value.from > value.to && <small role="alert" className="vat-contact-error">{ar ? 'تاريخ البداية يجب أن يسبق تاريخ النهاية.' : 'Start date must not be after end date.'}</small>}
  </div>;
}
