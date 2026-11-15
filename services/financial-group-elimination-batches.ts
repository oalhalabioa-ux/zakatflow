import {z} from 'zod';
import {requireUser} from './auth';
import {statementQuery} from '../lib/financial-statement-source';
import {sourceBoundAdjustmentSchema} from '../lib/financial-group-source-bound-adjustments';
import {liveSourceBoundGroupPreview} from './financial-group-source-bound-adjustments';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
const uuid=z.string().uuid(),reason=z.string().trim().min(8).max(1000);
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('SAVE'),query:statementQuery,entries:z.array(sourceBoundAdjustmentSchema.extend({documentMatchId:uuid})).max(200),expectedVersion:z.number().int().nonnegative(),reason,requestId:uuid}).strict(),
 z.object({action:z.literal('APPROVE'),query:statementQuery,batchId:uuid,expectedVersion:z.number().int().positive(),reason}).strict()
]);
const batch=z.object({id:uuid,root_organization_id:uuid,period_from:z.string().date(),period_to:z.string().date(),
 version:z.number().int().positive(),status:z.enum(['DRAFT','APPROVED','SUPERSEDED']),
 entries:z.array(sourceBoundAdjustmentSchema.extend({documentMatchId:uuid})).max(200)});
const context=z.object({status:z.literal('GROUP_ELIMINATION_EVIDENCE_ONLY'),batches:z.array(batch).max(50)});
function enabled(){if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');}
const approvedEvidence=z.object({status:z.literal('APPROVED_GROUP_ELIMINATION_EVIDENCE'),id:uuid,
 version:z.number().int().positive(),rootOrganizationId:uuid,from:z.string().date(),to:z.string().date(),
 entries:z.array(sourceBoundAdjustmentSchema.extend({documentMatchId:uuid})).max(200),
 approvedBy:uuid,approvedAt:z.string().datetime({offset:true}),evidenceFingerprint:z.string().regex(/^[a-f0-9]{32}$/)}).strict();
/** Verified approved adjustments only; not a certification of full consolidation. */
export async function readApprovedGroupEliminations(input:unknown){
 enabled();const query=statementQuery.parse(input),{supabase}=await requireUser();
 const read=async()=>{
  const r=await supabase.rpc('financial_group_approved_eliminations',{p_root:query.organization,p_from:query.from,p_to:query.to});
  if(r.error)throw Error(/^GROUP_BATCH_[A-Z_]+$/.test(r.error.message)?r.error.message:'REPORTING_GROUP_BATCH_UNAVAILABLE');
  const parsed=approvedEvidence.safeParse(r.data);if(!parsed.success)throw Error('REPORTING_GROUP_BATCH_INVALID');
  const e=parsed.data;
  if(e.rootOrganizationId!==query.organization||e.from!==query.from||e.to!==query.to)throw Error('REPORTING_ACCESS_DENIED');
  return e;
 };
 const evidence=await read();
 const verified=await liveSourceBoundGroupPreview({query,entries:evidence.entries});
 if(verified.documents.status!=='DOCUMENT_MATCHES_VERIFIED_ONLY')throw Error('GROUP_BATCH_DOCUMENT_NOT_APPROVED');
 assertStableFinancialReplay(evidence,await read());
 return{...verified,status:'APPROVED_GROUP_ADJUSTMENT_WORKSHEET' as const,consolidated:false as const,
  approval:{id:evidence.id,version:evidence.version,approvedBy:evidence.approvedBy,approvedAt:evidence.approvedAt}};
}
export async function commandGroupEliminationBatch(input:unknown){
 enabled();const c=command.parse(input),{supabase}=await requireUser();
 let result;
 if(c.action==='SAVE'){
  const verified=await liveSourceBoundGroupPreview({query:c.query,entries:c.entries});
  if(verified.documents.status!=='DOCUMENT_MATCHES_VERIFIED_ONLY')throw Error('GROUP_BATCH_DOCUMENT_NOT_APPROVED');
  result=await supabase.rpc('save_financial_group_eliminations',{p_root:c.query.organization,p_from:c.query.from,p_to:c.query.to,p_expected_version:c.expectedVersion,p_entries:c.entries,p_reason:c.reason,p_request_id:c.requestId});
 }else{
  const r=await supabase.rpc('financial_group_elimination_context',{p_root:c.query.organization,p_from:c.query.from,p_to:c.query.to});
  if(r.error)throw Error(/DENIED/.test(r.error.message)?'REPORTING_ACCESS_DENIED':'REPORTING_GROUP_BATCH_UNAVAILABLE');
  const parsed=context.safeParse(r.data);if(!parsed.success)throw Error('REPORTING_GROUP_BATCH_INVALID');
  const selected=parsed.data.batches.find(b=>b.id===c.batchId);
  if(!selected||selected.root_organization_id!==c.query.organization||selected.period_from!==c.query.from||selected.period_to!==c.query.to)throw Error('REPORTING_ACCESS_DENIED');
  if(selected.status!=='DRAFT'||selected.version!==c.expectedVersion)throw Error('GROUP_BATCH_VERSION_CONFLICT');
  await liveSourceBoundGroupPreview({query:c.query,entries:selected.entries});
  result=await supabase.rpc('approve_financial_group_eliminations',{p_batch:c.batchId,p_expected_version:c.expectedVersion,p_reason:c.reason});
 }
 if(result.error)throw Error(/^GROUP_(BATCH|DOCUMENT)_[A-Z_]+$/.test(result.error.message)?result.error.message:'REPORTING_GROUP_BATCH_UNAVAILABLE');
 const response=z.object({id:uuid,version:z.number().int().positive(),status:z.enum(['DRAFT','APPROVED'])}).strict().safeParse(result.data);
 if(!response.success)throw Error('REPORTING_GROUP_BATCH_INVALID');
 return response.data;
}
