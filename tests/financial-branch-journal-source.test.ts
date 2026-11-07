import {beforeEach,describe,expect,it,vi} from 'vitest';

const org='10000000-0000-4000-8000-000000000001';
const hq='20000000-0000-4000-8000-000000000002';
const branch='30000000-0000-4000-8000-000000000003';
const idA='40000000-0000-4000-8000-000000000004';
const idB='50000000-0000-4000-8000-000000000005';
const idC='60000000-0000-4000-8000-000000000006';
const lineA='70000000-0000-4000-8000-000000000007';
const lineB='80000000-0000-4000-8000-000000000008';
const lineC='90000000-0000-4000-8000-000000000009';

const s=vi.hoisted(()=>({
 member:true,allowed:true,revoked:false,authCount:0,rpcs:[] as string[],reads:0,
 error:false,
 events:[] as {id:string;organization_id:string;entity_id:string|null;event_date:string;status:string}[],
 entities:[] as {id:string;organization_id:string;entity_type:string;active:boolean}[],
 lines:[] as {id:string;event_id:string;organization_id:string}[],
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
    if(table==='organization_entities')return{data:s.entities,error:null};
    if(table==='financial_event_lines')return{data:s.lines.filter(l=>chain.values.includes(l.event_id)),error:null};
    return{data:s.events.filter(e=>chain.values.includes(e.id)),error:null};
   },
  };return chain;
 },
 async rpc(name:string){s.rpcs.push(name);return{data:s.allowed,error:null}},
};
vi.mock('../services/auth',()=>({requireUser:async()=>({user:{id:'user'},supabase:client})}));
import {observeCanonicalJournalBranches,observeCanonicalJournalLineage} from '../services/financial-branch-journal-source';

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
  ],
  lines:[
   {id:lineA,event_id:idA,organization_id:org},
   {id:lineB,event_id:idB,organization_id:org},
   {id:lineC,event_id:idC,organization_id:org},
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

const postedLineage=()=>journals().map((j,i)=>({...j,sourceLineIds:[[lineA],[lineB],[lineC]][i]}));
describe('canonical line-level source checks before branch statements',()=>{
 it('matches every original recognition line through RLS without confusing two generated GL legs with two source lines',async()=>{
  const r=await observeCanonicalJournalLineage(org,postedLineage());
  expect(r).toMatchObject({status:'RLS_MATCHED_JOURNAL_AND_RECOGNITION_LINES_ONLY',
   organizationId:org,sourceLineCount:3,
   links:[{journalId:idA,branchId:null},{journalId:idB,branchId:null},{journalId:idC,branchId:branch}]});
  expect(s.authCount).toBe(3);
  expect(s.rpcs).toEqual(['financial_core_can','financial_core_can','financial_core_can']);
 });
 it('rejects an RLS-hidden or extra original recognition line rather than treating a truncated ledger as complete',async()=>{
  s.lines=s.lines.slice(0,2);
  await expect(observeCanonicalJournalLineage(org,postedLineage())).rejects.toThrow('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
  s.lines.push({id:lineC,event_id:idC,organization_id:'foreign-org'});
  await expect(observeCanonicalJournalLineage(org,postedLineage())).rejects.toThrow('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
 });
 it('rejects forged line identity, wrong event assignment, duplicate line IDs and unsupported empty original events',async()=>{
  const forged=postedLineage();forged[0].sourceLineIds=[lineB];
  await expect(observeCanonicalJournalLineage(org,forged)).rejects.toThrow('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
  const dupe=postedLineage();dupe[0].sourceLineIds=[lineA,lineA];
  await expect(observeCanonicalJournalLineage(org,dupe)).rejects.toThrow('BRANCH_LINEAGE_SOURCE_INVALID');
  const empty=postedLineage();empty[2].sourceLineIds=[];
  await expect(observeCanonicalJournalLineage(org,empty)).rejects.toThrow('BRANCH_LINEAGE_SOURCE_INVALID');
 });
 it('checks permission again after reading source lines and refuses revoked access',async()=>{
  s.revoked=true;
  await expect(observeCanonicalJournalLineage(org,postedLineage())).rejects.toThrow('BRANCH_JOURNAL_ACCESS_DENIED');
 });
 it('returns zero source lines for an empty company only as read-side evidence, not a certified zero-opening balance',async()=>{
  s.events=[];s.entities=[];s.lines=[];
  const r=await observeCanonicalJournalLineage(org,[]);
  expect(r).toEqual({status:'RLS_MATCHED_JOURNAL_AND_RECOGNITION_LINES_ONLY',
   organizationId:org,sourceLineCount:0,links:[]});
  expect(JSON.stringify(r)).not.toMatch(/openingBalance|approvedOpening|netProfit/);
 });
});
