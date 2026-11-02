// Synthetic schema for disposable local acceptance only. Never install on a hosted project.
import {readFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url),load=p=>readFile(new URL(p,root),'utf8');
export const ORG_A='10000000-0000-4000-8000-000000000001',ORG_B='10000000-0000-4000-8000-000000000002',PLAN_A='20000000-0000-4000-8000-000000000001',PLAN_B='20000000-0000-4000-8000-000000000002';
export async function sourceSchema(){
 const original=await load('supabase/migrations/20261006143258_financial_budget_reporting_rpc_v1.sql');
 const part=marker=>{const a=original.indexOf(marker);if(a<0)throw Error('SQL_SOURCE_NOT_FOUND');const b=original.indexOf('$$;',a);if(b<0)throw Error('SQL_SOURCE_END_NOT_FOUND');return original.slice(a,b+3)};
 const view=original.slice(original.indexOf('create or replace view public.financial_budget_operational_facts'),original.indexOf('create or replace function private.phase2d_event_weight'));
 const report=await load('supabase/migrations/20261012201707_financial_budget_cash_metrics_and_authenticated_api_access.sql');
 return `create schema if not exists private;
create table public.organizations(id uuid primary key,name text,base_currency text);
create table public.organization_members(organization_id uuid references organizations(id),user_id uuid,status text,can_budget boolean,can_finance boolean,primary key(organization_id,user_id));
create function public.has_organization_permission(p_org uuid,p_permission text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() and status='ACTIVE' and can_budget and p_permission='budget.view')$$;
create function public.financial_core_can(p_org uuid,p_permission text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.organization_members where organization_id=p_org and user_id=auth.uid() and status='ACTIVE' and can_finance and p_permission='financial_core.view')$$;
create table public.budget_plans(id uuid primary key,user_id uuid,name text,fiscal_year int,currency text,scenario text);
create table public.budget_lines(id uuid primary key,plan_id uuid references budget_plans(id),user_id uuid,name text,category text,line_type text,monthly_budget numeric[],monthly_actual numeric[],monthly_forecast numeric[],active boolean);
create table public.financial_budget_plan_ownership(plan_id uuid primary key references budget_plans(id),organization_id uuid references organizations(id),entity_id uuid,cost_center_id uuid,fiscal_start date);
create table public.financial_budget_mappings(id uuid primary key,plan_id uuid,budget_line_id uuid,classification_id uuid,entity_id uuid,cost_center_id uuid,effective_from date,effective_to date);
create table public.financial_budget_retirements(mapping_id uuid);
create table public.financial_classifications(id uuid primary key,classification_type text);
create table public.financial_events(id uuid primary key,organization_id uuid,entity_id uuid,event_date date,status text,event_type text,source_module text,source_record_id uuid,source_event_key text,base_currency text);
create table public.financial_event_lines(id uuid primary key,event_id uuid,classification_id uuid,cost_center_id uuid,currency text,exchange_rate numeric,base_amount numeric,metadata jsonb,cash_direction text);
create table public.financial_budget_event_routes(event_id uuid primary key,entity_id uuid,cost_center_id uuid);
create table public.financial_event_obligation_balances(event_id uuid,organization_id uuid,obligation_type text,applied_base_amount numeric,consumed_advance_base_amount numeric,outstanding_base_amount numeric);
`+part('create or replace function public.financial_budget_can(')+view+part('create or replace function private.phase2d_plan_facts(')+report+`
alter table public.organization_members enable row level security;
create policy member_self on public.organization_members for select to authenticated using(user_id=auth.uid());
alter table public.organizations enable row level security;
create policy org_member on public.organizations for select to authenticated using(exists(select 1 from public.organization_members where organization_id=organizations.id and user_id=auth.uid() and status='ACTIVE'));
alter table public.financial_budget_plan_ownership enable row level security;
create policy plan_scope on public.financial_budget_plan_ownership for select to authenticated using(public.financial_budget_can(organization_id,entity_id,cost_center_id,false));
alter table public.budget_plans enable row level security;
create policy plan_reader on public.budget_plans for select to authenticated using(exists(select 1 from public.financial_budget_plan_ownership o where o.plan_id=budget_plans.id and public.financial_budget_can(o.organization_id,o.entity_id,o.cost_center_id,false)));
alter table public.budget_lines enable row level security;
create policy lines_reader on public.budget_lines for select to authenticated using(exists(select 1 from public.budget_plans p where p.id=budget_lines.plan_id));
grant usage on schema public to authenticated;
grant select on public.organization_members,public.organizations,public.financial_budget_plan_ownership,public.budget_plans,public.budget_lines to authenticated;
notify pgrst,'reload schema';`;
}
export function seedSource(a,b,viewer){for(const id of[a,b,viewer])if(!/^[a-f0-9-]{36}$/.test(id))throw Error('TEST_ACTOR_ID_INVALID');return `
insert into organizations values('${ORG_A}','Source institution A','SAR'),('${ORG_B}','Source institution B','SAR');
insert into organization_members values('${ORG_A}','${a}','ACTIVE',true,true),('${ORG_B}','${b}','ACTIVE',true,true),('${ORG_A}','${viewer}','ACTIVE',false,false);
insert into budget_plans values('${PLAN_A}','${a}','Operations A',2026,'SAR','BASE'),('${PLAN_B}','${b}','Operations B',2026,'SAR','BASE');
insert into financial_budget_plan_ownership values('${PLAN_A}','${ORG_A}',null,null,'2026-01-01'),('${PLAN_B}','${ORG_B}',null,null,'2026-01-01');
insert into budget_lines values('40000000-0000-4000-8000-000000000001','${PLAN_A}','${a}','Operating cost A','OPEX','EXPENSE',array_fill(300::numeric,array[12]),array[900::numeric]||array_fill(0::numeric,array[11]),array_fill(400::numeric,array[12]),true),('40000000-0000-4000-8000-000000000002','${PLAN_B}','${b}','Operating cost B','OPEX','EXPENSE',array_fill(8000::numeric,array[12]),array_fill(0::numeric,array[12]),array_fill(8000::numeric,array[12]),true);
insert into financial_classifications values('60000000-0000-4000-8000-000000000001','OPEX'),('60000000-0000-4000-8000-000000000002','OPEX');
insert into financial_budget_mappings values('70000000-0000-4000-8000-000000000001','${PLAN_A}','40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',null,null,'2026-01-01','2026-12-31'),('70000000-0000-4000-8000-000000000002','${PLAN_B}','40000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002',null,null,'2026-01-01','2026-12-31');
insert into financial_events values
('80000000-0000-4000-8000-000000000001','${ORG_A}','50000000-0000-4000-8000-000000000001','2026-01-15','ACTUAL','EXPENSE','QA',null,'recognition-a','SAR'),
('80000000-0000-4000-8000-000000000002','${ORG_A}','50000000-0000-4000-8000-000000000001','2026-01-16','ACTUAL','SETTLEMENT','QA',null,'settlement-a','SAR'),
('80000000-0000-4000-8000-000000000003','${ORG_A}','50000000-0000-4000-8000-000000000001','2026-01-17','DRAFT','EXPENSE','QA',null,'draft-a','SAR'),
('80000000-0000-4000-8000-000000000004','${ORG_B}','50000000-0000-4000-8000-000000000002','2026-01-15','ACTUAL','EXPENSE','QA',null,'recognition-b','SAR'),
('80000000-0000-4000-8000-000000000005','${ORG_A}','50000000-0000-4000-8000-000000000001','2026-01-18','COMMITTED','EXPENSE','QA',null,'commitment-a','SAR');
insert into financial_event_lines values
('90000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',null,'SAR',1,100,'{}','NON_CASH'),
('90000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',null,'SAR',1,115,'{}','OUTFLOW'),
('90000000-0000-4000-8000-000000000003','80000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001',null,'SAR',1,999,'{}','NON_CASH'),
('90000000-0000-4000-8000-000000000004','80000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000002',null,'SAR',1,7000,'{}','NON_CASH'),
('90000000-0000-4000-8000-000000000005','80000000-0000-4000-8000-000000000005','60000000-0000-4000-8000-000000000001',null,'SAR',1,50,'{}','NON_CASH');
insert into financial_event_obligation_balances values('80000000-0000-4000-8000-000000000001','${ORG_A}','PAYABLE',115,0,0);
`}
