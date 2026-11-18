import {requireUser} from './auth';
import {liveStatementSource} from './financial-statement-live';
import {statementSourceEnvelope,normalizeStatementSource,type StatementQuery} from '../lib/financial-statement-source';
import {frozenDimensionEvidence} from '../lib/financial-frozen-dimension-evidence';
import {compileRegisteredDimensionalStatements} from '../lib/financial-dimensional-event-source';
import {assertStableFinancialReplay} from '../lib/financial-source-replay';
/** Uses only the immutable evidence recorded in the actual close transaction. */
export async function frozenDimensionalStatements(query:StatementQuery,raw:unknown,closureId:string){
 const p=statementSourceEnvelope.parse(raw),company=normalizeStatementSource(p,query),{supabase}=await requireUser();
 const read=async()=>{
  const r=await supabase.rpc('financial_closed_dimension_context',{p_org:query.organization,p_from:query.from,p_to:query.to});
  if(r.error)throw Error(r.error.message.includes('DENIED')?'REPORTING_ACCESS_DENIED':'REPORTING_CLOSED_DIMENSIONS_UNAVAILABLE');
  const parsed=frozenDimensionEvidence.safeParse(r.data);
  if(!parsed.success)throw Error('REPORTING_CLOSED_DIMENSIONS_UNAVAILABLE');
  const f=parsed.data;
  if(f.closureId!==closureId||f.organizationId!==query.organization||f.from!==query.from||f.to!==query.to||f.evidence.registry.organizationId!==query.organization)throw Error('REPORTING_CLOSED_DIMENSIONS_UNAVAILABLE');
  return f;
 };
 const before=await read();assertStableFinancialReplay(company,await liveStatementSource(query));
 const e=before.evidence;
 const result=compileRegisteredDimensionalStatements(p,query,{organizationId:query.organization,revision:e.registry.revision,links:e.links},e.registry,e.workspace,e.distribution);
 assertStableFinancialReplay(company,await liveStatementSource(query));assertStableFinancialReplay(before,await read());
 return{...result,status:'VERIFIED_DIMENSIONAL_STATEMENTS' as const,organizationId:query.organization,from:query.from,to:query.to,currency:p.currency,
  closureId,frozenCenterNames:e.names};
}
