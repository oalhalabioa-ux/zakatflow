import {z} from 'zod';
import {liveBranchReport} from './financial-branch-report';
import {compileBranchReportWithSource} from '../lib/financial-branch-report';
import {requireUser} from './auth';
import {assertLiveStatements,liveStatementSource} from './financial-statement-live';
import {normalizeStatementSource,statementQuery,statementSourceEnvelope} from '../lib/financial-statement-source';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
import {costCenterIncome,type CenterEvidence} from '../lib/financial-cost-center-income';
const original=/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):[A-Z][A-Z0-9_]*$/i;
/** Only exact persisted recognition-line dimensions are eligible. Legacy or
 * synthetic lines need a producing-module adapter, never account-name guesses. */
export async function liveCostCenterIncome(input:unknown,selection?:unknown){
 assertLiveStatements();const q=statementQuery.parse(input),{supabase}=await requireUser();
 const branch=selection===undefined?undefined:z.union([z.literal('HQ'),z.string().uuid()]).parse(selection);
 const response=await supabase.rpc(branch===undefined?'financial_statement_live_snapshot':'financial_branch_report_source',{p_org:q.organization,p_from:q.from,p_to:q.to});
 if(response.error)throw Error('REPORTING_CENTER_SOURCE_UNAVAILABLE');
 if((branch===undefined?response.data:response.data?.source)?.closureId)throw Error('REPORTING_CLOSED_DIMENSIONS_UNAVAILABLE');
 const selected=branch===undefined?null:compileBranchReportWithSource(response.data,q,branch==='HQ'?null:branch);
 const p=statementSourceEnvelope.parse(selected?.source??response.data),company=selected?.snapshot??normalizeStatementSource(p,q);
 const verify=()=>branch===undefined?liveStatementSource(q):liveBranchReport(q,branch);
 assertStableFinancialReplay(company,await verify());
 const required=p.events.filter(e=>e.date>=p.fiscalStart&&e.date<=p.to).flatMap(e=>e.lines.map(l=>({eventId:e.id,lineId:l.id,originalId:original.exec(l.id)?.[1]})));
 if(required.some(l=>!l.originalId))throw Error('REPORTING_CENTER_SOURCE_UNRESOLVED');
 async function dimensions():Promise<CenterEvidence>{
  const centers=await supabase.from('organization_cost_centers').select('id,organization_id,name,active').eq('organization_id',q.organization).limit(1001);
  if(centers.error||!Array.isArray(centers.data)||centers.data.length>1000||centers.data.some(c=>c.organization_id!==q.organization))throw Error('REPORTING_CENTER_SOURCE_UNAVAILABLE');
  const ids=[...new Set(required.map(l=>l.originalId!))],lines:{id:string;event_id:string;organization_id:string;cost_center_id:string|null}[]=[];
  for(let offset=0;offset<ids.length;offset+=150){const batch=ids.slice(offset,offset+150),r=await supabase.from('financial_event_lines').select('id,event_id,organization_id,cost_center_id').eq('organization_id',q.organization).in('id',batch).limit(batch.length+1);
   if(r.error||!Array.isArray(r.data))throw Error('REPORTING_CENTER_SOURCE_UNAVAILABLE');lines.push(...r.data);
  }
  const byId=new Map(lines.map(l=>[l.id,l]));
  if(lines.length!==ids.length||byId.size!==ids.length)throw Error('REPORTING_CENTER_SOURCE_UNRESOLVED');
  return{organizationId:q.organization,centers:centers.data.map(c=>({id:c.id,name:c.name,active:c.active})),links:required.map(l=>{const row=byId.get(l.originalId!);if(!row||row.event_id!==l.eventId||row.organization_id!==q.organization)throw Error('REPORTING_CENTER_SOURCE_UNRESOLVED');return{eventId:l.eventId,lineId:l.lineId,centerId:row.cost_center_id}})};
 }
 const evidence=await dimensions();
 const result=costCenterIncome(p,q,evidence);
 // Reauthorize and verify both money and dimensions after independent reads.
 assertStableFinancialReplay(company,await verify());
 assertStableFinancialReplay(evidence,await dimensions());
 return{...result,branch:branch??'ALL'};
}
