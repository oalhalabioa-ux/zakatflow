import{describe,it,expect}from'vitest';
import{statementHierarchy}from'../lib/financial-statement-hierarchy';
import{positionPreviewRows}from'../lib/financial-position-preview';
import{POSITION_LINES}from'../lib/financial-reporting-demo';
const rows=[{id:'assets'},{id:'current',parentId:'assets'},{id:'bank',parentId:'current'},{id:'current-total',parentId:'current'},{id:'noncurrent',parentId:'assets'},{id:'equipment',parentId:'noncurrent'},{id:'liabilities'}];
describe('nested financial-position disclosure',()=>{
 it('uses the existing preview aggregates and comparison values for compact rows',()=>{const p=positionPreviewRows(POSITION_LINES);expect(p[0]).toMatchObject({id:'assets',current:207.82,previous:187.5});expect(p.find(r=>r.id==='ca')?.collapsedTotals).toMatchObject({current:128.6,previous:111.9});expect(p.find(r=>r.id==='ca-total')?.parentId).toBe('ca');expect(p.filter(r=>r.id==='assets')).toHaveLength(1)});
 it('preserves nested preview disclosure and leaves supplied statement lines untouched',()=>{const before=JSON.stringify(POSITION_LINES),p=positionPreviewRows(POSITION_LINES),h=statementHierarchy(p);expect(h.hidden('cash',new Set(['assets']))).toBe(true);expect(h.hidden('equity',new Set(['assets']))).toBe(false);expect(JSON.stringify(POSITION_LINES)).toBe(before)});
 it('hides all descendants including nested totals without hiding the aggregate itself',()=>{const h=statementHierarchy(rows),closed=new Set(['assets']);expect(h.descendants.get('assets')).toEqual([1,2,3,4,5]);expect(h.hidden('bank',closed)).toBe(true);expect(h.hidden('current-total',closed)).toBe(true);expect(h.hidden('assets',closed)).toBe(false);expect(h.hidden('liabilities',closed)).toBe(false)});
 it('retains an inner fold when the outer branch is reopened',()=>{const h=statementHierarchy(rows),closed=new Set(['assets','current']);closed.delete('assets');expect(h.hidden('current',closed)).toBe(false);expect(h.hidden('bank',closed)).toBe(true);expect(h.hidden('current-total',closed)).toBe(true);expect(h.hidden('equipment',closed)).toBe(false)});
 it('rejects duplicate, orphaned and cyclic row relationships',()=>{expect(()=>statementHierarchy([{id:'a'},{id:'a'}])).toThrow('DUPLICATE');expect(()=>statementHierarchy([{id:'a',parentId:'missing'}])).toThrow('UNKNOWN');expect(()=>statementHierarchy([{id:'a',parentId:'b'},{id:'b',parentId:'a'}])).toThrow('CYCLIC')});
});
