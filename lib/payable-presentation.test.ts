import {expect,it} from 'vitest';
import {payableDate,payableReference,payableRawReference} from './payable-presentation';
const id='4f1ea3df-93b9-4fbe-818c-e4db9241ff1b';
it('keeps a supplied reference and replaces the internal fallback with a short voucher code',()=>{expect(payableReference('INV-14',id)).toBe('INV-14');expect(payableReference(id,id)).toBe('AP-4F1EA3DF');expect(payableReference('',id)).toBe('AP-4F1EA3DF');expect(payableRawReference(id,id)).toBe('');});
it('formats plain dates without timezone conversion or locale digits',()=>{expect(payableDate('2026-04-07')).toBe('07/04/2026');expect(payableDate(null)).toBe('غير محدد');});
