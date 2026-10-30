import {describe,it,expect} from 'vitest';
import {registrationError,normalizePhone,verifiedEmail} from '../lib/auth/registration';
import {getEmailAuthCallbackUrl} from '../lib/auth/recovery-redirect';
const valid={name:'QA Test',phone:'+966 50 000 0000',password:'Test-password-1234',confirm:'Test-password-1234',terms:true};
describe('registration validation and safe email callbacks',()=>{
 it('accepts international phone formatting and Unicode names',()=>{expect(registrationError('qa@example.test',{...valid,name:'مستخدم اختبار'})).toBeNull();expect(normalizePhone('+966 (50) 000-0000')).toBe('+966500000000')});
 it.each([{phone:'0500000000'},{phone:'+000000000'},{name:'a'},{password:'123456789012'},{password:'abcdefghijkl'},{confirm:'different'},{terms:false}])('rejects invalid registration data %j',change=>expect(registrationError('qa@example.test',{...valid,...change})).not.toBeNull());
 it('rejects malformed email',()=>expect(registrationError('not-an-email',valid)).toBe('email'));
 it('never treats user metadata as verification',()=>{expect(verifiedEmail(null)).toBe(false);expect(verifiedEmail({email_confirmed_at:null})).toBe(false);expect(verifiedEmail({email_confirmed_at:'2026-10-30T00:00:00Z'})).toBe(true)});
 it.each(['ar','en'])('preserves language, invitation and safe next for %s',locale=>{const url=new URL(getEmailAuthCallbackUrl('https://preview.example.test',locale,'invite',`/${locale}/assets`,true));expect(url.search.startsWith(`?lang=${locale}&`)).toBe(true);expect(url.searchParams.get('invite')).toBe('invite');expect(url.searchParams.get('next')).toBe(`/${locale}/assets`);expect(url.searchParams.get('flow')).toBe('signup')});
 it('rejects external next targets',()=>expect(new URL(getEmailAuthCallbackUrl('https://preview.example.test','en',null,'//evil.test')).searchParams.get('next')).toBe('/en/dashboard'));
});
