import {requireUser} from './auth';
import {z} from 'zod';
import {budgetSourceQuery,normalizeBudgetSource,type SourceContext,type SourcePlan,type BudgetSourceQuery} from '../lib/financial-budget-source';
import type {SupabaseClient} from '@supabase/supabase-js';
const CORE_QA='https://wtzgzmcgcqouziqzsfnl.supabase.co';
export function assertFinancialReportingSourceQA(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL??'';let local=false;try{const u=new URL(url);local=u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash}catch{}
 if(process.env.FINANCIAL_REPORTS_SOURCE_QA!=='true'||process.env.VERCEL_ENV==='production'||(!local&&url!==CORE_QA))throw Error('FINANCIAL_REPORTS_SOURCE_DISABLED');
}
function data<T>(r:{data:T;error:unknown},code='FINANCIAL_SOURCE_UNAVAILABLE'):T{if(r.error)throw Error(code);return r.data}
const ownership=z.object({plan_id:z.string().uuid(),organization_id:z.string().uuid(),entity_id:z.string().uuid().nullable(),cost_center_id:z.string().uuid().nullable(),fiscal_start:z.string().date()});
type Ownership=z.infer<typeof ownership>;
async function member(client:SupabaseClient,userId:string,organization:string){const m=data(await client.from('organization_members').select('organization_id').eq('organization_id',organization).eq('user_id',userId).eq('status','ACTIVE').maybeSingle());if(!m)throw Error('FINANCIAL_SOURCE_ACCESS_DENIED')}
async function can(client:SupabaseClient,o:Ownership){const allowed=data(await client.rpc('financial_budget_can',{p_org:o.organization_id,p_entity:o.entity_id,p_center:o.cost_center_id,p_write:false}));if(allowed!==true)throw Error('FINANCIAL_SOURCE_ACCESS_DENIED')}
function planRecord(raw:unknown,o:Ownership):SourcePlan{const p=z.object({id:z.string().uuid(),name:z.string(),fiscal_year:z.number().int(),currency:z.string().regex(/^[A-Z]{3}$/),scenario:z.string()}).parse(raw);if(p.id!==o.plan_id)throw Error('BUDGET_SOURCE_SCOPE_MISMATCH');return{id:p.id,organizationId:o.organization_id,name:p.name,year:p.fiscal_year,currency:p.currency,scenario:p.scenario,fiscalStart:o.fiscal_start,entityId:o.entity_id,costCenterId:o.cost_center_id}}
/** Uses only the verified caller's RLS client. No admin client or writes. */
export async function financialReportingContext():Promise<SourceContext>{assertFinancialReportingSourceQA();const{user,supabase}=await requireUser();
 const memberships=data(await supabase.from('organization_members').select('organization_id').eq('user_id',user.id).eq('status','ACTIVE'))??[];const ids=memberships.map(m=>String(m.organization_id));if(!ids.length)return{organizations:[],plans:[],statements:{available:false,reason:'BALANCED_LEDGER_ADAPTER_REQUIRED'}};
 const organizations=data(await supabase.from('organizations').select('id,name,base_currency').in('id',ids))??[];
 const own=z.array(ownership).parse(data(await supabase.from('financial_budget_plan_ownership').select('plan_id,organization_id,entity_id,cost_center_id,fiscal_start').in('organization_id',ids))??[]);
 const visible:Ownership[]=[];for(const o of own){const allowed=data(await supabase.rpc('financial_budget_can',{p_org:o.organization_id,p_entity:o.entity_id,p_center:o.cost_center_id,p_write:false}));if(allowed===true)visible.push(o)}
 const records=visible.length?data(await supabase.from('budget_plans').select('id,name,fiscal_year,currency,scenario').in('id',visible.map(o=>o.plan_id))):[];
 const plans=(records??[]).map(p=>planRecord(p,visible.find(o=>o.plan_id===p.id)!));
 // Recheck current access after the reads; revoked plans are not returned.
 const current:SourcePlan[]=[];for(const p of plans){const o=visible.find(o=>o.plan_id===p.id)!;await member(supabase,user.id,o.organization_id);await can(supabase,o);current.push(p)}
 return{organizations:organizations.filter(o=>current.some(p=>p.organizationId===o.id)).map(o=>({id:String(o.id),name:String(o.name),currency:String(o.base_currency)})),plans:current,statements:{available:false,reason:'BALANCED_LEDGER_ADAPTER_REQUIRED'}};
}
export async function financialReportingBudget(input:unknown){assertFinancialReportingSourceQA();const{user,supabase}=await requireUser(),q=budgetSourceQuery.parse(input);await member(supabase,user.id,q.organization);
 const rawOwnership=data(await supabase.from('financial_budget_plan_ownership').select('plan_id,organization_id,entity_id,cost_center_id,fiscal_start').eq('plan_id',q.plan).eq('organization_id',q.organization).maybeSingle(),'FINANCIAL_SOURCE_ACCESS_DENIED');if(!rawOwnership)throw Error('FINANCIAL_SOURCE_ACCESS_DENIED');const o=ownership.parse(rawOwnership);
 await can(supabase,o);
 const plan=planRecord(data(await supabase.from('budget_plans').select('id,name,fiscal_year,currency,scenario').eq('id',q.plan).single()),o);
 const raw=data(await supabase.rpc('financial_budget_report',{p_plan:q.plan}));
 const report=normalizeBudgetSource(raw,q,plan);
 await member(supabase,user.id,q.organization);await can(supabase,o);
 return report;
}
