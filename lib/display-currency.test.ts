import {describe,it,expect} from 'vitest';
import {displayAmount,displayQuote,scopedDisplayRates,type DisplayFxRate} from './display-currency';
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

describe('FX scope isolation',()=>{
 const all:DisplayFxRate[]=[{from_currency:'USD',to_currency:'SYP',rate:100,valuation_date:today,source:'Global',organization_id:null},{from_currency:'USD',to_currency:'SYP',rate:122,valuation_date:'2026-09-27',source:'Company A',organization_id:'A'},{from_currency:'USD',to_currency:'SYP',rate:200,valuation_date:today,source:'Company B',organization_id:'B'}];
 it('does not borrow another organization rate or expose it to personal scope',()=>{expect(scopedDisplayRates(all,'A').map(r=>r.source)).toEqual(['Global','Company A']);expect(scopedDisplayRates(all).map(r=>r.source)).toEqual(['Global']);});
 it('uses the selected organization override before a global reference',()=>{expect(displayAmount(12200,'SYP','USD',scopedDisplayRates(all,'A'),today).value).toBe(100);expect(displayAmount(20000,'SYP','USD',scopedDisplayRates(all,'B'),today).value).toBe(100);});
 it('keeps unavailable or null values unknown instead of zero',()=>{expect(displayAmount(null,'SAR','USD',[],today).value).toBeNull();expect(displayAmount('','SAR','USD',[],today).value).toBeNull();});
});

describe('primary currency display',()=>{
 it('converts foreign source values to the selected primary currency',()=>{expect(displayAmount(100,'USD','PRIMARY',[],today,'SAR')).toMatchObject({value:375,currency:'SAR',missing:false});});
 it('uses the selected company reference for cross-currency display without altering records',()=>{const rates:DisplayFxRate[]=[{from_currency:'USD',to_currency:'SYP',rate:122,valuation_date:today,source:'Company A'}];expect(displayAmount(375,'SAR','PRIMARY',rates,today,'SYP')).toMatchObject({value:12200,currency:'SYP'});});
});
