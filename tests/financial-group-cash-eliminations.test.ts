import {describe,it,expect} from 'vitest';
import {previewGroupCashEliminations as preview} from '../lib/financial-group-cash-eliminations';
import {sourceBoundGroupFixture} from './financial-reporting/group-source-bound-fixture';
function fixture(){
 const f=sourceBoundGroupFixture();
 f.sources.forEach((p,i)=>{
  const direction=i===0?'INFLOW':'OUTFLOW';p.events[0].lines[0].cashDirection=direction;
  const r=p.policy.rules[0];r.cashDirection=direction;r.cashActivity=i===0?'FINANCING':'INVESTING';
  if(i===0)r.debitAccountId='100001';else r.creditAccountId='100001';
  p.controls={cashClosing:i===0?'550.0000':'400.0000'};
 });
 // The original expense is 100. Only 50 of it is reciprocally documented.
 const entry={...f.entry,kind:'INTERCOMPANY_CASH' as const,documentMatchId:'60000000-0000-4000-8000-000000000001',
  debitSource:f.ref(1,'100001'),creditSource:f.ref(0,'100001')};
 const documents=[{id:entry.documentMatchId,status:'APPROVED',leftOrganizationId:f.sources[0].organizationId,rightOrganizationId:f.sources[1].organizationId,
  leftEventId:f.sources[0].events[0].id,rightEventId:f.sources[1].events[0].id,evidenceReference:'Actual reciprocal transfer documents',
  approvedBy:'70000000-0000-4000-8000-000000000001',approvedAt:'2026-12-31T00:00:00Z',sourceCurrent:true}];
 return{...f,entry,documents};
}
describe('source-bound internal cash elimination worksheet',()=>{
 it('removes paired flows from their respective activities while retaining external flows and cash balances',()=>{
  const f=fixture(),before=structuredClone(f.sources),r=preview(f.control,f.sources,[f.entry],f.documents);
  expect(r.rows).toEqual([{activity:'OPERATING',before:'0.0000',adjustment:'0.0000',after:'0.0000'},
   {activity:'INVESTING',before:'-100.0000',adjustment:'50.0000',after:'-50.0000'},
   {activity:'FINANCING',before:'50.0000',adjustment:'-50.0000',after:'0.0000'}]);
  expect([r.opening,r.movement,r.closing,r.consolidated]).toEqual(['1000.0000','-50.0000','950.0000',false]);expect(f.sources).toEqual(before);expect([r.eliminatedInflow,r.eliminatedOutflow]).toEqual(['50.0000','50.0000']);
 });
 it('requires current approved documentary pairing of the exact two source events',()=>{
  for(const change of ['REVOKED','stale','other']){const f=fixture();if(change==='REVOKED')f.documents[0].status='REVOKED';else if(change==='stale')f.documents[0].sourceCurrent=false;else f.documents[0].leftEventId='80000000-0000-4000-8000-000000000001';
   expect(()=>preview(f.control,f.sources,[f.entry],f.documents)).toThrow(/DOCUMENT_NOT_APPROVED|DOCUMENT_MISMATCH/);}
 });
 it('rejects duplicate entries and reuse beyond an actual cash leg',()=>{
  const f=fixture();expect(()=>preview(f.control,f.sources,[f.entry,f.entry],f.documents)).toThrow('GROUP_CASH_DUPLICATE_ADJUSTMENT');
  expect(()=>preview(f.control,f.sources,[f.entry,{...f.entry,id:'20000000-0000-4000-8000-000000000009'}],f.documents)).toThrow('GROUP_CASH_EXCEEDS_SOURCE');
 });
 it('rejects a noncash account, wrong direction, or out-of-period original flow',()=>{
  const f=fixture();expect(()=>preview(f.control,f.sources,[{...f.entry,debitSource:f.ref(1,'610001')}],f.documents)).toThrow('GROUP_CASH_SOURCE_UNAVAILABLE');
  expect(()=>preview(f.control,f.sources,[{...f.entry,debitSource:f.entry.creditSource,creditSource:f.entry.debitSource}],f.documents)).toThrow('GROUP_CASH_SOURCE_UNAVAILABLE');
  f.control.from='2026-04-01';f.sources.forEach(p=>p.from=f.control.from);expect(()=>preview(f.control,f.sources,[f.entry],f.documents)).toThrow('GROUP_CASH_SOURCE_UNAVAILABLE');
 });
 it('rejects zero and excessive amounts',()=>{const f=fixture();for(const amount of ['0','101'])expect(()=>preview(f.control,f.sources,[{...f.entry,amount}],f.documents)).toThrow('GROUP_CASH_EXCEEDS_SOURCE')});
});
