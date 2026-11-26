import {expect,it} from 'vitest';
import {invoiceRegisterHref} from './invoice-register-navigation';
it('retains company, branch and period from old invoice bookmarks',()=>{
 const q=new URL(invoiceRegisterHref('ar',{organization_id:'company-a',entity_id:'branch-a',month:'2026-11',section:'invoices'}),'https://app.invalid').searchParams;
 expect(Object.fromEntries(q)).toEqual({section:'unified',scope:'ORGANIZATION',entity_id:'branch-a',month:'2026-11',organization:'company-a'});
});
it('preserves the canonical organization and ignores ambiguous duplicate query values',()=>{
 const q=new URL(invoiceRegisterHref('en',{organization:'company-b',organization_id:'company-a',entity_id:['branch-a','branch-b'],level:'GROUP'}),'https://app.invalid').searchParams;
 expect(q.get('organization')).toBe('company-b');expect(q.get('level')).toBe('GROUP');expect(q.has('entity_id')).toBe(false);
});

it('keeps a personal bookmark free of company and document selectors',()=>{
 const href=invoiceRegisterHref('en',{scope:'PERSONAL',organization:'company-b',level:'GROUP',document_id:'invoice-b'});
 expect(href).toBe('/en/vat?section=unified&scope=PERSONAL');
});
