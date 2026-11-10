import {describe,it,expect} from 'vitest';
import {suggestedFiscalStart,calendarFromContext,fiscalCalendarLocked,fiscalReferencesMatch,fiscalYearRows,retainedAccountCandidates,type FiscalManagementContext} from '../lib/financial-fiscal-years';
const base: FiscalManagementContext={organizationId:'a',calendar:{start_month:1,start_day:1,retained_earnings_account:'3300',version:1},period:{start:'2026-01-01',end:'2026-12-31'},closures:[],canConfigure:true,canClose:true,references:[],asOf:'2026-11-04'};
describe('Fiscal year display projection',()=>{
 it('offers only eligible detailed retained-profit accounts, never roots or foreign structures',()=>{
  const chart=[
   {code:'3300',isSystem:true,isActive:true,isPostable:true,reportingCode:'3300'},
   {code:'330001',ar:'أرباح محتجزة',en:'Retained earnings',isSystem:false,isActive:true,isPostable:true,reportingCode:'3300'},
   {code:'330002',isSystem:false,isActive:false,isPostable:true,reportingCode:'3300'},
   {code:'330003',isSystem:false,isActive:true,isPostable:false,reportingCode:'3300'},
   {code:'320001',isSystem:false,isActive:true,isPostable:true,reportingCode:'3200'},
  ];
  expect(retainedAccountCandidates(chart)).toEqual([{code:'330001',ar:'أرباح محتجزة',en:'Retained earnings'}]);
 });
 it.each([[1,'2026-01-01','2026-12-31'],[7,'2026-07-01','2027-06-30']])('projects independent calendar starting month %s without changing context', (month,start,end)=>{
  const context={...structuredClone(base),calendar:{...base.calendar!,start_month:Number(month)}};const saved=JSON.stringify(context);const rows=fiscalYearRows(context);
  expect(rows).toHaveLength(5);expect(rows.find(r=>r.phase==='CURRENT')).toMatchObject({start,end,recorded:false,status:'OPEN',canClose:false});
  expect(rows.filter(r=>r.phase==='PREVIOUS').every(r=>r.canClose)).toBe(true);expect(rows.filter(r=>r.phase==='FUTURE').every(r=>!r.canClose)).toBe(true);expect(JSON.stringify(context)).toBe(saved);
 });
 it('uses saved closure state and keeps old periods outside the display window',()=>{
  const context={...base,closures:[{id:'closure',start:'2020-01-01',end:'2020-12-31',version:2,status:'CLOSED' as const}],references:[{start:'2018-07-01',source:'budget' as const}]};const rows=fiscalYearRows(context);
  expect(rows.find(r=>r.start==='2020-01-01')).toMatchObject({status:'CLOSED',recorded:true,canClose:false,canReopen:true});
  expect(rows.find(r=>r.start==='2018-07-01')).toMatchObject({mismatch:true,end:null,canClose:false});expect(fiscalCalendarLocked(context)).toBe(true);
 });
 it('suggests January 1 without creating a fiscal calendar or accounts',()=>{
  const unknown={...base,calendar:null,period:null};const snapshot=JSON.stringify(unknown);
  expect(suggestedFiscalStart(unknown.calendar)).toEqual({month:'1',day:'1'});
  expect(fiscalYearRows(unknown)).toEqual([]);
  expect(JSON.stringify(unknown)).toBe(snapshot);
  expect(suggestedFiscalStart({...base.calendar!,start_month:7,start_day:1})).toEqual({month:'7',day:'1'});
 });
 it('keeps read-only users from close/reopen and detects budget date mismatches',()=>{
  const context={...base,canClose:false,closures:[{id:'close',start:'2024-01-01',end:'2024-12-31',version:1,status:'CLOSED' as const}]};expect(fiscalYearRows(context).every(r=>!r.canClose&&!r.canReopen)).toBe(true);
  expect(fiscalReferencesMatch(calendarFromContext(base)!,[{source:'budget',start:'2026-07-01'}])).toBe(false);expect(fiscalReferencesMatch(calendarFromContext(base)!,[{source:'budget',start:'2026-01-01'}])).toBe(true);
 });
 it('keeps setup policies editable using the server activity decision and separates configuration locks from year closure',()=>{
  const setup={...base,setupLockReason:null,references:[{source:'policy' as const,start:'2026-01-01',status:'APPROVED'}]};
  expect(fiscalCalendarLocked(setup)).toBe(false);
  for(const setupLockReason of ['ACTIVITY','OPENING_REVIEW','BUDGET_REVIEW','CLOSURE'] as const){
   const locked={...setup,setupLockReason};expect(fiscalCalendarLocked(locked)).toBe(true);
   expect(fiscalYearRows(locked).find(r=>r.phase==='CURRENT')?.status).toBe('OPEN');
  }
  const oldServer={...setup};delete (oldServer as Partial<typeof oldServer>).setupLockReason;expect(fiscalCalendarLocked(oldServer)).toBe(true);
 });
 it('preserves the shared leap-day calendar and clamps excessive display ranges',()=>{
  const context={...base,calendar:{...base.calendar!,start_month:2,start_day:29}};expect(fiscalYearRows(context).find(r=>r.start==='2024-02-29')?.end).toBe('2025-02-27');expect(fiscalYearRows(base,100)).toHaveLength(21);
 });
});
