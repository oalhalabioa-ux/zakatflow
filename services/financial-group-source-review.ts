import {assertLiveStatements,liveStatementContext,liveStatementSource} from './financial-statement-live';
import {type StatementSourceSnapshot,statementQuery} from '../lib/financial-statement-source';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
/** Accessible-company worksheet only. Visible parent pointers cannot attest a
 * complete control registry, so neither sums nor consolidated statements are emitted. */
export async function liveGroupSourceReview(input:unknown){
 assertLiveStatements();const q=statementQuery.parse(input);
 async function membership(){
  const context=await liveStatementContext();
  const registry=new Map<string,{id:string;name:string;parent:string|null}>();
  for(const row of context){const value={id:row.organizationId,name:row.name,parent:row.parentOrganizationId};const existing=registry.get(value.id);if(existing&&existing.parent!==value.parent)throw Error('REPORTING_GROUP_HIERARCHY_INVALID');registry.set(value.id,value)}
  if(!registry.has(q.organization))throw Error('REPORTING_ACCESS_DENIED');
  const ids=new Set([q.organization]);let changed=true;
  while(changed){changed=false;for(const row of registry.values())if(row.parent&&ids.has(row.parent)&&!ids.has(row.id)){ids.add(row.id);changed=true}}
  if(ids.size>100)throw Error('REPORTING_GROUP_TOO_LARGE');
  for(const id of ids){const seen=new Set<string>();let node:string|null=id;while(node&&ids.has(node)){if(seen.has(node))throw Error('REPORTING_GROUP_HIERARCHY_INVALID');seen.add(node);node=registry.get(node)?.parent??null}}
  return{members:[...ids].sort().map(id=>registry.get(id)!)};
 }
 const before=await membership();const members=[];const sources=new Map<string,StatementSourceSnapshot>();
 for(const member of before.members){
  const s=await liveStatementSource({...q,organization:member.id});
  if(s.origin!=='LIVE_CANONICAL_EVENTS'||s.scope!=='ORGANIZATION_ALL_ENTITIES'||s.branchId!==undefined||s.statements.organizationId!==member.id||s.statements.from!==q.from||s.statements.to!==q.to)throw Error('REPORTING_GROUP_SOURCE_INVALID');
  sources.set(member.id,s);
  members.push({organizationId:member.id,name:member.name,parentOrganizationId:member.parent,currency:s.statements.currency,income:s.statements.income,position:s.statements.position,policyId:s.policyId,openingSourceId:s.openingSourceId});
 }
 assertStableFinancialReplay(before,await membership());
 // Reauthorize every contributing company after the independent reads.
 for(const member of members){const s=await liveStatementSource({...q,organization:member.organizationId});assertStableFinancialReplay(sources.get(member.organizationId),s)}
 return{status:'VISIBLE_COMPANIES_REVIEW_ONLY' as const,organizationId:q.organization,from:q.from,to:q.to,registryComplete:false as const,consolidated:false as const,members};
}
