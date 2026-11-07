import {requireUser} from './auth';
import Decimal from 'decimal.js';
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


const Amount=Decimal.clone({precision:50});
const valuePattern=/^\\d{1,20}(\\.\\d{1,4})?$/;
const sourcePart=/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([A-Z][A-Z0-9_]{0,63})$/i;
export type CanonicalRecognitionPart={
 /** Database normalization produces financial_event_lines.id + ':' + part. */
 id:string;classificationId:string;baseAmount:string;
 cashDirection:'NON_CASH'|'INFLOW'|'OUTFLOW';recognitionSign:1|-1;
};
export type CanonicalLineageJournal=CanonicalJournal&{
 sourceLines:readonly CanonicalRecognitionPart[];
};
export type JournalLineageObservation={
 status:'RLS_MATCHED_JOURNAL_AND_RECOGNITION_LINES_ONLY';
 organizationId:string;
 /** Normalized recognition parts, NOT raw DB rows or two GL debit/credit legs. */
 sourceLineCount:number;
 links:JournalBranchObservation['links'];
 /** Reversal signs can be derived from linked originals, not only the line row. */
 reversalRecognitionSignVerified:false;
};

/**
 * Read-side QA evidence. A live statement snapshot's normalized recognition
 * parts have IDs <event_line_uuid>:<posting_part>; compare each part against
 * the underlying RLS-visible financial_event_lines row, exact source
 * classification, cash direction and total base_amount. VAT recoverability
 * can legitimately split ONE source row into TWO normalized parts.
 *
 * This does NOT attest posting rules, original reversal signs, an atomic ledger
 * revision, approved opening allocation, or permission to issue branch reports.
 */
