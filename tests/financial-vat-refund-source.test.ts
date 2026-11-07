import {beforeEach,describe,expect,it,vi} from 'vitest';

const org='10000000-0000-4000-8000-000000000001';
const root='20000000-0000-4000-8000-000000000002';
const reversal='30000000-0000-4000-8000-000000000003';
const obligation='40000000-0000-4000-8000-000000000004';
const s=vi.hoisted(()=>({
 member:true,allowed:true,revoke:false,authReads:0,sourceReads:0,
 failures:[] as string[],
 links:[] as {event_id:string;organization_id:string;link_type:string;related_event_id:string|null}[],
 obligations:[] as {id:string;event_id:string;organization_id:string;obligation_key:string;
  obligation_type:string;settleable_base_amount:string}[],
 originals:[] as {id:string;organization_id:string}[],
}));
const client={
 from(table:string){
  const filters:{[key:string]:string[]|string|number}={};
  const chain={
   select(){return chain},
   eq(k:string,v:string){filters[k]=v;return chain},
   gt(k:string,v:number){filters['gt:'+k]=v;return chain},
   in(k:string,v:string[]){filters[k]=v;return chain},
   async maybeSingle(){
    s.authReads++;
    return{data:s.member&&!(s.revoke&&s.authReads>1)?{organization_id:org}:null,error:null};
   },
   async limit(n:number){
    s.sourceReads++;
    if(s.failures.includes(table))return{data:null,error:{message:'private database error'}};
    const rows=table==='financial_event_links'?s.links:
     table==='financial_event_obligations'?s.obligations:s.originals;
    const subset=rows.filter(r=>Object.entries(filters).every(([k,v])=>
     k.startsWith('gt:')?Number((r as Record<string,unknown>)[k.slice(3)])>Number(v):
     Array.isArray(v)?v.includes(String((r as Record<string,unknown>)[k])):
     (r as Record<string,unknown>)[k]===v));
    return{data:subset.slice(0,n),error:null};
   },
  };return chain;
 },
 async rpc(){return{data:s.allowed,error:null}},
};
vi.mock('../services/auth',()=>({requireUser:async()=>({user:{id:'viewer'},supabase:client})}));
import {observeVatRefundSources} from '../services/financial-vat-refund-source';

const line=(eventId:string,sign:1|-1=1,amount='46.0000')=>({
 id:eventId+':refund:'+obligation,classificationId:'VAT_NOTE_REFUND_RECEIVABLE',
 baseAmount:amount,cashDirection:'NON_CASH' as const,recognitionSign:sign,
});
const journal=(id:string,sourceLines:ReturnType<typeof line>[]=[])=>
 ({id,organizationId:org,date:'2026-03-01',status:'POSTED' as const,sourceLines});
const refund=()=>({id:obligation,event_id:root,organization_id:org,
 obligation_key:'note-refund',obligation_type:'RECEIVABLE',settleable_base_amount:'46.0000'});
