import {z} from 'zod';
import {requireUser} from './auth';
import {assertLiveStatements} from './financial-statement-live';
import {statementQuery} from '../lib/financial-statement-source';
import {classifyFinancialSourceScope} from '../lib/financial-reporting-scope';

export const scopeReadinessQuery=statementQuery.extend({scope:z.enum(['COMPANY_DIRECT','GROUP_WITH_SUBSIDIARIES'])});
export type ScopeReadinessIssue=
 |'CANONICAL_SOURCE_UNVERIFIED'|'BRANCH_REGISTRY_UNVERIFIED'|'DIRECT_OPENING_ALLOCATION_UNVERIFIED'
 |'GROUP_MEMBERSHIP_UNVERIFIED'|'GROUP_CONTROL_UNVERIFIED'
 |'GROUP_ELIMINATION_UNVERIFIED'|'GROUP_CURRENCY_AND_NCI_UNVERIFIED';
export type ScopeReadiness={
 status:'BLOCKED';scope:'COMPANY_DIRECT'|'GROUP_WITH_SUBSIDIARIES';organizationId:string;from:string;to:string;
 issues:ScopeReadinessIssue[];
 observation:{kind:'RLS_VISIBLE_ONLY';entityRecords:number;canonicalEvents:number;organizationDirectEvents:number;branchEvents:number}|null;
};

/** Off by default, restricted to preview/QA. This is evidence gathering only. */
export function assertScopeReadiness(){
 assertLiveStatements();
 if(process.env.FINANCIAL_SCOPE_PREFLIGHT!=='true'||process.env.VERCEL_ENV==='production')throw Error('REPORTING_SCOPE_PREFLIGHT_DISABLED');
}

function unpack<T>(r:{data:T;error:{message:string}|null}):T{
 if(r.error)throw Error('REPORTING_UNAVAILABLE');
 return r.data;
}

/**
 * Reads only metadata visible to the signed-in member, AFTER explicit permission
 * validation. RLS-visible rows are never promoted to a "complete source" claim.
 * Branch/group financial figures remain disabled until an authoritative RPC
 * attests all source revisions, branch openings and legal relationships.
 */
export async function liveScopeReadiness(input:unknown):Promise<ScopeReadiness>{
 assertScopeReadiness();
 const q=scopeReadinessQuery.parse(input),{supabase,user}=await requireUser();
 async function authorize(){
  const membership=unpack(await supabase.from('organization_members').select('organization_id')
   .eq('organization_id',q.organization).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle());
  if(!membership||unpack(await supabase.rpc('financial_core_can',{p_org:q.organization,p_scope:'financial_core.view'}))!==true)throw Error('REPORTING_ACCESS_DENIED');
 }
 await authorize();
 if(q.scope==='GROUP_WITH_SUBSIDIARIES'){
  // A visible organizations.parent_organization_id is NOT proof of legal control,
  // complete membership, effective dates, or permission for every subsidiary.
  await authorize();
  return{status:'BLOCKED',scope:q.scope,organizationId:q.organization,from:q.from,to:q.to,observation:null,issues:[
   'GROUP_MEMBERSHIP_UNVERIFIED','GROUP_CONTROL_UNVERIFIED','GROUP_ELIMINATION_UNVERIFIED','GROUP_CURRENCY_AND_NCI_UNVERIFIED',
  ]};
 }
 const [entitiesResponse,eventsResponse]=await Promise.all([
  supabase.from('organization_entities').select('id,organization_id,entity_type,active').eq('organization_id',q.organization).limit(1001),
  supabase.from('financial_events').select('id,organization_id,entity_id').eq('organization_id',q.organization)
   .in('status',['ACTUAL','REVERSED']).gte('event_date',q.from).lte('event_date',q.to).limit(5001),
 ]);
 const entities=unpack(entitiesResponse),events=unpack(eventsResponse);
 if(!Array.isArray(entities)||!Array.isArray(events)||entities.length>1000||events.length>5000)throw Error('REPORTING_UNAVAILABLE');
 // This count is diagnostic, NOT authoritative: RLS may filter invisible rows.
 const classified=classifyFinancialSourceScope(q.organization,entities.map(e=>({id:e.id,organizationId:e.organization_id,entityType:e.entity_type,active:e.active})),
  events.map(e=>({id:e.id,organizationId:e.organization_id,entityId:e.entity_id})));
 const observation={kind:'RLS_VISIBLE_ONLY' as const,entityRecords:entities.length,canonicalEvents:events.length,
  organizationDirectEvents:classified.filter(e=>e.scope==='ORGANIZATION_DIRECT').length,
  branchEvents:classified.filter(e=>e.scope==='BRANCH').length};
 const issues:ScopeReadinessIssue[]=['CANONICAL_SOURCE_UNVERIFIED','BRANCH_REGISTRY_UNVERIFIED','DIRECT_OPENING_ALLOCATION_UNVERIFIED'];
 // Even complete-looking visible events cannot prove that earlier opening lines,
 // legacy sources and journal lines are fully assigned to operating branches.
 await authorize();
 return{status:'BLOCKED',scope:q.scope,organizationId:q.organization,from:q.from,to:q.to,issues,observation};
}
