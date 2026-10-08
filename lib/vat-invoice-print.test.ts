import { describe, expect, it } from 'vitest';
import { invoicePrintHtml, type PrintableInvoice } from './vat-invoice-print';
const invoice: PrintableInvoice = { number:'7',date:'2026-10-08',currency:'SAR',title:'فاتورة ضريبية',draft:true,
  seller:{name:'البائع'},buyer:{name:'العميل'},net:100,tax:15,total:115,
  lines:[{name:'خدمة',quantity:1,unitPrice:100,tax:15,total:115}] };
describe('invoice print safety and lifecycle', () => {
  it('marks drafts and omits QR even if supplied', () => {
    const html=invoicePrintHtml(invoice,true,'data:image/png;base64,AAAA');
    expect(html).toContain('مسودة — غير مصدرة'); expect(html).not.toContain('<img');
  });
  it('escapes contact and line input, rejecting arbitrary QR URLs', () => {
    const html=invoicePrintHtml({...invoice,draft:false,seller:{name:'<script>alert(1)</script>'},lines:[{...invoice.lines[0],name:'<img src=x onerror=alert(1)>'}]},true,'javascript:alert(1)');
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img');
  });
  it('uses the actual reporting base for accounting copies', () => {
    const html=invoicePrintHtml({...invoice,draft:false,recordCopy:true,currency:'EUR',baseCurrency:'USD',exchangeRate:1.1},false);
    expect(html).toContain('1 EUR = 1.1 USD'); expect(html).toContain('Invoice register copy');
  });
});
