import {z} from 'zod';
import {normalizeStatementSource,statementSourceEnvelope,type StatementQuery,type StatementSourceSnapshot} from './financial-statement-source';
import {compileEventLedger} from './financial-event-ledger';
import {aggregateApprovedBranchOpenings} from './financial-branch-opening-aggregate';
import {previewVerifiedBranchAttribution} from './financial-branch-attribution';
import {branchStatementSourceLines} from './financial-branch-statements';
const id=z.string().min(1),money=z.string().regex(/^\d{1,20}(\.\d{1,4})?$/);
const split=z.object({branchId:id.nullable(),debit:money,credit:money});
export const branchReportEnvelope=z.object({
 version:z.literal(1),revision:z.string().regex(/^[0-9a-f]{32}$/),source:statementSourceEnvelope,
 entities:z.array(z.object({id,organizationId:id,entityType:id,active:z.boolean(),name:id})).max(1000),
 workspace:z.object({id,organizationId:id,fiscalStart:z.string().date(),currency:id,
  version:z.number().int().positive(),status:z.literal('APPROVED'),
  approvedOpening:z.array(z.object({itemId:id,accountCode:id,debit:money,credit:money}))}),
 distribution:z.object({status:z.literal('APPROVED'),kind:z.literal('OPENING_DISTRIBUTION_EVIDENCE_ONLY'),
  organizationId:id,openingWorkspaceId:id,openingVersion:z.number().int().positive(),openingDigest:id,
  approvedBy:id,entries:z.record(id,z.array(split)),journalCoverageComplete:z.literal(false)}),
 journalEvidence:z.object({status:z.literal('RLS_MATCHED_JOURNAL_REFERENCES_ONLY'),organizationId:id,
  links:z.array(z.object({journalId:id,branchId:id.nullable(),scope:z.enum(['ORGANIZATION_DIRECT','BRANCH'])}))}),
});
/** Server-only trusted RPC payload; never accept this envelope from a browser.
 * First validate the complete company ledger, then reconcile EVERY segment.
 * The service additionally verifies the same company against live source attestations.
 */
export function compileBranchReport(raw:unknown,query:StatementQuery,branchId:string|null):StatementSourceSnapshot{
 const p=branchReportEnvelope.parse(raw);
 const company=normalizeStatementSource(p.source,query);
 if(p.entities.some(e=>e.organizationId!==query.organization)||new Set(p.entities.map(e=>e.id)).size!==p.entities.length)
  throw Error('REPORTING_BRANCH_REGISTRY_INVALID');
 const branchIds=p.entities.filter(e=>e.entityType==='BRANCH').map(e=>e.id);
 if(branchId!==null&&!branchIds.includes(branchId))throw Error('REPORTING_BRANCH_ACCESS_DENIED');
 const {source}=compileEventLedger(p.source);
 const opening=aggregateApprovedBranchOpenings({source,branchIds,sourceRevision:p.revision,
  workspace:p.workspace,distribution:p.distribution});
 if(opening.status!=='OPENING_ATTRIBUTION_RECONCILED_PREVIEW_ONLY')throw Error('REPORTING_BRANCH_OPENING_INVALID');
 const reconciled=previewVerifiedBranchAttribution({source,branchIds,
  coverage:{complete:true,scope:'ORGANIZATION_ALL_ENTITIES',sourceCount:branchStatementSourceLines(source).length,revision:p.revision},
  journalEvidence:p.journalEvidence,openingEvidence:opening.openingEvidence});
 if(reconciled.status!=='RECONCILED_SEGMENTS_PREVIEW_ONLY')throw Error('REPORTING_BRANCH_RECONCILIATION_REQUIRED');
 const ids=new Set(p.journalEvidence.links.filter(l=>l.branchId===branchId).map(l=>l.journalId));
 const events=p.source.events.filter(e=>ids.has(e.id));
 const rows=p.source.opening.map(row=>{
  const allocation=opening.openingEvidence?.rows.find(r=>r.accountCode===row.accountId)?.allocations.find(a=>a.branchId===branchId);
  return{accountId:row.accountId,debit:allocation?.debit??'0.0000',credit:allocation?.credit??'0.0000'};
 });
 // Controls on the incoming envelope refer to the COMPANY and were checked
 // above. The segment engine supplies independent balance/cash reconciliations.
 const result=normalizeStatementSource({...p.source,controls:undefined,opening:rows,events,
  coverage:{...p.source.coverage,eventCount:events.length,lineCount:events.reduce((n,e)=>n+e.lines.length,0)}},query);
 const expected=reconciled.segments.find(s=>s.branchId===branchId)!.statement;
 if(JSON.stringify(result.statements)!==JSON.stringify(expected)||company.statements.organizationId!==query.organization)
  throw Error('REPORTING_BRANCH_RECONCILIATION_REQUIRED');
 return{...result,scope:branchId===null?'ORGANIZATION_DIRECT':'BRANCH',branchId};
}
