import {describe,it,expect} from 'vitest';
import {groupStatementWorksheet} from '../lib/financial-group-statement-worksheet';
import {sourceBoundGroupFixture} from './financial-reporting/group-source-bound-fixture';
function fixture(){
 const f=sourceBoundGroupFixture();
 const entry={...f.entry,documentMatchId:'60000000-0000-4000-8000-000000000001'};
 const documents=[{id:entry.documentMatchId,status:'APPROVED',leftOrganizationId:entry.debitSource.organizationId,rightOrganizationId:entry.creditSource.organizationId,leftEventId:entry.debitSource.eventId,rightEventId:entry.creditSource.eventId,evidenceReference:'Approved reciprocal original documents',approvedBy:'70000000-0000-4000-8000-000000000001',approvedAt:'2026-12-31T00:00:00Z',sourceCurrent:true}];
 return{...f,entry,documents};
}
const value=(rows:{key:string;before:string;adjustment:string;after:string}[],key:string)=>rows.find(r=>r.key===key)!;
describe('verified group statement worksheet',()=>{
 it('reduces reciprocal receivables/payables without changing income, cash or company sources',()=>{
  const f=fixture(),original=structuredClone(f.sources),r=groupStatementWorksheet(f.control,f.sources,[f.entry],f.documents);
  expect(value(r.position,'assets').adjustment).toBe('-50.0000');expect(value(r.position,'liabilities').adjustment).toBe('-50.0000');
  expect(value(r.income,'netProfit').adjustment).toBe('0.0000');expect(r.cash.every(r=>r.adjustment==='0.0000')).toBe(true);
  expect(f.sources).toEqual(original);expect(r.consolidated).toBe(false);
 });
 it('eliminates matched income and expenses while preserving group profit',()=>{
  const f=fixture();f.entry={...f.entry,kind:'INTERCOMPANY_INCOME',debitSource:f.ref(0,'410001'),creditSource:f.ref(1,'610001')};
  const r=groupStatementWorksheet(f.control,f.sources,[f.entry],f.documents);
  expect(value(r.income,'revenue').adjustment).toBe('-50.0000');expect(value(r.income,'operatingExpenses').adjustment).toBe('-50.0000');
  expect(value(r.income,'netProfit').adjustment).toBe('0.0000');expect(value(r.position,'equity').adjustment).toBe('0.0000');
 });
 it('removes internal cash from its original activities without changing total cash',()=>{
  const f=fixture();f.sources.forEach((p,i)=>{
   const direction=i===0?'INFLOW':'OUTFLOW';p.events[0].lines[0].cashDirection=direction;
   p.policy.rules[0].cashDirection=direction;p.policy.rules[0].cashActivity=i===0?'FINANCING':'INVESTING';
   if(i===0)p.policy.rules[0].debitAccountId='100001';else p.policy.rules[0].creditAccountId='100001';
   p.controls={cashClosing:i===0?'550.0000':'400.0000'};
  });
  const entry={...f.entry,kind:'INTERCOMPANY_CASH',debitSource:f.ref(1,'100001'),creditSource:f.ref(0,'100001')};
  const r=groupStatementWorksheet(f.control,f.sources,[entry],f.documents);
  expect(value(r.cash,'investing').after).toBe('-50.0000');expect(value(r.cash,'financing').after).toBe('0.0000');
  expect(value(r.cash,'closing').after).toBe('950.0000');expect(value(r.cash,'movement').after).toBe('-50.0000');
 });
 it('keeps selected-period income separate from fiscal profit',()=>{
  const f=fixture();f.control.from='2026-12-01';f.sources.forEach(s=>s.from=f.control.from);
  const r=groupStatementWorksheet(f.control,f.sources,[],[]);
  expect(value(r.income,'netProfit').after).toBe('0.0000');expect(value(r.position,'fiscalProfit').after).not.toBe('0.0000');
 });
 it('does not issue even a statement worksheet for missing, revoked or stale documentary evidence',()=>{
  const f=fixture();expect(()=>groupStatementWorksheet(f.control,f.sources,[{...f.entry,documentMatchId:undefined}],[])).toThrow('GROUP_BATCH_DOCUMENT_NOT_APPROVED');
  for(const change of [{status:'REVOKED'},{sourceCurrent:false}])expect(()=>groupStatementWorksheet(f.control,f.sources,[f.entry],[{...f.documents[0],...change}])).toThrow('GROUP_ADJUSTMENT_DOCUMENT_NOT_APPROVED');
 });
 it('rejects duplicate entry IDs and unauthorized members',()=>{
  const f=fixture();expect(()=>groupStatementWorksheet(f.control,f.sources,[f.entry,f.entry],f.documents)).toThrow('GROUP_ADJUSTMENT_DUPLICATE');
  f.control.authorizedOrganizationIds=f.control.authorizedOrganizationIds.slice(0,1);
  expect(()=>groupStatementWorksheet(f.control,f.sources,[],[])).toThrow();
 });
});
