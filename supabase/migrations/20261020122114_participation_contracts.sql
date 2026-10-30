-- Incoming investor capital is separate from fixed-return loans and from outward investments.
create table public.participation_contracts(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),request_id uuid not null,
 counterparty_id uuid not null references public.liquidity_counterparties(id),entity_id uuid references public.organization_entities(id),
 reference text not null,description text not null,project text not null,capital numeric(24,4)not null check(capital>0),currency text not null,
 exchange_rate numeric not null check(exchange_rate>0),start_date date not null,maturity_date date,
 investor_profit_pct numeric not null check(investor_profit_pct>0 and investor_profit_pct<=100),investor_loss_pct numeric not null check(investor_loss_pct>0 and investor_loss_pct<=100),
 capital_treatment text not null check(capital_treatment in('FINANCING','EQUITY')),accounting_basis text not null,exit_terms text not null,loss_terms text not null,
 state text not null default 'DRAFT'check(state in('DRAFT','ACTIVE','CLOSED','CANCELLED')),payload_fingerprint text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(organization_id,request_id)
);
alter table public.participation_contracts enable row level security;
revoke all on public.participation_contracts from public,anon,authenticated;grant select on public.participation_contracts to authenticated;
create policy participation_contract_read on public.participation_contracts for select to authenticated using(public.financial_core_can(organization_id,'financial_core.view'));
create index participation_contract_org on public.participation_contracts(organization_id,created_at);
create table public.participation_movements(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),contract_id uuid not null references public.participation_contracts(id),request_id uuid not null,
 kind text not null check(kind in('CAPITAL_RECEIPT','CAPITAL_RETURN','PROFIT','LOSS')),amount numeric(24,4)not null check(amount>0),period_result numeric(24,4),period_from date,period_to date,event_date date not null,
 account_id uuid references public.liquidity_accounts(id),recognition_event_id uuid not null unique references public.financial_events(id),cash_event_id uuid unique references public.financial_events(id),flow_id uuid references public.liquidity_flows(id),
 reason text not null,execution_state text not null default 'PREPARED'check(execution_state in('PREPARED','POSTING','POSTED','CANCELLED')),payload_fingerprint text not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(organization_id,request_id)
);
alter table public.participation_movements enable row level security;
revoke all on public.participation_movements from public,anon,authenticated;grant select on public.participation_movements to authenticated;
create policy participation_movement_read on public.participation_movements for select to authenticated using(public.financial_core_can(organization_id,'financial_core.view'));
create index participation_movement_contract on public.participation_movements(organization_id,contract_id,created_at);

create function private.create_participation_contract(p jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=auth.uid();org uuid:=(p->>'organization_id')::uuid;req uuid:=(p->>'request_id')::uuid;prior public.participation_contracts%rowtype;capital numeric:=(p->>'capital')::numeric;fx numeric:=(p->>'exchange_rate')::numeric;profit numeric:=(p->>'investor_profit_pct')::numeric;loss numeric:=(p->>'investor_loss_pct')::numeric;start_dt date:=(p->>'start_date')::date;maturity date:=nullif(p->>'maturity_date','')::date;base text;id uuid;fp text:=md5(p::text);
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if not public.financial_core_can(org,'financial_core.view')or not public.financial_core_can(org,'financial_core.create')then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 if req is null or capital is null or capital<=0 or capital>1e12 or capital<>round(capital,4)or capital::text in('NaN','Infinity','-Infinity')or fx is null or fx<=0 or fx>1e6 or fx::text in('NaN','Infinity','-Infinity')or profit is null or profit<=0 or profit>100 or profit::text in('NaN','Infinity','-Infinity')or loss is null or loss<=0 or loss>100 or loss::text in('NaN','Infinity','-Infinity')or start_dt is null or maturity<start_dt or(p->>'currency')!~'^[A-Z]{3}$'or p->>'capital_treatment'is null or p->>'capital_treatment'not in('FINANCING','EQUITY')or p->>'variable_return'is distinct from 'true'or length(trim(coalesce(p->>'reference','')))not between 1 and 120 or length(trim(coalesce(p->>'description','')))not between 3 and 500 or length(trim(coalesce(p->>'project','')))not between 3 and 160 or length(trim(coalesce(p->>'accounting_basis','')))not between 15 and 1000 or length(trim(coalesce(p->>'exit_terms','')))not between 15 and 1000 or length(trim(coalesce(p->>'loss_terms','')))not between 15 and 1000 then raise exception 'PARTICIPATION_TERMS_INVALID';end if;
 select base_currency into base from public.organizations where id=org;if base is null or(p->>'currency'=base and fx<>1)then raise exception 'PARTICIPATION_CURRENCY_INVALID';end if;
 if not exists(select 1 from public.liquidity_counterparties where id=(p->>'counterparty_id')::uuid and organization_id=org and active)or(nullif(p->>'entity_id','')is not null and not exists(select 1 from public.organization_entities where id=(p->>'entity_id')::uuid and organization_id=org and active))then raise exception 'PARTICIPATION_SCOPE_MISMATCH';end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text||'|PARTICIPATION_CREATE|'||req::text,0));select * into prior from public.participation_contracts where organization_id=org and request_id=req;
 if prior.id is not null then if prior.payload_fingerprint<>fp then raise exception 'PARTICIPATION_REQUEST_CONFLICT';end if;return jsonb_build_object('id',prior.id,'replay',true);end if;
 insert into public.participation_contracts(organization_id,request_id,counterparty_id,entity_id,reference,description,project,capital,currency,exchange_rate,start_date,maturity_date,investor_profit_pct,investor_loss_pct,capital_treatment,accounting_basis,exit_terms,loss_terms,payload_fingerprint,created_by)
 values(org,req,(p->>'counterparty_id')::uuid,nullif(p->>'entity_id','')::uuid,trim(p->>'reference'),trim(p->>'description'),trim(p->>'project'),capital,p->>'currency',fx,start_dt,maturity,profit,loss,p->>'capital_treatment',trim(p->>'accounting_basis'),trim(p->>'exit_terms'),trim(p->>'loss_terms'),fp,uid)returning participation_contracts.id into id;
 insert into public.audit_logs(user_id,organization_id,entity_type,entity_id,action,new_data)values(uid,org,'participation_contract',id,'CREATE',p);return jsonb_build_object('id',id,'state','DRAFT');
end $$;
revoke all on function private.create_participation_contract(jsonb)from public,anon;grant execute on function private.create_participation_contract(jsonb)to authenticated;
create function public.create_participation_contract(p_payload jsonb)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.create_participation_contract(p_payload);$$;
revoke all on function public.create_participation_contract(jsonb)from public,anon;grant execute on function public.create_participation_contract(jsonb)to authenticated;