export async function observeCanonicalJournalLineage(
 organizationId:string,journals:readonly CanonicalLineageJournal[],
):Promise<JournalLineageObservation>{
 if(!uuid.test(organizationId)||journals.length>10000)throw Error('BRANCH_LINEAGE_SCOPE_INVALID');
 const posted=journals.filter(j=>j.status==='POSTED');
 const seenJournals=new Set<string>(),seenParts=new Set<string>();
 const expected=new Map<string,Map<string,CanonicalRecognitionPart>>();
 const rawCounts=new Map<string,number>();
 for(const journal of journals){
  if(journal.organizationId!==organizationId||!uuid.test(journal.id)||
   !validDate(journal.date)||!['POSTED','DRAFT','VOID'].includes(journal.status)||
   !Array.isArray(journal.sourceLines)||seenJournals.has(journal.id))
   throw Error('BRANCH_LINEAGE_SOURCE_INVALID');
  seenJournals.add(journal.id);
  if(journal.status!=='POSTED'){
   if(journal.sourceLines.length)throw Error('BRANCH_LINEAGE_SOURCE_INVALID');
   continue;
  }
  if(!journal.sourceLines.length||journal.sourceLines.length>400)throw Error('BRANCH_LINEAGE_SOURCE_INVALID');
  const parts=new Map<string,CanonicalRecognitionPart>(),rawIds=new Set<string>();
  for(const line of journal.sourceLines){
   const match=typeof line?.id==='string'?line.id.match(sourcePart):null;
   if(!match||line.classificationId!==line.classificationId?.trim()||
    !uuid.test(line.classificationId?.slice(0,36)??'')||
    line.classificationId.slice(36)!==':'+match[2]||
    !valuePattern.test(line.baseAmount)||!new Amount(line.baseAmount).gt(0)||
    !['NON_CASH','INFLOW','OUTFLOW'].includes(line.cashDirection)||
    ![1,-1].includes(line.recognitionSign)||
    seenParts.has(line.id))
    throw Error('BRANCH_LINEAGE_SOURCE_INVALID');
   seenParts.add(line.id);rawIds.add(match[1]);parts.set(line.id,line);
  }
  expected.set(journal.id,parts);rawCounts.set(journal.id,rawIds.size);
 }
 const observed=await observeCanonicalJournalBranches(organizationId,journals);
 const {supabase,user}=await requireUser();
 // Batch by ORIGINAL database rows, rather than generated GL legs or VAT parts.
 const batches:CanonicalLineageJournal[][]=[];let batch:CanonicalLineageJournal[]=[],count=0;
 for(const j of posted){
  const n=rawCounts.get(j.id)!;
  if(count+n>400){if(batch.length)batches.push(batch);batch=[];count=0}
  batch.push(j);count+=n;
 }
 if(batch.length)batches.push(batch);
 let observedParts=0;
 for(const chunk of batches){
  const ids=chunk.map(j=>j.id);
  const required=chunk.reduce((n,j)=>n+rawCounts.get(j.id)!,0);
  const response=await supabase.from('financial_event_lines')
   .select('id,event_id,organization_id,classification_id,base_amount,cash_direction,metadata')
   .eq('organization_id',organizationId).in('event_id',ids).limit(required+1);
  if(response.error||!Array.isArray(response.data))
   throw Error('BRANCH_LINEAGE_SOURCE_UNAVAILABLE');
  if(response.data.length!==required)throw Error('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
  const received=new Set<string>();
  for(const row of response.data as {id:string;event_id:string;organization_id:string;
   classification_id:string;base_amount:string|number;cash_direction:string;metadata:Record<string,unknown>|null}[]){
   const parts=expected.get(row.event_id);
   const key=row.event_id+':'+row.id;
   if(!parts||row.organization_id!==organizationId||!uuid.test(row.id)||!uuid.test(row.classification_id)||
    received.has(key))throw Error('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
   received.add(key);
   const matching=[...parts.values()].filter(p=>p.id.startsWith(row.id+':'));
   if(!matching.length||!valuePattern.test(String(row.base_amount)))
    throw Error('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
   let sum=new Amount(0);
   for(const part of matching){
    const suffix=part.id.slice(row.id.length+1);
    if(part.classificationId!==row.classification_id+':'+suffix||
     part.cashDirection!==row.cash_direction)
     throw Error('BRANCH_LINEAGE_SOURCE_MISMATCH');
    sum=sum.plus(part.baseAmount);
   }
   if(!sum.eq(row.base_amount))throw Error('BRANCH_LINEAGE_SOURCE_MISMATCH');
   // The source-role origin can be inherited from an original reversal row.
   // Only assert the raw row's role when it is expressly present.
   const role=row.metadata?.source_role;
   if(typeof role==='string'&&role.trim()){
    const allowed=role==='INPUT_VAT'
     ? new Set(['INPUT_VAT_RECOVERABLE','INPUT_VAT_NONRECOVERABLE'])
     : new Set([role]);
    if(matching.some(part=>!allowed.has(part.id.slice(row.id.length+1))))
     throw Error('BRANCH_LINEAGE_SOURCE_MISMATCH');
   }
   observedParts+=matching.length;
  }
 }
 if(observedParts!==posted.reduce((n,j)=>n+j.sourceLines.length,0))
  throw Error('BRANCH_LINEAGE_SOURCE_INCOMPLETE');
 // RLS/permission can be revoked between header and line queries.
 const member=await supabase.from('organization_members').select('organization_id')
  .eq('organization_id',organizationId).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle();
 if(member.error||!member.data)throw Error('BRANCH_LINEAGE_ACCESS_DENIED');
 const permission=await supabase.rpc('financial_core_can',{p_org:organizationId,p_scope:'financial_core.view'});
 if(permission.error||permission.data!==true)throw Error('BRANCH_LINEAGE_ACCESS_DENIED');
 return{status:'RLS_MATCHED_JOURNAL_AND_RECOGNITION_LINES_ONLY',organizationId,
  sourceLineCount:observedParts,links:observed.links,reversalRecognitionSignVerified:false};
}
