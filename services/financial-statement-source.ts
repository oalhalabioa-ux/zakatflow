import {requireUser} from './auth';
import {assertFinancialReportingSourceQA} from './financial-reporting-source';
import {normalizeStatementSource,statementQuery} from '../lib/financial-statement-source';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
/** Deliberately loopback-only. The fixture RPC/configuration does not exist on hosted QA.
 * Do not widen this gate to claim a live approved ledger exists. */
export function assertLocalStatementSource(){assertFinancialReportingSourceQA();const u=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);if(process.env.FINANCIAL_STATEMENTS_LOCAL_QA!=='true'||u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('FINANCIAL_REPORTS_SOURCE_DISABLED')}
function read<T>(r:{data:T;error:unknown}):T{if(r.error)throw Error('STATEMENT_SOURCE_UNAVAILABLE');return r.data}
async function session(){assertLocalStatementSource();return requireUser()}
async function authorize(supabase:SupabaseClient,userId:string,organization:string){const membership=read(await supabase.from('organization_members').select('organization_id').eq('organization_id',organization).eq('user_id',userId).eq('status','ACTIVE').maybeSingle());if(!membership||read(await supabase.rpc('financial_core_can',{p_org:organization,p_permission:'financial_core.view'}))!==true)throw Error('FINANCIAL_SOURCE_ACCESS_DENIED')}
export async function financialStatementContext(){const{supabase,user}=await session();const parsed=z.array(z.object({organizationId:z.string().uuid(),name:z.string(),fiscalStart:z.string().date(),fiscalEnd:z.string().date(),currency:z.string()})).max(100).safeParse(read(await supabase.rpc('financial_statement_qa_context'))??[]);if(!parsed.success)throw Error('STATEMENT_SOURCE_INVALID');for(const row of parsed.data)await authorize(supabase,user.id,row.organizationId);return parsed.data}
export async function financialStatementSource(input:unknown){const q=statementQuery.parse(input),{supabase,user}=await session();
 await authorize(supabase,user.id,q.organization);
 const raw=read(await supabase.rpc('financial_statement_qa_snapshot',{p_org:q.organization,p_from:q.from,p_to:q.to}));
 const snapshot=normalizeStatementSource(raw,q);
 await authorize(supabase,user.id,q.organization);return snapshot;
}
