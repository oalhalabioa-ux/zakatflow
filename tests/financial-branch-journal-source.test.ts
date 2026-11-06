import {beforeEach,describe,expect,it,vi} from 'vitest';

const org='10000000-0000-4000-8000-000000000001';
const hq='20000000-0000-4000-8000-000000000002';
const branch='30000000-0000-4000-8000-000000000003';
const idA='40000000-0000-4000-8000-000000000004';
const idB='50000000-0000-4000-8000-000000000005';
const idC='60000000-0000-4000-8000-000000000006';

const s=vi.hoisted(()=>({
 member:true,allowed:true,revoked:false,authCount:0,rpcs:[] as string[],reads:0,
 error:false,
 events:[] as {id:string;organization_id:string;entity_id:string|null;event_date:string;status:string}[],
 entities:[] as {id:string;organization_id:string;entity_type:string;active:boolean}[],
}));
const client={
 from(table:string){
  const chain={
   values:[] as string[],
   select(){return chain},
   eq(){return chain},
   in(_column:string,ids:string[]){chain.values=ids;return chain},
   async maybeSingle(){s.authCount++;return{data:s.member&&!(s.revoked&&s.authCount>1)?{organization_id:org}:null,error:null}},
   async limit(){
    s.reads++;
    if(s.error)return{data:null,error:{message:'private database error'}};
    return{data:table==='organization_entities'?s.entities:s.events.filter(e=>chain.values.includes(e.id)),error:null};
   },
  };return chain;
 },
 async rpc(name:string){s.rpcs.push(name);return{data:s.allowed,error:null}},
};
vi.mock('../services/auth',()=>({requireUser:async()=>({user:{id:'user'},supabase:client})}));
import {observeCanonicalJournalBranches} from '../services/financial-branch-journal-source';

const journals=()=>[
 {id:idA,organizationId:org,date:'2026-01-01',status:'POSTED' as const},
 {id:idB,organizationId:org,date:'2026-01-02',status:'POSTED' as const},
 {id:idC,organizationId:org,date:'2026-01-03',status:'POSTED' as const},
];
beforeEach(()=>{
 Object.assign(s,{member:true,allowed:true,revoked:false,authCount:0,rpcs:[],reads:0,error:false,
  events:[
   {id:idA,organization_id:org,entity_id:null,event_date:'2026-01-01',status:'ACTUAL'},
   {id:idB,organization_id:org,entity_id:hq,event_date:'2026-01-02',status:'ACTUAL'},
   {id:idC,organization_id:org,entity_id:branch,event_date:'2026-01-03',status:'REVERSED'},
  ],
  entities:[
   {id:hq,organization_id:org,entity_type:'COMPANY',active:true},
   {id:branch,organization_id:org,entity_type:'BRANCH',active:true},
  ]});
});
describe('canonical financial journal branch evidence',()=>{
 it('observes HQ null and COMPANY, plus separately attributed BRANCH, with double authorization',async()=>{
  const result=await observeCanonicalJournalBranches(org,journals());
  expect(result).toEqual({status:'RLS_MATCHED_JOURNAL_REFERENCES_ONLY',organizationId:org,
   links:[{journalId:idA,branchId:null,scope:'ORGANIZATION_DIRECT'},
    {journalId:idB,branchId:null,scope:'ORGANIZATION_DIRECT'},
    {journalId:idC,branchId:branch,scope:'BRANCH'}]});
  expect(s.authCount).toBe(2);
  expect(s.rpcs).toEqual(['financial_core_can','financial_core_can']);
 });
 it('does not return incomplete source when RLS hides a posted journal',async()=>{
  s.events=s.events.slice(0,2);
  await expect(observeCanonicalJournalBranches(org,journals())).rejects.toThrow('BRANCH_JOURNAL_SOURCE_INCOMPLETE');
 });
 it('does not infer branch ownership for an unknown, inactive or foreign entity',async()=>{
  s.entities=s.entities.filter(e=>e.id!==branch);
  await expect(observeCanonicalJournalBranches(org,journals())).rejects.toThrow('BRANCH_JOURNAL_ENTITY_UNVERIFIED');
  s.entities.push({id:branch,organization_id:org,entity_type:'BRANCH',active:false});
  await expect(observeCanonicalJournalBranches(org,journals())).rejects.toThrow('BRANCH_JOURNAL_ENTITY_UNVERIFIED');
 });
 it('refuses stale dates, wrong status, duplicate ids and an unknown organization',async()=>{
  const stale=journals();stale[0]={...stale[0],date:'2026-02-01'};
  await expect(observeCanonicalJournalBranches(org,stale)).rejects.toThrow('BRANCH_JOURNAL_SOURCE_INCOMPLETE');
  const duplicate=journals();duplicate[1]={...duplicate[1],id:idA};
  await expect(observeCanonicalJournalBranches(org,duplicate)).rejects.toThrow('BRANCH_JOURNAL_SOURCE_INVALID');
  s.events[0].status='DRAFT';
  await expect(observeCanonicalJournalBranches(org,journals())).rejects.toThrow('BRANCH_JOURNAL_SOURCE_INCOMPLETE');
  await expect(observeCanonicalJournalBranches('wrong',journals())).rejects.toThrow('BRANCH_JOURNAL_SCOPE_INVALID');
 });
 it('checks the financial permission before reading metadata and again after read',async()=>{
  s.member=false;
  await expect(observeCanonicalJournalBranches(org,journals())).rejects.toThrow('BRANCH_JOURNAL_ACCESS_DENIED');
  expect(s.reads).toBe(0);
  s.member=true;s.allowed=false;
  await expect(observeCanonicalJournalBranches(org,journals())).rejects.toThrow('BRANCH_JOURNAL_ACCESS_DENIED');
  expect(s.reads).toBe(0);
  s.allowed=true;s.revoked=true;
  await expect(observeCanonicalJournalBranches(org,journals())).rejects.toThrow('BRANCH_JOURNAL_ACCESS_DENIED');
 });
 it('fails closed on database error without leaking its details',async()=>{
  s.error=true;
  await expect(observeCanonicalJournalBranches(org,journals())).rejects.toThrow('BRANCH_JOURNAL_SOURCE_UNAVAILABLE');
 });
 it('returns only evidence for an empty organization, not approved financial figures',async()=>{
  s.events=[];s.entities=[];
  const result=await observeCanonicalJournalBranches(org,[]);
  expect(result).toEqual({status:'RLS_MATCHED_JOURNAL_REFERENCES_ONLY',organizationId:org,links:[]});
  expect(JSON.stringify(result)).not.toMatch(/opening|income|debit|credit|netProfit/);
 });
});
