import {requireUser} from './auth';
import {assertLiveStatements,liveStatementSource} from './financial-statement-live';
import {centerBranchRegistry} from './financial-center-branch-registry';
import {observeCanonicalJournalBranches} from './financial-branch-journal-source';
import {statementQuery,statementSourceEnvelope,normalizeStatementSource} from '../lib/financial-statement-source';
import {compileEventLedger} from '../lib/financial-event-ledger';
import {compileRegisteredDimensionalStatements} from '../lib/financial-dimensional-event-source';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
import type {DimensionalOpeningWorkspace,DimensionalOpeningDistribution} from '../lib/financial-dimensional-openings';
const original=/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):[A-Z][A-Z0-9_]*$/i;
/** Staged live adapter: replays money, memberships, registry and allocations.
 * Legacy dimensions and frozen closed-year allocations remain explicit errors.
 */
export async function liveDimensionalStatements(input:unknown){
 assertLiveStatements();const q=statementQuery.parse(input),{supabase}=await requireUser();
 const response=await supabase.rpc('financial_statement_live_snapshot',{p_org:q.organization,p_from:q.from,p_to:q.to});
 if(response.error)throw Error('REPORTING_DIMENSION_SOURCE_UNAVAILABLE');
 if(response.data?.closureId)throw Error('REPORTING_CLOSED_DIMENSIONS_UNAVAILABLE');
 const p=statementSourceEnvelope.parse(response.data),company=normalizeStatementSource(p,q),{source}=compileEventLedger(p);
 assertStableFinancialReplay(company,await liveStatementSource(q));
 const journalIds=new Set(source.journals.map(j=>j.id));
 const required=p.events.filter(e=>journalIds.has(e.id)).flatMap(e=>e.lines.map(l=>({eventId:e.id,lineId:l.id,originalId:original.exec(l.id)?.[1]})));
 if(required.some(l=>!l.originalId))throw Error('REPORTING_DIMENSION_SOURCE_UNRESOLVED');
 async function evidence(){
  const registry=await centerBranchRegistry({organization:q.organization});
  const branches=await observeCanonicalJournalBranches(q.organization,source.journals);
  const branchByEvent=new Map(branches.links.map(l=>[l.journalId,l.branchId]));
  const ids=[...new Set(required.map(l=>l.originalId!))];
  const rows:{id:string;organization_id:string;event_id:string;cost_center_id:string|null}[]=[];
  for(let offset=0;offset<ids.length;offset+=150){const batch=ids.slice(offset,offset+150);
   const r=await supabase.from('financial_event_lines').select('id,organization_id,event_id,cost_center_id').eq('organization_id',q.organization).in('id',batch).limit(batch.length+1);
   if(r.error||!Array.isArray(r.data))throw Error('REPORTING_DIMENSION_SOURCE_UNAVAILABLE');rows.push(...r.data);
  }
  const byId=new Map(rows.map(r=>[r.id,r]));
  if(rows.length!==ids.length||byId.size!==ids.length)throw Error('REPORTING_DIMENSION_SOURCE_UNRESOLVED');
  const links=required.map(l=>{const r=byId.get(l.originalId!);
   if(!r||r.organization_id!==q.organization||r.event_id!==l.eventId||!branchByEvent.has(l.eventId))throw Error('REPORTING_DIMENSION_SOURCE_UNRESOLVED');
   return{eventId:l.eventId,lineId:l.lineId,centerId:r.cost_center_id,branchId:branchByEvent.get(l.eventId)!};
  });
  let workspace:DimensionalOpeningWorkspace|null=null,distribution:DimensionalOpeningDistribution|null=null;
  if(!p.openingSourceId.startsWith('FIRST_ACTIVITY:')){
   const r=await supabase.rpc('financial_dimensional_opening_report_context',{p_org:q.organization,p_fiscal_start:p.fiscalStart});
   const d=r.data;
   if(r.error||!d||d.status!=='APPROVED'||d.organizationId!==q.organization||d.openingWorkspaceId!==p.openingSourceId||d.fiscalStart!==p.fiscalStart)
    throw Error('REPORTING_DIMENSION_OPENING_UNAVAILABLE');
   const w=await supabase.from('financial_opening_workspaces').select('id,organization_id,fiscal_start,currency,version,status,approved_opening').eq('id',d.openingWorkspaceId).eq('organization_id',q.organization).maybeSingle();
   if(w.error||!w.data||w.data.status!=='APPROVED'||w.data.version!==d.openingVersion||!Array.isArray(w.data.approved_opening))throw Error('REPORTING_DIMENSION_OPENING_UNAVAILABLE');
   workspace={id:w.data.id,organizationId:w.data.organization_id,fiscalStart:w.data.fiscal_start,currency:w.data.currency,version:w.data.version,digest:d.openingDigest,status:'APPROVED',items:w.data.approved_opening.map((r:{itemId:string;accountCode:string;debit:string;credit:string})=>({itemId:r.itemId,accountId:r.accountCode,debit:r.debit,credit:r.credit}))};
   distribution={id:d.id,organizationId:d.organizationId,openingWorkspaceId:d.openingWorkspaceId,openingVersion:d.openingVersion,openingDigest:d.openingDigest,status:'APPROVED',approvedBy:d.approvedBy,revision:String(d.version),entries:d.entries};
  }
  return{registry,links,workspace,distribution};
 }
 const before=await evidence();
 const result=compileRegisteredDimensionalStatements(p,q,{organizationId:q.organization,revision:before.registry.revision,links:before.links},before.registry,before.workspace,before.distribution);
 assertStableFinancialReplay(company,await liveStatementSource(q));
 assertStableFinancialReplay(before,await evidence());
 return{...result,status:'VERIFIED_DIMENSIONAL_STATEMENTS' as const,organizationId:q.organization,from:q.from,to:q.to,currency:p.currency};
}
