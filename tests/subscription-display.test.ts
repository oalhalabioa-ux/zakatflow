import {describe,it,expect} from 'vitest';
import {money} from '../lib/subscriptions/catalog';
import {displaySubscriptionDate} from '../lib/subscriptions/model';
describe('subscription numeric display',()=>{
 it('keeps Latin digits in Arabic and English currency amounts',()=>{
  for(const locale of ['ar','en'])for(const currency of ['SAR','USD','LBP']){
   const value=money(3990,currency,locale);expect(value).not.toMatch(/[٠-٩۰-۹]/);expect(value.replace(/[^0-9]/g,'')).toContain('3990');
  }
 });
 it('uses Latin Gregorian dates and the selected timezone at a UTC day boundary',()=>{
  const utc=displaySubscriptionDate('2026-10-31T22:30:00Z','ar','UTC');
  const riyadh=displaySubscriptionDate('2026-10-31T22:30:00Z','ar','Asia/Riyadh');
  expect(utc).not.toMatch(/[٠-٩۰-۹]/);expect(riyadh).not.toMatch(/[٠-٩۰-۹]/);
  expect(utc).toContain('31');expect(riyadh).toContain('1');expect(riyadh).not.toBe(utc);expect(displaySubscriptionDate(undefined,'ar')).toBe('—');
 });
});
