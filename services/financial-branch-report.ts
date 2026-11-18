import {z} from 'zod';
import {requireUser} from './auth';
import {assertLiveStatements,liveStatementSource} from './financial-statement-live';
import {branchReportEnvelope,compileBranchReport} from '../lib/financial-branch-report';
import {normalizeStatementSource,statementQuery} from '../lib/financial-statement-source';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';

export async function liveBranchReport(input:unknown,selection:unknown){
 assertLiveStatements();
 const query=statementQuery.parse(input),branch=z.union([z.literal('HQ'),z.string().uuid()]).parse(selection);
 const {supabase}=await requireUser();
 const response=await supabase.rpc('financial_branch_report_source',{
  p_org:query.organization,p_from:query.from,p_to:query.to,
 });
 if(response.error)throw Error(response.error.message.match(/REPORTING_[A-Z_]+/)?.[0]??'REPORTING_BRANCH_SOURCE_UNAVAILABLE');
 const envelope=branchReportEnvelope.parse(response.data);
 // Existing source-level lineage, VAT, legacy, replay and membership checks
 // remain mandatory. Match them to the atomic source, not just its totals.
 const verified=await liveStatementSource(query);
 assertStableFinancialReplay(normalizeStatementSource(envelope.source,query),verified);
 return compileBranchReport(envelope,query,branch==='HQ'?null:branch);
}

export async function liveReportBranches(organization:unknown){
 assertLiveStatements();const org=z.string().uuid().parse(organization),{supabase,user}=await requireUser();
 async function authorize(){
  const member=await supabase.from('organization_members').select('organization_id')
   .eq('organization_id',org).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle();
  const permission=await supabase.rpc('financial_core_can',{p_org:org,p_scope:'financial_core.view'});
  if(member.error||!member.data||permission.error||permission.data!==true)throw Error('REPORTING_ACCESS_DENIED');
 }
 await authorize();
 const result=await supabase.from('organization_entities').select('id,organization_id,name,active')
  .eq('organization_id',org).eq('entity_type','BRANCH').limit(1001);
 if(result.error||!Array.isArray(result.data)||result.data.length>1000||result.data.some(e=>e.organization_id!==org))
  throw Error('REPORTING_BRANCH_SOURCE_UNAVAILABLE');
 await authorize();
 return{organizationId:org,branches:result.data.map(e=>({id:e.id,name:e.name,active:e.active}))};
}
