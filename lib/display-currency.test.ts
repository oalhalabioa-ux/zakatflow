import {describe,it,expect} from 'vitest';
import {displayAmount,displayQuote,type DisplayFxRate} from './display-currency';
const today='2026-10-12';
describe('display-only currency conversion',()=>{
 it('converts SAR using the official reference without relabeling',()=>{expect(displayAmount(375,'SAR','USD',[],today)).toMatchObject({value:100,currency:'USD',missing:false});});
 it('preserves original money in primary mode and USD in dollar mode',()=>{expect(displayAmount(375,'SAR','PRIMARY',[],today).value).toBe(375);expect(displayAmount(100,'USD','USD',[],today).value).toBe(100);});
 it('uses an inverse saved rate with its original date and source',()=>{const r:DisplayFxRate[]=[{from_currency:'USD',to_currency:'SYP',rate:122,valuation_date:'2026-09-27',source:'Manual'}];expect(displayAmount(12200,'SYP','USD',r,today)).toMatchObject({value:100,currency:'USD',quote:{date:'2026-09-27',source:'Manual'}});});
 it('selects the latest valid rate and excludes future or invalid rates',()=>{const r:DisplayFxRate[]=[{from_currency:'EUR',to_currency:'USD',rate:2,valuation_date:'2026-10-13',source:'future'},{from_currency:'EUR',to_currency:'USD',rate:-1,valuation_date:today,source:'bad'},{from_currency:'EUR',to_currency:'USD',rate:1.2,valuation_date:'2026-10-10',source:'latest'},{from_currency:'EUR',to_currency:'USD',rate:1.1,valuation_date:'2026-09-01',source:'old'}];expect(displayQuote('EUR',r,today)).toMatchObject({rate:1.2,source:'latest'});});
 it('preserves negatives, fractions and zero; does not mutate source data',()=>{const input={amount:-0.375,currency:'SAR'};expect(displayAmount(input.amount,input.currency,'USD',[],today).value).toBe(-0.1);expect(input.amount).toBe(-0.375);expect(displayAmount(0,'SAR','USD',[],today).value).toBe(0);});
 it('keeps the original amount and currency when FX is unavailable',()=>{expect(displayAmount(900,'EGP','USD',[],today)).toMatchObject({value:900,currency:'EGP',missing:true});});
 it('does not present non-finite values as valid money',()=>{expect(displayAmount(Infinity,'SAR','USD',[],today).value).toBeNull();});
});
