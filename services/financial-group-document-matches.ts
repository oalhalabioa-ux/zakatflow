import {z} from 'zod';
import {requireUser} from './auth';
import type {SourceBoundAdjustment} from '../lib/financial-group-source-bound-adjustments';
import {statementQuery} from '../lib/financial-statement-source';
export async function readGroupDocumentMatches(entries:readonly Pick<SourceBoundAdjustment,'documentMatchId'>[]){
 const ids=[...new Set(entries.flatMap(e=>e.documentMatchId?[e.documentMatchId]:[]))].sort();
 if(!ids.length)return[];
 const {supabase}=await requireUser();
 const r=await supabase.rpc('financial_group_document_context',{p_matches:ids});
 if(r.error)throw Error(/DENIED/.test(r.error.message)?'REPORTING_ACCESS_DENIED':'REPORTING_GROUP_DOCUMENT_UNAVAILABLE');
 return r.data;
}
const reason=z.string().trim().min(8).max(1000),uuid=z.string().uuid();
const outstanding=z.string().regex(/^\d{1,20}\.\d{4}$/);
const priorBalance=z.discriminatedUnion('status',[
 z.object({status:z.literal('OPEN'),currency:z.string().regex(/^[A-Z]{3}$/),leftOutstanding:outstanding,rightOutstanding:outstanding}).strict(),
 z.object({status:z.literal('REVIEW_REQUIRED')}).strict(),
]);
const invoiceReference=z.object({
 id:uuid,eventId:uuid,date:z.string().date(),side:z.enum(['SALES','PURCHASE']),organizationName:z.string(),
});
const coverage=z.object({
 status:z.literal('GROUP_DOCUMENT_COVERAGE_REVIEW'),organization:uuid,from:z.string().date(),to:z.string().date(),
 batchId:uuid,batchVersion:z.number().int().positive(),
 rows:z.array(z.object({id:uuid,leftEventId:uuid,rightEventId:uuid,sourceCurrent:z.boolean(),priorBalance:priorBalance.optional()}).strict()).max(200),
 transferCandidates:z.array(z.object({
  id:uuid,date:z.string().date(),type:z.enum(['LOAN','CAPITAL','ON_BEHALF']),
  sourceName:z.string(),destinationName:z.string(),
  status:z.enum(['DOCUMENT_MATCH_REQUIRED','SOURCE_LINK_REVIEW_REQUIRED']),
 }).strict()).max(200),
 invoiceCandidates:z.array(invoiceReference.extend({counterpartyName:z.string()}).strict()).max(200),
 invoiceIdentityReview:z.object({
  missingCount:z.number().int().nonnegative(),sharedCount:z.number().int().nonnegative(),page:z.number().int().positive(),
  rows:z.array(invoiceReference.extend({reason:z.enum(['MISSING_TAX_NUMBER','SHARED_TAX_NUMBER'])}).strict()).max(20),
 }).strict(),
}).strict();
export async function readGroupDocumentCoverage(input:unknown,identityPage=1){
 const {organization,from,to}=statementQuery.parse(input);
 const {supabase}=await requireUser();
 const r=await supabase.rpc('financial_group_document_coverage',{p_root:organization,p_from:from,p_to:to,p_identity_page:identityPage});
 if(r.error)throw Error(r.error.code==='PGRST202'?'REPORTING_GROUP_DOCUMENT_COVERAGE_NOT_INSTALLED':
  /^GROUP_(BATCH|CONTROL|DOCUMENT)_[A-Z_]+$/.test(r.error.message)?r.error.message:'REPORTING_GROUP_DOCUMENT_UNAVAILABLE');
 const parsed=coverage.safeParse(r.data);
 if(!parsed.success)throw Error('REPORTING_GROUP_DOCUMENT_EVIDENCE_INVALID');
 const {invoiceIdentityReview:identity}=parsed.data;
 const identityTotal=identity.missingCount+identity.sharedCount;
 const expectedPage=Math.min(identityPage,Math.max(1,Math.ceil(identityTotal/20)));
 if(parsed.data.organization!==organization||parsed.data.from!==from||parsed.data.to!==to||
  new Set(parsed.data.rows.map(row=>row.id)).size!==parsed.data.rows.length||
  new Set(parsed.data.transferCandidates.map(row=>row.id)).size!==parsed.data.transferCandidates.length||
  new Set(parsed.data.invoiceCandidates.map(row=>row.id)).size!==parsed.data.invoiceCandidates.length||
  identity.page!==expectedPage||identity.rows.length!==Math.min(20,identityTotal-(expectedPage-1)*20)||
  new Set(identity.rows.map(row=>row.id)).size!==identity.rows.length)
  throw Error('REPORTING_GROUP_DOCUMENT_EVIDENCE_INVALID');
 return parsed.data;
}
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('PROPOSE'),firstEventId:uuid,secondEventId:uuid,evidenceReference:reason,reason,requestId:uuid}).strict(),
 z.object({action:z.enum(['APPROVE','REVOKE']),matchId:uuid,reason}).strict()
]);
export async function commandGroupDocumentMatch(input:unknown){
 if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
 const c=command.parse(input),{supabase}=await requireUser();
 const r=c.action==='PROPOSE'
  ?await supabase.rpc('financial_group_document_propose',{p_first:c.firstEventId,p_second:c.secondEventId,p_evidence:c.evidenceReference,p_reason:c.reason,p_request_id:c.requestId})
  :await supabase.rpc('financial_group_document_decide',{p_match:c.matchId,p_action:c.action,p_reason:c.reason});
 if(r.error)throw Error(/^GROUP_DOCUMENT_[A-Z_]+$/.test(r.error.message)?r.error.message:'REPORTING_GROUP_DOCUMENT_UNAVAILABLE');
 const id=uuid.safeParse(r.data);if(!id.success)throw Error('REPORTING_GROUP_DOCUMENT_EVIDENCE_INVALID');
 return{documentMatchId:id.data,action:c.action};
}
