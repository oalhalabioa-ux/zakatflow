import {requireUser} from './auth';
import {assertOpeningWorkspace,openingContext} from './financial-opening-workspace';
import {normalizeStatementSource,statementQuery,type StatementSourceSnapshot} from '../lib/financial-statement-source';
import {endingForFiscalStart} from '../lib/financial-fiscal-end';
import {observeCanonicalJournalEventHeaders,observeCanonicalJournalLineage} from './financial-branch-journal-source';
import {observeVatRefundSources} from './financial-vat-refund-source';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
// This check runs on LIVE financial statements in every environment, including
// Production, not only on the separately gated branch QA preview. Unrecognized
// legacy/refund sources are validated structurally by the source normalizer;
// their independent register-level attestations remain a release blocker.
const coreUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const originalPart=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:[A-Z][A-Z0-9_]{0,63}$/i;
async function requireCanonicalRawSourceMatch(report:StatementSourceSnapshot){
 const canonical=report.canonicalJournalLineage.filter(j=>coreUuid.test(j.id));
 const originals=canonical.map(j=>({...j,
  sourceLines:j.sourceLines.filter(l=>originalPart.test(l.id))}))
  .filter(j=>j.sourceLines.length>0);
 // An event with ONLY a synthetic VAT-note refund does not have a
 // financial_event_lines row. It still MUST have an authorized matching event
 // header; otherwise a privileged source RPC could leak or invent a journal.
 const refundOnly=canonical.filter(j=>j.sourceLines.every(l=>!originalPart.test(l.id)));
 if(refundOnly.length){
  const headers=await observeCanonicalJournalEventHeaders(report.statements.organizationId,refundOnly);
  if(headers.eventCount!==refundOnly.length||
   headers.organizationId!==report.statements.organizationId)
   throw Error('REPORTING_SOURCE_LINEAGE_INCOMPLETE');
 }
 if(!originals.length)return;
 const observation=await observeCanonicalJournalLineage(report.statements.organizationId,originals,'LEGAL_COMPANY');
 const expected=originals.reduce((n,j)=>n+j.sourceLines.length,0);
 if(observation.branchAttributionVerified||observation.links.length!==0||
   observation.sourceLineCount!==expected||observation.organizationId!==report.statements.organizationId)
  throw Error('REPORTING_SOURCE_LINEAGE_INCOMPLETE');
}
export function assertLiveStatements(){assertOpeningWorkspace();if(process.env.FINANCIAL_STATEMENTS_LIVE!=='true')throw Error('REPORTING_DISABLED')}
function read<T>(r:{data:T;error:{message:string}|null}){if(r.error)throw Error(r.error.message.match(/REPORTING_[A-Z_]+/)?.[0]??'REPORTING_UNAVAILABLE');return r.data}
export async function liveStatementContext(){
 assertLiveStatements();
 const {supabase}=await requireUser();
 const periods=read(await supabase.rpc('financial_statement_live_context')) as {organizationId:string;name:string;currency:string;fiscalStart:string;fiscalEnd:string}[];
 const organizations=await openingContext();
 // The topbar's existing company/group switch uses the hierarchy of *authorized*
 // organizations. This relation controls only picker availability, never access
 // or financial consolidation; group reporting has a separate fail-closed gate.
 const permitted=new Set(organizations.map(org=>org.id));
 const hierarchy=organizations.length?read(await supabase.from('organizations')
  .select('id,parent_organization_id').in('id',[...permitted])) as {id:string;parent_organization_id:string|null}[]:[];
 const parents=new Map(hierarchy.map(row=>[row.id,permitted.has(row.parent_organization_id??'')?row.parent_organization_id:null]));
 return organizations.flatMap(org=>{
  const rows=periods.filter(period=>period.organizationId===org.id);
  const draftStart=org.currentFiscalStart??'';
  const current=draftStart&&!rows.some(period=>period.fiscalStart===draftStart)
   ?[{organizationId:org.id,name:org.name,currency:org.base_currency,fiscalStart:draftStart,fiscalEnd:endingForFiscalStart(draftStart)}]:[];
  const available=[...rows,...current].sort((a,b)=>b.fiscalStart.localeCompare(a.fiscalStart));
  return (available.length?available:[{organizationId:org.id,name:org.name,currency:org.base_currency,fiscalStart:'',fiscalEnd:''}])
   .map(period=>({...period,parentOrganizationId:parents.get(org.id)??null}));
 });
}
export async function liveStatementSource(input:unknown){
 assertLiveStatements();const q=statementQuery.parse(input),{supabase,user}=await requireUser();
 const args={p_org:q.organization,p_from:q.from,p_to:q.to};
 const primary=await supabase.rpc('financial_statement_live_snapshot',args);
 // A fresh legal entity may have no opening rows. Only a separate, trusted
 // database RPC may attest first activity from the COMPLETE historical source.
 // Never manufacture an empty opening in the browser or infer it from an RPC
 // error. Until the independently tested server RPC is installed, fail closed.
 const firstActivityAllowed=process.env.FINANCIAL_FIRST_ACTIVITY_REPORTING==='true'&&
  process.env.VERCEL_ENV!=='production';
 const fallbackUsed=firstActivityAllowed&&
  primary.error?.message?.includes('REPORTING_APPROVED_OPENING_REQUIRED');
 const sourceRpc=fallbackUsed?'financial_statement_first_activity_snapshot':'financial_statement_live_snapshot';
 const raw=read(fallbackUsed
  ?await supabase.rpc('financial_statement_first_activity_snapshot',args)
  :primary);
 if(raw?.origin!=='LIVE_CANONICAL_EVENTS')throw Error('REPORTING_UNAVAILABLE');
 const result=normalizeStatementSource(raw,q);
 await requireCanonicalRawSourceMatch(result);
 // The Production RPC can synthesize VAT refund lines from obligations, not
 // financial_event_lines. Verify ALL positive note-refund obligations (including
 // the absence of any omitted lines) and reversal signs from actual RLS reads.
 // This check is active for legal-company reports in Production as well as QA.
 const canonical=result.canonicalJournalLineage.filter(j=>coreUuid.test(j.id));
 const refundEvidence=await observeVatRefundSources(result.statements.organizationId,canonical);
 if(refundEvidence.eventsObserved!==canonical.length||
    refundEvidence.refundPartsMatched!==canonical.reduce((n,j)=>n+
      j.sourceLines.filter(l=>l.id.includes(':refund:')).length,0))
  throw Error('REPORTING_REFUND_SOURCE_INCOMPLETE');
 // These source verifiers run as separate RLS requests. A second complete
 // authorized read detects source changes occurring between the first snapshot
 // and the end of those checks. This is a RACE DETECTOR, not atomic-revision
 // certification (an A->B->A change remains possible). The current release
 // gate must not mark sameTransactionRevisionVerified=true.
 const replayEnabled=process.env.FINANCIAL_SOURCE_REPLAY_GUARD==='true'||
   (process.env.VERCEL_ENV==='production'&&
    process.env.FINANCIAL_SOURCE_REPLAY_GUARD!=='false');
 if(replayEnabled){
  const replay=read(await supabase.rpc(sourceRpc,args));
  assertStableFinancialReplay(raw,replay);
 }
 const membership=read(await supabase.from('organization_members').select('organization_id').eq('organization_id',q.organization).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle());
 if(!membership||read(await supabase.rpc('financial_core_can',{p_org:q.organization,p_scope:'financial_core.view'}))!==true)throw Error('REPORTING_ACCESS_DENIED');
 return result;
}


