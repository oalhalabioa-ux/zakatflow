import {it,expect} from 'vitest';
import {vatReportPrintHtml} from './vat-report-print';
it('escapes all business content and repeats headings in printable Arabic reports',()=>{const html=vatReportPrintHtml('<script>','شركة',['العميل'],[['<img src=x onerror=alert(1)>']],true,'red;display:none');expect(html).not.toContain('<script>');expect(html).not.toContain('<img');expect(html).not.toContain('display:none;');expect(html).toContain('dir="rtl"');expect(html).toContain('display:table-header-group');expect(html).toContain('A4 landscape')});
