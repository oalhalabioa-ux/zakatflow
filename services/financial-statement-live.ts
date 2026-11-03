import {requireUser} from './auth';
import {assertOpeningWorkspace} from './financial-opening-workspace';
import {normalizeStatementSource,statementQuery} from '../lib/financial-statement-source';
export function assertLiveStatements(){assertOpeningWorkspace();if(process.env.FINANCIAL_STATEMENTS_LIVE!=='true')throw Error('REPORTING_DISABLED')}
function read<T>(r:{data:T;error:{message:string}|null}){if(r.error)throw Error(r.error.message.match(/REPORTING_[A-Z_]+/)?.[0]??'REPORTING_UNAVAILABLE');return r.data}
export async function liveStatementContext(){assertLiveStatements();const{supabase}=await requireUser();return read(await supabase.rpc('financial_statement_live_context'))}
export async function liveStatementSource(input:unknown){
 assertLiveStatements();const q=statementQuery.parse(input),{supabase,user}=await requireUser();
 const raw=read(await supabase.rpc('financial_statement_live_snapshot',{p_org:q.organization,p_from:q.from,p_to:q.to}));
 if(raw?.origin!=='LIVE_CANONICAL_EVENTS')throw Error('REPORTING_UNAVAILABLE');
 const result=normalizeStatementSource(raw,q);
 const membership=read(await supabase.from('organization_members').select('organization_id').eq('organization_id',q.organization).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle());
 if(!membership||read(await supabase.rpc('financial_core_can',{p_org:q.organization,p_scope:'financial_core.view'}))!==true)throw Error('REPORTING_ACCESS_DENIED');
 return result;
}
