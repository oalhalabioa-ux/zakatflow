import { describe, expect, it } from 'vitest';
import { groupImportRecords, parseCsv, rowsToRecords } from './vat-einvoice-import';

describe('VAT e-invoice imports', () => {
  it('parses quoted CSV fields, BOM and CRLF', () => {
    expect(parseCsv('\uFEFFinvoice_number,item_name,quantity\r\nINV-1,"Service, monthly",2\r\n')).toEqual([
      ['invoice_number', 'item_name', 'quantity'],
      ['INV-1', 'Service, monthly', '2'],
    ]);
  });

  it('accepts Arabic column names and groups invoice lines', () => {
    const records = rowsToRecords([
      ['رقم الفاتورة', 'وصف البند', 'الكمية'],
      ['INV-1', 'الخدمة', 2],
      ['INV-1', 'التركيب', 1],
    ]);
    expect(groupImportRecords(records)).toHaveLength(1);
    expect(groupImportRecords(records)[0].rows).toHaveLength(2);
  });

  it('requires invoice and item columns', () => {
    expect(() => rowsToRecords([['invoice_number'], ['INV-1']])).toThrow('IMPORT_HEADERS_MISSING');
  });
});
