import {z} from 'zod';
import type {SourceBoundAdjustment} from './financial-group-source-bound-adjustments';
const uuid=z.string().uuid();
export const groupDocumentEvidenceSchema=z.array(z.object({id:uuid,
 status:z.enum(['DRAFT','APPROVED','REVOKED']),leftOrganizationId:uuid,rightOrganizationId:uuid,
 leftEventId:uuid,rightEventId:uuid,evidenceReference:z.string().min(8).max(1000),
 approvedBy:uuid.nullable(),approvedAt:z.string().nullable(),sourceCurrent:z.boolean()
}).strict()).max(200);
/** Documentary approval is independent of amounts, open items and elimination
 * approval. Missing pairing may be previewed, but never counted as approved. */
export function verifyGroupDocumentMatches(entries:readonly Pick<SourceBoundAdjustment,'id'|'documentMatchId'|'debitSource'|'creditSource'>[],input:unknown){
 const parsed=groupDocumentEvidenceSchema.safeParse(input);
 if(!parsed.success)throw Error('REPORTING_GROUP_DOCUMENT_EVIDENCE_INVALID');
 const rows=parsed.data,map=new Map(rows.map(r=>[r.id,r]));
 const requested=new Set(entries.flatMap(e=>e.documentMatchId?[e.documentMatchId]:[]));
 if(map.size!==rows.length||map.size!==requested.size||rows.some(r=>!requested.has(r.id)))throw Error('REPORTING_GROUP_DOCUMENT_EVIDENCE_INVALID');
 const missing:string[]=[],bindings:{adjustmentId:string;documentMatchId:string}[]=[];
 for(const e of entries){
  if(!e.documentMatchId){missing.push(e.id);continue;}
  const r=map.get(e.documentMatchId);
  if(!r||r.status!=='APPROVED'||!r.approvedBy||!r.approvedAt||!r.sourceCurrent)throw Error('GROUP_ADJUSTMENT_DOCUMENT_NOT_APPROVED');
  const pair=[e.debitSource,e.creditSource].map(s=>JSON.stringify([s.organizationId,s.eventId])).sort();
  const actual=[[r.leftOrganizationId,r.leftEventId],[r.rightOrganizationId,r.rightEventId]].map(s=>JSON.stringify(s)).sort();
  if(pair[0]!==actual[0]||pair[1]!==actual[1]||r.leftOrganizationId===r.rightOrganizationId)throw Error('GROUP_ADJUSTMENT_DOCUMENT_MISMATCH');
  bindings.push({adjustmentId:e.id,documentMatchId:r.id});
 }
 return{status:missing.length?'DOCUMENT_MATCHING_REQUIRED' as const:'DOCUMENT_MATCHES_VERIFIED_ONLY' as const,missingAdjustmentIds:missing,bindings};
}
