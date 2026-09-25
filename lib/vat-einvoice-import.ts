export type ImportRow = Record<string, string>;

const HEADER_ALIASES: Record<string, string> = {
  'رقم الفاتورة': 'invoice_number',
  'نوع الفاتورة': 'invoice_category',
  'تاريخ الإصدار': 'issue_date',
  'وقت الإصدار': 'issue_time',
  'اسم البائع': 'seller_name',
  'عنوان البائع': 'seller_address',
  'رقم مبنى البائع': 'seller_building_number',
  'حي البائع': 'seller_district',
  'الرقم الإضافي للبائع': 'seller_additional_number',
  'مدينة البائع': 'seller_city',
  'الرمز البريدي للبائع': 'seller_postal_code',
  'اسم المشتري': 'buyer_name',
  'الرقم الضريبي للمشتري': 'buyer_vat_number',
  'عنوان المشتري': 'buyer_address',
  'رقم مبنى المشتري': 'buyer_building_number',
  'حي المشتري': 'buyer_district',
  'مدينة المشتري': 'buyer_city',
  'الرمز البريدي للمشتري': 'buyer_postal_code',
  'رقم البند': 'item_name',
  'اسم البند': 'item_name',
  'وصف البند': 'item_name',
  'الكمية': 'quantity',
  'سعر الوحدة': 'unit_price',
  'الخصم': 'discount_amount',
  'التصنيف الضريبي': 'tax_category',
  'نسبة الضريبة': 'tax_rate',
};

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((item) => item.trim())) rows.push(row);
  if (quoted) throw new Error('IMPORT_CSV_UNCLOSED_QUOTE');
  return rows;
}

export function rowsToRecords(rows: unknown[][]): ImportRow[] {
  if (rows.length < 2) throw new Error('IMPORT_FILE_EMPTY');
  const headers = rows[0].map((value) => normalizeHeader(String(value ?? '').trim()));
  if (!headers.includes('invoice_number') || !headers.includes('item_name')) throw new Error('IMPORT_HEADERS_MISSING');
  return rows.slice(1).filter((row) => row.some((value) => String(value ?? '').trim())).map((row) => {
    const record: ImportRow = {};
    headers.forEach((header, index) => {
      if (header) record[header] = normalizeCell(row[index]);
    });
    return record;
  });
}

export function groupImportRecords(records: ImportRow[]) {
  const groups = new Map<string, ImportRow[]>();
  for (const record of records) {
    const number = record.invoice_number?.trim();
    if (!number) throw new Error('IMPORT_INVOICE_NUMBER_MISSING');
    groups.set(number, [...(groups.get(number) ?? []), record]);
  }
  if (!groups.size) throw new Error('IMPORT_FILE_EMPTY');
  if (groups.size > 200) throw new Error('IMPORT_TOO_MANY_INVOICES');
  return [...groups.entries()].map(([invoiceNumber, lines]) => ({ invoiceNumber, rows: lines }));
}

function normalizeHeader(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return HEADER_ALIASES[value] ?? normalized;
}

function normalizeCell(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text ?? '').trim();
  return String(value).trim();
}
