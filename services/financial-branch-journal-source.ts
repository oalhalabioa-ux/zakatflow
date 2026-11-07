import {requireUser} from './auth';
import {classifyFinancialSourceScope} from '../lib/financial-reporting-scope';

type CanonicalJournal={id:string;organizationId:string;date:string;status:'POSTED'|'DRAFT'|'VOID'};
export type JournalBranchObservation={
 status:'RLS_MATCHED_JOURNAL_REFERENCES_ONLY';
 organizationId:string;
 /** RLS evidence for posted canonical events. NOT approval of branch openings. */
 links:{journalId:string;branchId:string|null;scope:'ORGANIZATION_DIRECT'|'BRANCH'}[];
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const day=/^\d{4}-\d{2}-\d{2}$/;
function validDate(value:string){return day.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value}

/**
 * Authorized read-side bridge for canonical financial_event journals.
 *
 * The existing live source compiler does not expose trustworthy operating
 * dimensions for individual posted journals. Read those dimensions again from
 * Financial Core, with tenant RLS and financial_core.view checked both before
 * and after. Missing/hidden/legacy events never become HQ transactions.
 *
 * IMPORTANT: This does NOT attest source revisions, opening allocation or the
 * complete legal-company ledger. Never serve branch statements from this
 * observation alone; it is evidence required by the later server approval path.
 */
export async function observeCanonicalJournalBranches(
 organizationId:string,journals:readonly CanonicalJournal[],
):Promise<JournalBranchObservation>{
 if(!uuid.test(organizationId)||journals.length>10000)throw Error('BRANCH_JOURNAL_SCOPE_INVALID');
 const posted=journals.filter(j=>j.status==='POSTED');
 const seen=new Set<string>();
 for(const journal of journals){
  if(journal.organizationId!==organizationId||!uuid.test(journal.id)||!validDate(journal.date)
   ||!['POSTED','DRAFT','VOID'].includes(journal.status)||seen.has(journal.id))throw Error('BRANCH_JOURNAL_SOURCE_INVALID');
  seen.add(journal.id);
 }
 const {supabase,user}=await requireUser();
 async function authorize(){
  const member=await supabase.from('organization_members').select('organization_id')
   .eq('organization_id',organizationId).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle();
  if(member.error||!member.data)throw Error('BRANCH_JOURNAL_ACCESS_DENIED');
  const allowed=await supabase.rpc('financial_core_can',{p_org:organizationId,p_scope:'financial_core.view'});
  if(allowed.error||allowed.data!==true)throw Error('BRANCH_JOURNAL_ACCESS_DENIED');
 }
 await authorize();
 const entityResponse=await supabase.from('organization_entities').select('id,organization_id,entity_type,active')
  .eq('organization_id',organizationId).limit(1001);
 if(entityResponse.error||!Array.isArray(entityResponse.data)||entityResponse.data.length>1000)
  throw Error('BRANCH_JOURNAL_SOURCE_UNAVAILABLE');
 const ids=posted.map(j=>j.id),events:Array<{id:string;organization_id:string;entity_id:string|null;event_date:string;status:string}>=[];
 for(let offset=0;offset<ids.length;offset+=150){
  const subset=ids.slice(offset,offset+150);
  const response=await supabase.from('financial_events').select('id,organization_id,entity_id,event_date,status')
   .eq('organization_id',organizationId).in('id',subset).limit(subset.length+1);
  if(response.error||!Array.isArray(response.data)||response.data.length>subset.length)
   throw Error('BRANCH_JOURNAL_SOURCE_UNAVAILABLE');
  events.push(...response.data);
 }
 // A read via RLS can be only a subset of a privileged live snapshot. Do not
 // silently treat a hidden event or synthetic legacy journal as company direct.
 const references=new Map(posted.map(j=>[j.id,j]));
 if(events.length!==references.size||new Set(events.map(e=>e.id)).size!==events.length
  ||events.some(e=>!references.has(e.id)||e.organization_id!==organizationId||
   e.event_date!==references.get(e.id)!.date||!['ACTUAL','REVERSED'].includes(e.status)))
  throw Error('BRANCH_JOURNAL_SOURCE_INCOMPLETE');
 let classified:ReturnType<typeof classifyFinancialSourceScope>;
 try{
  classified=classifyFinancialSourceScope(organizationId,
   entityResponse.data.map(e=>({id:e.id,organizationId:e.organization_id,entityType:e.entity_type,active:e.active})),
   events.map(e=>({id:e.id,organizationId:e.organization_id,entityId:e.entity_id})));
 }catch{
  throw Error('BRANCH_JOURNAL_ENTITY_UNVERIFIED');
 }
 await authorize();
 const byId=new Map(classified.map(e=>[e.id,e]));
 return{status:'RLS_MATCHED_JOURNAL_REFERENCES_ONLY',organizationId,links:posted.map(j=>{
  const value=byId.get(j.id)!;
  return{journalId:j.id,branchId:value.branchId,scope:value.scope};
 })};
}


export type CanonicalLineageJournal=CanonicalJournal&{
 /** IDs of ORIGINAL financial_event_lines (one recognition line may generate
  * two accounting entries). Never pass generated GL line indices here. */
 sourceLineIds:readonly string[];
};
export type JournalLineageObservation={
 status:'RLS_MATCHED_JOURNAL_AND_RECOGNITION_LINES_ONLY';
 organizationId:string;
 sourceLineCount:number;
 links:JournalBranchObservation['links'];
};

/** Checks complete canonical event-line identities under tenant RLS, not merely
 * that each event header was visible. No journal, branch balance, or full ledger
 * is authorized by this observation alone. Only server-side callers can bind it
 * to the same full-source revision and approved posting rules.
 */
export async function observeCanonicalJournalLineage(
 organizationId:string,journals:readonly CanonicalLineageJournal[],
):Promise<JournalLineageObservation>{
 if(!uuid.test(organizationId)||journals.length>10000)
  throw Error('BRANCH_LINEAGE_SCOPE_INVALID');
 const posted=journals.filter(j=>j.status==='POSTED');
 const seen=new Set<string>();
 for(const journal of journals){
  if(journal.organizationId!==organizationId||!uuid.test(journal.id)||
   !validDate(journal.date)||!['POSTED','DRAFT','VOID'].includes(journal.status)||
   !Array.isArray(journal.sourceLineIds)||seen.has(journal.id))
   throw Error('BRANCH_LINEAGE_SOURCE_INVALID');
  seen.add(journal.id);
  if(journal.status==='POSTED'){
   if(!journal.sourceLineIds.length||journal.sourceLineIds.length>400||
    journal.sourceLineIds.some(id=>!uuid.test(id))||
    new Set(journal.sourceLineIds).size!==journal.sourceLineIds.length)
    throw Error('BRANCH_LINEAGE_SOURCE_INVALID');
  }else if(journal.sourceLineIds.length){
   throw Error('BRANCH_LINEAGE_SOURCE_INVALID');
  }
 }
 // Enforce RLS, header dates, event status, and entity assignment first.
 const observed=await observeCanonicalJournalBranches(organizationId,journals);
 const {supabase,user}=await requireUser();
 const expected=new Map(posted.map(j=>[j.id,new Set(j.sourceLineIds)]));
 const read=new Map<string,Set<string>>();
 // Each query covers at most 400 expected recognition lines, safely beneath
 // the normal 1000-row PostgREST cap, and asks for one extra to catch overread.
 const batches:CanonicalLineageJournal[][]=[];
 let batch:CanonicalLineageJournal[]=[],count=0;
 for(const j of posted){
  if(count+j.sourceLineIds.length>400){batches.push(batch);batch=[];count=0}
  batch.push(j);count+=j.sourceLineIds.length;
 }
 if(batch.length)batches.push(batch);
 for(const chunk of batches){
  const ids=chunk.map(j=>j.id);
  const required=chunk.reduce((n,j)=>n+j.sourceLineIds.length,0);
  const response=await supabase.from('financial_event_lines')
   .select('id,event_id,organization_id')
   .eq('organization_id',organizationId)
   .in('event_id',ids).limit(required+1);
  if(response.error||!Array.isArray(response.data))
   throw Error('BRANCH_LINEAGE_SOURCE_UNAVAILABLE');
  if(response.data.length!==required)
   throw Error('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
  for(const line of response.data as {id:string;event_id:string;organization_id:string}[]){
   const wanted=expected.get(line.event_id);
   if(!wanted||line.organization_id!==organizationId||!wanted.has(line.id))
    throw Error('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
   const current=read.get(line.event_id)??new Set<string>();
   if(current.has(line.id))throw Error('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
   current.add(line.id);read.set(line.event_id,current);
  }
 }
 if(posted.some(j=>read.get(j.id)?.size!==j.sourceLineIds.length))
  throw Error('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
 // The event-line read is a second query. Reauthorize afterward to prevent
 // a revoked member from receiving the combined result.
 const member=await supabase.from('organization_members').select('organization_id')
  .eq('organization_id',organizationId).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle();
 if(member.error||!member.data)throw Error('BRANCH_LINEAGE_ACCESS_DENIED');
 const permission=await supabase.rpc('financial_core_can',{p_org:organizationId,p_scope:'financial_core.view'});
 if(permission.error||permission.data!==true)throw Error('BRANCH_LINEAGE_ACCESS_DENIED');
 return{status:'RLS_MATCHED_JOURNAL_AND_RECOGNITION_LINES_ONLY',organizationId,
  sourceLineCount:[...expected.values()].reduce((n,ids)=>n+ids.size,0),links:observed.links};
}