beforeEach(()=>{
 Object.assign(s,{member:true,allowed:true,revoke:false,authReads:0,sourceReads:0,
  failures:[],links:[],obligations:[],originals:[
   {id:root,organization_id:org},{id:reversal,organization_id:org}]});
});
describe('real RLS synthetic VAT-note refund source verification',()=>{
 it('certifies absence of synthetic lines only after checking the source obligations table',async()=>{
  const evidence=await observeVatRefundSources(org,[journal(root)]);
  expect(evidence).toMatchObject({eventsObserved:1,refundPartsMatched:0,refundReversalSignsMatched:true});
  expect(s.sourceReads).toBe(2);
  expect(s.authReads).toBe(2);
 });
 it('matches the exact original obligation amount, tax class and positive sign',async()=>{
  s.obligations=[refund()];
  const evidence=await observeVatRefundSources(org,[journal(root,[line(root)])]);
  expect(evidence).toMatchObject({eventsObserved:1,refundPartsMatched:1});
 });
 it('checks reverse-link and original event under RLS, then requires a negative synthetic sign',async()=>{
  s.obligations=[refund()];
  s.links=[{event_id:reversal,organization_id:org,link_type:'REVERSAL_OF',related_event_id:root}];
  const result=await observeVatRefundSources(org,[journal(reversal,[line(reversal,-1)])]);
  expect(result).toMatchObject({eventsObserved:1,refundPartsMatched:1,refundReversalSignsMatched:true});
  await expect(observeVatRefundSources(org,[journal(reversal,[line(reversal,1)])]))
   .rejects.toThrow('REPORTING_REFUND_SOURCE_MISMATCH');
 });
 it('rejects a changed base amount, obligation class, or a foreign synthetic ID',async()=>{
  s.obligations=[refund()];
  await expect(observeVatRefundSources(org,[journal(root,[line(root,1,'45.9999')])]))
   .rejects.toThrow('REPORTING_REFUND_SOURCE_MISMATCH');
  const wrong=line(root);wrong.classificationId='VAT_NOTE_REFUND_PAYABLE';
  await expect(observeVatRefundSources(org,[journal(root,[wrong])]))
   .rejects.toThrow('REPORTING_REFUND_SOURCE_MISMATCH');
  const foreign=line(root);foreign.id=reversal+':refund:'+obligation;
  await expect(observeVatRefundSources(org,[journal(root,[foreign])]))
   .rejects.toThrow('REPORTING_REFUND_SOURCE_MISMATCH');
 });
 it('refuses missing obligations, duplicate synthetic parts, or extra phantom parts',async()=>{
  s.obligations=[refund()];
  await expect(observeVatRefundSources(org,[journal(root,[])]))
   .rejects.toThrow('REPORTING_REFUND_SOURCE_INCOMPLETE');
  await expect(observeVatRefundSources(org,[journal(root,[line(root),line(root)])]))
   .rejects.toThrow('REPORTING_REFUND_SOURCE_INCOMPLETE');
  s.obligations=[];
  await expect(observeVatRefundSources(org,[journal(root,[line(root)])]))
   .rejects.toThrow('REPORTING_REFUND_SOURCE_INCOMPLETE');
 });
 it('refuses duplicate reversal links and invisible or cross-company original events',async()=>{
  s.obligations=[refund()];
  s.links=[{event_id:reversal,organization_id:org,link_type:'REVERSAL_OF',related_event_id:root}];
  s.originals=[];
  await expect(observeVatRefundSources(org,[journal(reversal,[line(reversal,-1)])]))
   .rejects.toThrow('REPORTING_REFUND_SOURCE_INCOMPLETE');
  s.originals=[{id:root,organization_id:org}];
  s.links.push({...s.links[0]});
  await expect(observeVatRefundSources(org,[journal(reversal,[line(reversal,-1)])]))
   .rejects.toThrow('REPORTING_REFUND_SOURCE_INCOMPLETE');
 });
 it('checks RLS and financial_core.view before and after every source read',async()=>{
  s.member=false;
  await expect(observeVatRefundSources(org,[journal(root)])).rejects.toThrow('REPORTING_REFUND_ACCESS_DENIED');
  expect(s.sourceReads).toBe(0);
  s.member=true;s.allowed=false;
  await expect(observeVatRefundSources(org,[journal(root)])).rejects.toThrow('REPORTING_REFUND_ACCESS_DENIED');
  expect(s.sourceReads).toBe(0);
  s.allowed=true;s.revoke=true;
  await expect(observeVatRefundSources(org,[journal(root)])).rejects.toThrow('REPORTING_REFUND_ACCESS_DENIED');
 });
 it('fails closed on source-query errors without leaking database details',async()=>{
  s.failures=['financial_event_obligations'];
  await expect(observeVatRefundSources(org,[journal(root)])).rejects.toThrow('REPORTING_REFUND_SOURCE_UNAVAILABLE');
 });
 it('does not mislabel an empty company as a certified refund or general ledger revision',async()=>{
  const result=await observeVatRefundSources(org,[]);
  expect(result).toMatchObject({eventsObserved:0,refundPartsMatched:0});
  expect(JSON.stringify(result)).not.toMatch(/approved|netProfit|atomicLedger/);
 });
});
