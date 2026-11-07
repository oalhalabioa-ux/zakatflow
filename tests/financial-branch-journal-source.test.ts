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
const classId='a0000000-0000-4000-8000-000000000010';
const part=(id:string,baseAmount:string,cashDirection:'INFLOW'|'OUTFLOW'|'NON_CASH')=>({
 id:id+':BASE',classificationId:classId+':BASE',baseAmount,cashDirection,recognitionSign:1 as const,
});

const s=vi.hoisted(()=>({
 member:true,allowed:true,revoked:false,authCount:0,rpcs:[] as string[],reads:0,
 error:false,
 events:[] as {id:string;organization_id:string;entity_id:string|null;event_date:string;status:string}[],
 entities:[] as {id:string;organization_id:string;entity_type:string;active:boolean}[],
 lines:[] as {id:string;event_id:string;organization_id:string;classification_id:string;
  base_amount:string;cash_direction:string;metadata:Record<string,unknown>;
  line_number:number;recoverable_percent:number}[],
 links:[] as {event_id:string;organization_id:string;link_type:string;related_event_id:string|null}[],
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
    if(table==='financial_event_links')return{data:s.links.filter(l=>chain.values.includes(l.event_id)),error:null};
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
 Object.assign(s,{member:true,allowed:true,revoked:false,authCount:0,rpcs:[],reads:0,error:false,links:[],
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
   {id:lineA,event_id:idA,organization_id:org,classification_id:classId,base_amount:'100.0000',cash_direction:'INFLOW',metadata:{},line_number:1,recoverable_percent:100},
   {id:lineB,event_id:idB,organization_id:org,classification_id:classId,base_amount:'200.0000',cash_direction:'NON_CASH',metadata:{},line_number:1,recoverable_percent:100},
   {id:lineC,event_id:idC,organization_id:org,classification_id:classId,base_amount:'300.0000',cash_direction:'NON_CASH',metadata:{},line_number:1,recoverable_percent:100},
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

const postedLineage=()=>journals().map((j,i)=>({...j,
 sourceLines:[[part(lineA,'100.0000','INFLOW')],[part(lineB,'200.0000','NON_CASH')],[part(lineC,'300.0000','NON_CASH')]][i],
}));
describe('canonical line-level source checks before branch statements',()=>{
 it('matches every original recognition line through RLS without confusing two generated GL legs with two source lines',async()=>{
  const r=await observeCanonicalJournalLineage(org,postedLineage());
  expect(r).toMatchObject({status:'RLS_MATCHED_JOURNAL_AND_RECOGNITION_LINES_ONLY',
   organizationId:org,sourceLineCount:3,
   links:[{journalId:idA,branchId:null},{journalId:idB,branchId:null},{journalId:idC,branchId:branch}]});
  expect(s.authCount).toBe(3);
  expect(s.rpcs).toEqual(['financial_core_can','financial_core_can','financial_core_can']);
  expect(r.reversalRecognitionSignVerified).toBe(true);
 });
 it('accepts PERSON and other authorized dimensions for legal-company totals without fabricating branch attribution',async()=>{
  s.entities[1].entity_type='PERSON';
  await expect(observeCanonicalJournalLineage(org,postedLineage(),'BRANCH')).rejects
   .toThrow('BRANCH_JOURNAL_ENTITY_UNVERIFIED');
  // The rejected branch request already performed an authorization check.
  // Count only the independent legal-company read in the next assertions.
  s.authCount=0;s.rpcs=[];
  const result=await observeCanonicalJournalLineage(org,postedLineage(),'LEGAL_COMPANY');
  expect(result).toMatchObject({
   status:'RLS_MATCHED_JOURNAL_AND_RECOGNITION_LINES_ONLY',
   organizationId:org,sourceLineCount:3,links:[],
   branchAttributionVerified:false,reversalRecognitionSignVerified:true,
  });
  expect(s.authCount).toBe(3);
  expect(s.rpcs).toEqual(['financial_core_can','financial_core_can','financial_core_can']);
 });
 it('rejects an RLS-hidden or extra original recognition line rather than treating a truncated ledger as complete',async()=>{
  s.lines=s.lines.slice(0,2);
  await expect(observeCanonicalJournalLineage(org,postedLineage())).rejects.toThrow('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
  s.lines.push({id:lineC,event_id:idC,organization_id:'foreign-org',classification_id:classId,base_amount:'300.0000',cash_direction:'NON_CASH',metadata:{},line_number:1,recoverable_percent:100});
  await expect(observeCanonicalJournalLineage(org,postedLineage())).rejects.toThrow('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
 });
 it('rejects forged line identity, wrong event assignment, duplicate line IDs and unsupported empty original events',async()=>{
  const forged=postedLineage();forged[0].sourceLines=[
   part('b0000000-0000-4000-8000-000000000010','100.0000','INFLOW')];
  await expect(observeCanonicalJournalLineage(org,forged)).rejects.toThrow('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
  const reused=postedLineage();reused[0].sourceLines=[part(lineB,'200.0000','NON_CASH')];
  await expect(observeCanonicalJournalLineage(org,reused)).rejects.toThrow('BRANCH_LINEAGE_SOURCE_INVALID');
  const dupe=postedLineage();dupe[0].sourceLines=[part(lineA,'100.0000','INFLOW'),part(lineA,'100.0000','INFLOW')];
  await expect(observeCanonicalJournalLineage(org,dupe)).rejects.toThrow('BRANCH_LINEAGE_SOURCE_INVALID');
  const empty=postedLineage();empty[2].sourceLines=[];
  await expect(observeCanonicalJournalLineage(org,empty)).rejects.toThrow('BRANCH_LINEAGE_SOURCE_INVALID');
 });
 it('reconciles two VAT posting parts against a single original database event line',async()=>{
  s.lines[0].metadata={source_role:'INPUT_VAT',recoverable_percent:60};
  const data=postedLineage();
  data[0].sourceLines=[
   {id:lineA+':INPUT_VAT_RECOVERABLE',classificationId:classId+':INPUT_VAT_RECOVERABLE',
    baseAmount:'60.0000',cashDirection:'INFLOW',recognitionSign:1},
   {id:lineA+':INPUT_VAT_NONRECOVERABLE',classificationId:classId+':INPUT_VAT_NONRECOVERABLE',
    baseAmount:'40.0000',cashDirection:'INFLOW',recognitionSign:1},
  ];
  const result=await observeCanonicalJournalLineage(org,data);
  expect(result).toMatchObject({sourceLineCount:4,reversalRecognitionSignVerified:true});
  data[0].sourceLines[0].baseAmount='59.0000';
  await expect(observeCanonicalJournalLineage(org,data)).rejects.toThrow('BRANCH_LINEAGE_SOURCE_MISMATCH');
 });
 const reversalOriginal='b1000000-0000-4000-8000-000000000012';
 const reversalOriginalLine='c1000000-0000-4000-8000-000000000013';
 const attachOriginal=(metadata:Record<string,unknown>)=>{
  s.links=[{event_id:idC,organization_id:org,link_type:'REVERSAL_OF',related_event_id:reversalOriginal}];
  s.lines.push({id:reversalOriginalLine,event_id:reversalOriginal,organization_id:org,
   classification_id:classId,base_amount:'300.0000',cash_direction:'NON_CASH',
   line_number:1,recoverable_percent:100,metadata});
 };
 it('attests normal signs and linked reversal signs using original line number and metadata',async()=>{
  attachOriginal({recognition_sign:-1});
  const data=[...postedLineage().slice(0,2),{
   ...journals()[2],sourceLines:[{...part(lineC,'300.0000','NON_CASH'),recognitionSign:1 as const}],
  }];
  expect((await observeCanonicalJournalLineage(org,data)).reversalRecognitionSignVerified).toBe(true);
  const wrong=[...postedLineage().slice(0,2),{
   ...journals()[2],sourceLines:[{...part(lineC,'300.0000','NON_CASH'),recognitionSign:-1 as const}],
  }];
  await expect(observeCanonicalJournalLineage(org,wrong)).rejects.toThrow('BRANCH_LINEAGE_SOURCE_MISMATCH');
  s.lines[s.lines.length-1].metadata={recognition_sign:1};
  const signed=[...postedLineage().slice(0,2),{
   ...journals()[2],sourceLines:[{...part(lineC,'300.0000','NON_CASH'),recognitionSign:-1 as const}],
  }];
  expect((await observeCanonicalJournalLineage(org,signed)).reversalRecognitionSignVerified).toBe(true);
 });
 it('matches inherited VAT recovery splits on a reversal against the original source role',async()=>{
  attachOriginal({source_role:'INPUT_VAT',recoverable_percent:60});
  const data=[...postedLineage().slice(0,2),{
   ...journals()[2],
   sourceLines:[
    {id:lineC+':INPUT_VAT_RECOVERABLE',classificationId:classId+':INPUT_VAT_RECOVERABLE',
     baseAmount:'180.0000',cashDirection:'NON_CASH' as const,recognitionSign:-1 as const},
    {id:lineC+':INPUT_VAT_NONRECOVERABLE',classificationId:classId+':INPUT_VAT_NONRECOVERABLE',
     baseAmount:'120.0000',cashDirection:'NON_CASH' as const,recognitionSign:-1 as const},
   ],
  }];
  const verified=await observeCanonicalJournalLineage(org,data);
  expect(verified).toMatchObject({sourceLineCount:4,reversalRecognitionSignVerified:true});
  const altered=structuredClone(data);
  altered[2].sourceLines[0].baseAmount='170.0000';
  altered[2].sourceLines[1].baseAmount='130.0000';
  await expect(observeCanonicalJournalLineage(org,altered))
   .rejects.toThrow('BRANCH_LINEAGE_SOURCE_MISMATCH');
 });
 it('refuses a fabricated posting role if the original line does not declare it',async()=>{
  const data=postedLineage();
  data[0].sourceLines[0].id=lineA+':FABRICATED';
  data[0].sourceLines[0].classificationId=classId+':FABRICATED';
  await expect(observeCanonicalJournalLineage(org,data)).rejects.toThrow('BRANCH_LINEAGE_SOURCE_MISMATCH');
  s.lines[0].metadata={source_role:'FABRICATED'};
  expect((await observeCanonicalJournalLineage(org,data)).sourceLineCount).toBe(3);
 });
 it('rejects altered source amounts, classification or cash direction even if the line IDs are identical',async()=>{
  s.lines[0].base_amount='101.0000';
  await expect(observeCanonicalJournalLineage(org,postedLineage())).rejects.toThrow('BRANCH_LINEAGE_SOURCE_MISMATCH');
  s.lines[0].base_amount='100.0000';
  s.lines[0].classification_id='b0000000-0000-4000-8000-000000000011';
  await expect(observeCanonicalJournalLineage(org,postedLineage())).rejects.toThrow('BRANCH_LINEAGE_SOURCE_MISMATCH');
  s.lines[0].classification_id=classId;
  s.lines[0].cash_direction='OUTFLOW';
  await expect(observeCanonicalJournalLineage(org,postedLineage())).rejects.toThrow('BRANCH_LINEAGE_SOURCE_MISMATCH');
 });
 it('checks permission again after reading source lines and refuses revoked access',async()=>{
  s.revoked=true;
  await expect(observeCanonicalJournalLineage(org,postedLineage())).rejects.toThrow('BRANCH_JOURNAL_ACCESS_DENIED');
 });
 it('returns zero source lines for an empty company only as read-side evidence, not a certified zero-opening balance',async()=>{
  s.events=[];s.entities=[];s.lines=[];
  const r=await observeCanonicalJournalLineage(org,[]);
  expect(r).toEqual({status:'RLS_MATCHED_JOURNAL_AND_RECOGNITION_LINES_ONLY',
   organizationId:org,sourceLineCount:0,links:[],branchAttributionVerified:true,reversalRecognitionSignVerified:true});
  expect(JSON.stringify(r)).not.toMatch(/openingBalance|approvedOpening|netProfit/);
 });
});
