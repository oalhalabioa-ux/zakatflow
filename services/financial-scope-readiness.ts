import {z} from 'zod';
import {requireUser} from './auth';
import {assertLiveStatements} from './financial-statement-live';
import {statementQuery} from '../lib/financial-statement-source';

export const scopeReadinessQuery=statementQuery.extend({scope:z.enum(['BRANCH_COMBINED','GROUP_CONSOLIDATED'])});
export type ScopeReadinessIssue=
 |'CANONICAL_SOURCE_UNVERIFIED'|'BRANCH_REGISTRY_UNVERIFIED'|'UNASSIGNED_CANONICAL_EVENTS'
 |'BRANCH_OPENING_ALLOCATION_UNVERIFIED'|'INTERBRANCH_CLEARING_UNVERIFIED'
 |'GROUP_MEMBERSHIP_UNVERIFIED'|'GROUP_CONTROL_UNVERIFIED'
 |'GROUP_ELIMINATION_UNVERIFIED'|'GROUP_CURRENCY_AND_NCI_UNVERIFIED';
export type ScopeReadiness={
 status:'BLOCKED';scope:'BRANCH_COMBINED'|'GROUP_CONSOLIDATED';organizationId:string;from:string;to:string;
 issues:ScopeReadinessIssue[];
 observation:{kind:'RLS_VISIBLE_ONLY';entityRecords:number;canonicalEvents:number;unassignedEvents:number}|null;
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
 if(q.scope==='GROUP_CONSOLIDATED'){
  // A visible organizations.parent_organization_id is NOT proof of legal control,
  // complete membership, effective dates, or permission for every subsidiary.
  await authorize();
  return{status:'BLOCKED',scope:q.scope,organizationId:q.organization,from:q.from,to:q.to,observation:null,issues:[
   'GROUP_MEMBERSHIP_UNVERIFIED','GROUP_CONTROL_UNVERIFIED','GROUP_ELIMINATION_UNVERIFIED','GROUP_CURRENCY_AND_NCI_UNVERIFIED',
  ]};
 }
 const [entitiesResponse,eventsResponse]=await Promise.all([
  supabase.from('organization_entities').select('id,entity_type,active').eq('organization_id',q.organization).limit(1001),
  supabase.from('financial_events').select('id,entity_id').eq('organization_id',q.organization)
   .in('status',['ACTUAL','REVERSED']).gte('event_date',q.from).lte('event_date',q.to).limit(5001),
 ]);
 const entities=unpack(entitiesResponse),events=unpack(eventsResponse);
 if(!Array.isArray(entities)||!Array.isArray(events)||entities.length>1000||events.length>5000)throw Error('REPORTING_UNAVAILABLE');
 // This count is diagnostic, NOT authoritative: RLS may filter invisible rows.
 const observation={kind:'RLS_VISIBLE_ONLY' as const,entityRecords:entities.length,canonicalEvents:events.length,
  unassignedEvents:events.filter(e=>!e.entity_id).length};
 const issues:ScopeReadinessIssue[]=['CANONICAL_SOURCE_UNVERIFIED','BRANCH_REGISTRY_UNVERIFIED',
  'BRANCH_OPENING_ALLOCATION_UNVERIFIED','INTERBRANCH_CLEARING_UNVERIFIED'];
 if(observation.unassignedEvents)issues.push('UNASSIGNED_CANONICAL_EVENTS');
 // Even complete-looking visible events cannot prove that earlier opening lines,
 // legacy sources and journal lines are fully assigned to operating branches.
 await authorize();
 return{status:'BLOCKED',scope:q.scope,organizationId:q.organization,from:q.from,to:q.to,issues,observation};
}
