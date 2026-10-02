import {requireUser} from './auth';
import {z} from 'zod';
export const FINANCIAL_CORE_QA='wtzgzmcgcqouziqzsfnl';
export function assertFinancialBudgetQA(){
 if(process.env.FINANCIAL_BUDGET_UI_QA!=='true'||process.env.NEXT_PUBLIC_SUPABASE_URL!==`https://${FINANCIAL_CORE_QA}.supabase.co`)throw new Error('FINANCIAL_BUDGET_QA_ONLY');
}
const uuid=z.string().uuid();
async function session(){assertFinancialBudgetQA();return requireUser();}
const unwrap=<T,>({data,error}:{data:T;error:{message:string}|null})=>{if(error)throw new Error(error.message);return data;};
export async function financialBudgetContext(){
 const {supabase}=await session();
 const [plans,ownership,organizations]=await Promise.all([
  supabase.from('budget_plans').select('id,name,fiscal_year,scenario,currency'),
  supabase.from('financial_budget_plan_ownership').select('*'),
  supabase.from('organizations').select('id,name,parent_organization_id')
 ]);
 return {plans:unwrap(plans),ownership:unwrap(ownership),organizations:unwrap(organizations)};
}
export async function financialBudgetReport(plan:string){
 uuid.parse(plan);const {supabase}=await session();
 return unwrap(await supabase.rpc('financial_budget_report',{p_plan:plan}));
}
export async function financialBudgetSetup(plan:string,organization:string){
 uuid.parse(plan);uuid.parse(organization);const {supabase}=await session();
 // Report authorization must pass before exposing plan-scoped configuration data.
 await financialBudgetReport(plan);
 const ownership=unwrap(await supabase.from('financial_budget_plan_ownership').select('*').eq('plan_id',plan).single());
 if(ownership.organization_id!==organization)throw new Error('BUDGET_PLAN_SCOPE_DENIED');
 const [mappings,retirements,classifications,entities,centers,canEdit]=await Promise.all([
  supabase.from('financial_budget_mappings').select('*').eq('plan_id',plan),
  supabase.from('financial_budget_retirements').select('mapping_id,reason,created_at').eq('organization_id',organization),
  supabase.from('financial_classifications').select('id,name,classification_type').eq('organization_id',organization).eq('active',true),
  supabase.from('organization_entities').select('id,name').eq('organization_id',organization).eq('active',true),
  supabase.from('organization_cost_centers').select('id,name').eq('organization_id',organization).eq('active',true),
  supabase.rpc('financial_budget_can',{p_org:organization,p_entity:ownership.entity_id,p_center:ownership.cost_center_id,p_write:true})
 ]);
 return {ownership,mappings:unwrap(mappings),retirements:unwrap(retirements),classifications:unwrap(classifications),entities:unwrap(entities),centers:unwrap(centers),canEdit:unwrap(canEdit)};
}
export async function financialBudgetDrilldown(plan:string){
 uuid.parse(plan);const {supabase}=await session();
 const facts=unwrap(await supabase.rpc('financial_budget_drilldown',{p_plan:plan})) as {event_id:string;financial_line_id:string}[];
 const eventIds=[...new Set(facts.map(f=>f.event_id))];const lineIds=facts.map(f=>f.financial_line_id);
 if(!eventIds.length)return {facts,operational:[],obligations:[],sources:[]};
 // All detail uses the signed-in client's RLS; never privileged credentials.
 const [operational,obligations,sources]=await Promise.all([
  supabase.from('financial_budget_operational_facts').select('*').in('financial_line_id',lineIds),
  supabase.from('financial_event_obligation_balances').select('*').in('event_id',eventIds),
  supabase.from('financial_vat_source_bindings').select('event_id,source_table,source_record_id,canonical_payload').in('event_id',eventIds)
 ]);
 return {facts,operational:unwrap(operational),obligations:unwrap(obligations),sources:unwrap(sources)};
}
export async function financialBudgetConsolidated(holding:string,year:number,scenario:string){
 uuid.parse(holding);z.number().int().min(2000).max(2200).parse(year);z.enum(['BASE','DOWNSIDE','UPSIDE']).parse(scenario);
 const {supabase}=await session();return unwrap(await supabase.rpc('financial_budget_consolidated',{p_holding:holding,p_year:year,p_scenario:scenario}));
}
const mapping=z.object({action:z.literal('MAP'),organization_id:uuid,plan_id:uuid,budget_line_id:uuid,classification_id:uuid,entity_id:uuid.nullable(),cost_center_id:uuid.nullable(),metric_policy:z.enum(['REVENUE','OPEX','CAPEX','FINANCING','INVESTMENT','SOURCE_NONRECOVERABLE']),effective_from:z.string().date(),effective_to:z.string().date()}).strict();
const retirement=z.object({action:z.literal('RETIRE_MAPPING'),organization_id:uuid,mapping_id:uuid,reason:z.string().trim().min(1).max(500)}).strict();
const binding=z.object({action:z.literal('BIND_PLAN'),organization_id:uuid,plan_id:uuid,entity_id:uuid.nullable(),cost_center_id:uuid.nullable(),fiscal_start:z.string().date()}).strict();
export async function configureFinancialBudget(input:unknown){
 const command=z.object({key:z.string().min(1).max(200),payload:z.discriminatedUnion('action',[mapping,retirement,binding])}).strict().parse(input);
 if(command.payload.action==='MAP'&&command.payload.effective_to<command.payload.effective_from)throw new Error('BUDGET_MAPPING_DATE_RANGE_INVALID');
 const {supabase}=await session();return unwrap(await supabase.rpc('configure_financial_budget',{p_key:command.key,p_payload:command.payload}));
}
