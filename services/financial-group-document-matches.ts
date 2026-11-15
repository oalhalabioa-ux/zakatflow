import {z} from 'zod';
import {requireUser} from './auth';
import type {SourceBoundAdjustment} from '../lib/financial-group-source-bound-adjustments';
export async function readGroupDocumentMatches(entries:readonly Pick<SourceBoundAdjustment,'documentMatchId'>[]){
 const ids=[...new Set(entries.flatMap(e=>e.documentMatchId?[e.documentMatchId]:[]))].sort();
 if(!ids.length)return[];
 const {supabase}=await requireUser();
 const r=await supabase.rpc('financial_group_document_context',{p_matches:ids});
 if(r.error)throw Error(/DENIED/.test(r.error.message)?'REPORTING_ACCESS_DENIED':'REPORTING_GROUP_DOCUMENT_UNAVAILABLE');
 return r.data;
}
const reason=z.string().trim().min(8).max(1000),uuid=z.string().uuid();
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