/** QA read-side bridge from an independently validated LIVE financial snapshot
 * to RLS-verified original recognition-line identities. Not financial statements
 * by branch: opening distribution and a same-transaction source revision are
 * deliberately NOT attested here. No user-facing endpoint or export consumes it.
 */
export async function liveBranchJournalLineageEvidence(input:unknown){
 if(process.env.FINANCIAL_BRANCH_EVIDENCE_QA!=='true'||process.env.VERCEL_ENV==='production')
  throw Error('BRANCH_EVIDENCE_DISABLED');
 const report=await liveStatementSource(input);
 if(report.origin!=='LIVE_CANONICAL_EVENTS'||report.scope!=='ORGANIZATION_ALL_ENTITIES')
  throw Error('BRANCH_EVIDENCE_SOURCE_UNVERIFIED');
 const observed=await observeCanonicalJournalLineage(report.statements.organizationId,report.canonicalJournalLineage);
 if(observed.sourceLineCount!==report.lineage.length||
  observed.links.length!==report.canonicalJournalLineage.length)
  throw Error('BRANCH_EVIDENCE_SOURCE_INCOMPLETE');
 return {status:'BRANCH_JOURNAL_LINEAGE_OBSERVED_ONLY' as const,
  organizationId:report.statements.organizationId,from:report.statements.from,to:report.statements.to,
  observed,sourceSnapshotReadAt:report.readAt,
  /** A read-time is not an atomic ledger revision. Reconcile before publishing. */
  sameTransactionRevisionVerified:false as const,openingDistributionApproved:false as const};
}
