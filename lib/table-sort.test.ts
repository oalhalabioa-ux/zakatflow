import {describe,it,expect} from 'vitest';
import {sortTableRows} from './table-sort';
import {displayAmount} from './display-currency';
describe('financial table sorting',()=>{
  it('sorts monetary values numerically without mutating the filtered source',()=>{
    const values=[1000000,900,10000];
    expect(sortTableRows(values,x=>x,'ascending','ar')).toEqual([900,10000,1000000]);
    expect(values).toEqual([1000000,900,10000]);
  });
  it.each(['ascending','descending'] as const)('keeps absent amounts last in %s order',direction=>{
    const rows=[{id:1,value:null},{id:2,value:0},{id:3,value:20},{id:4,value:undefined}];
    const sorted=sortTableRows(rows,r=>r.value,direction,'en');
    expect(sorted.slice(-2).map(r=>r.id)).toEqual([1,4]);
    expect(sorted[0].value).toBe(direction==='ascending'?0:20);
  });
  it('orders mixed currencies by the displayed amount rather than their source value',()=>{
    const rows=[{currency:'USD',amount:100},{currency:'SAR',amount:200}];
    const sorted=sortTableRows(rows,r=>displayAmount(r.amount,r.currency,'PRIMARY',[],'2026-11-02','SAR').value,'ascending','ar');
    expect(sorted.map(r=>r.currency)).toEqual(['SAR','USD']);
  });
  it('uses natural document numbers and stable equal values',()=>{
    expect(sortTableRows(['FN-10','FN-2','FN-1'],x=>x,'ascending','en')).toEqual(['FN-1','FN-2','FN-10']);
    const rows=[{id:'first',v:50},{id:'second',v:50}];
    expect(sortTableRows(rows,r=>r.v,'descending','ar')).toEqual(rows);
  });
  it('orders canonical dates before the caller slices a page',()=>{
    const rows=Array.from({length:35},(_,i)=>({date:new Date(Date.UTC(2026,0,35-i)).toISOString().slice(0,10)}));
    const sorted=sortTableRows(rows,r=>r.date,'ascending','en');
    expect(sorted.slice(0,20)[0].date).toBe('2026-01-01');
    expect(sorted.slice(20)[0].date).toBe('2026-01-21');
  });
});
