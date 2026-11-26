import {expect,it} from 'vitest';
import {firstNisab,type Movement,type Quote} from '../lib/first-nisab';
const day=(n:number)=>'2025-02-'+String(n).padStart(2,'0');
const movement=(n:number,units:string,asset:Movement['asset']='GOLD'):Movement=>({id:'m'+n,date:day(n),units,asset});
const quote=(n:number,price:string):Quote=>({id:'q'+n,date:day(n),price,asset:'GOLD',source:'fixture'});
it('proves the first closing balance over Nisab with qualifying movements and the dated quote',()=>{
 const result=firstNisab([movement(1,'40'),movement(4,'50')],[quote(4,'425')],'GOLD',day(5));
 expect(result).toMatchObject({status:'PROVEN',day:day(4),value:'38250',threshold:'36125',movementIds:['m1','m4']});
});
it('finds a price-only crossing on a day without movements',()=>{
 expect(firstNisab([movement(1,'850','CASH')],[quote(1,'11'),quote(2,'10')],'GOLD',day(2))).toMatchObject({status:'PROVEN',day:day(2)});
});
it('requires the missing earlier quote before claiming a later crossing',()=>{
 expect(firstNisab([movement(1,'850','CASH')],[quote(2,'10')],'GOLD',day(2))).toMatchObject({status:'REVIEW',day:day(1)});
});
it('preserves the first crossing when a withdrawal and independent addition take the pool below and back above it',()=>{
 const events=[movement(1,'90'),movement(2,'-20'),movement(3,'25')];
 expect(firstNisab(events,[quote(1,'425')],'GOLD',day(4))).toMatchObject({status:'PROVEN',day:day(1)});
});
it('requires review of conflicting quotes and rejects negative inventory',()=>{
 expect(firstNisab([movement(1,'85')],[quote(1,'1'),quote(1,'2')],'GOLD',day(1)).status).toBe('REVIEW');
 expect(firstNisab([movement(1,'-5')],[],'GOLD',day(1)).status).toBe('REVIEW');
});

// Compare the documented settings without writing a new policy or resetting a live cycle.
import {nextUnassessedHawlPeriod} from '../engine/hawl';
it('quantifies the two Nisab continuity choices at the original anniversary',()=>{
 // 90 g held Feb 1, 20 g withdrawn Feb 2, 25 g added Feb 3: 70 old + 25 new.
 const asOf='2026-02-01';
 const amount=(origin:string,grams:number)=>nextUnassessedHawlPeriod('GREGORIAN',origin,null,asOf).completed?grams*400*.025:0;
 expect(amount(day(3),70)+amount(day(3),25)).toBe(0); // continuous, restart on reattainment
 expect(amount(day(1),70)+amount(day(3),25)).toBe(700); // start/end with independent addition
 expect(amount(day(1),95)).toBe(950); // start/end with whole pool joined
});
it('quantifies an independent addition while the pool stays above Nisab',()=>{
 const asOf='2026-02-01';
 expect(nextUnassessedHawlPeriod('GREGORIAN',day(1),null,asOf).completed).toBe(true);
 expect(nextUnassessedHawlPeriod('GREGORIAN',day(3),null,asOf).completed).toBe(false);
 expect(90*400*.025).toBe(900);
 expect((90+25)*400*.025).toBe(1150);
});
