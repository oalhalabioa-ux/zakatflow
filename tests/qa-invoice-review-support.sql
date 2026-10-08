-- QA ONLY: apply to Financial Core QA, never Production.
-- Modern invoice forecasts are scoped to explicitly registered synthetic review organizations.
create table if not exists public.qa_invoice_review_scopes(
 organization_id uuid primary key references public.organizations(id), created_at timestamptz not null default now());
alter table public.qa_invoice_review_scopes enable row level security;
revoke all on public.qa_invoice_review_scopes from anon,authenticated;
create or replace function private.is_invoice_review_qa_org(p_org uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.qa_invoice_review_scopes where organization_id=p_org); $$;
revoke all on function private.is_invoice_review_qa_org(uuid) from public,anon;
grant execute on function private.is_invoice_review_qa_org(uuid) to authenticated;

create table if not exists public.audit_logs(
 id uuid primary key default gen_random_uuid(),user_id uuid,entity_type text not null,entity_id uuid,
 action text not null,old_data jsonb,new_data jsonb,created_at timestamptz not null default now(),ip_address inet);
alter table public.audit_logs enable row level security;
create policy qa_review_audit_insert on public.audit_logs for insert to authenticated with check(user_id=auth.uid());
create policy qa_review_audit_read on public.audit_logs for select to authenticated using(user_id=auth.uid());
grant select,insert on public.audit_logs to authenticated;
grant update on public.liquidity_flows to authenticated;
grant update,insert,delete on public.financial_events,public.financial_event_lines,public.financial_event_links,public.financial_event_obligations to authenticated;
grant insert(organization_id,name,party_type,contact_name,phone,email,notes,active) on public.liquidity_counterparties to authenticated;
grant insert on public.financial_vat_counterparty_map to authenticated;
create policy qa_review_map_insert on public.financial_vat_counterparty_map for insert to authenticated with check(
 private.is_invoice_review_qa_org(organization_id) and public.is_organization_admin(organization_id) and created_by=auth.uid()
 and exists(select 1 from public.vat_contacts c where c.id=vat_contact_id and c.organization_id=financial_vat_counterparty_map.organization_id)
 and exists(select 1 from public.liquidity_counterparties c where c.id=counterparty_id and c.organization_id=financial_vat_counterparty_map.organization_id));
do $$ declare t text; begin
 foreach t in array array['financial_events','financial_event_lines','financial_event_links','financial_event_obligations'] loop
 execute format('create policy qa_invoice_review_admin on public.%I for all to authenticated using(private.is_invoice_review_qa_org(organization_id) and public.is_organization_admin(organization_id)) with check(private.is_invoice_review_qa_org(organization_id) and public.is_organization_admin(organization_id))',t);
 end loop;
end $$;

-- Retain legacy Phase 2C validation everywhere else. The review scope validates the
-- current app's OPERATIONAL_CONSOLE source, including drafts before recognition.
create or replace function private.qa_invoice_review_flow_integrity() returns trigger
 language plpgsql security definer set search_path='' as $$
declare d public.vat_documents%rowtype; e public.financial_events%rowtype; cp uuid; base text;
begin
 if tg_op='DELETE' then
  if old.source_module='VAT_INTEGRATION' then raise exception 'VAT_EXPECTED_FLOW_DELETE_DENIED'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and old.source_module='VAT_INTEGRATION' and
  (new.source_module is distinct from old.source_module or new.source_record_id is distinct from old.source_record_id
   or new.organization_id is distinct from old.organization_id) then raise exception 'VAT_EXPECTED_FLOW_IDENTITY_IMMUTABLE'; end if;
 if new.source_module is distinct from 'VAT_INTEGRATION' then return new; end if;
 select * into d from public.vat_documents where id=new.source_record_id and organization_id=new.organization_id;
 select fe.* into e from public.financial_events fe join public.financial_event_links l on l.event_id=fe.id
  where l.organization_id=new.organization_id and l.link_type='SOURCE' and l.target_module='vat_documents'
   and l.target_record_id=d.id and fe.source_module='OPERATIONAL_CONSOLE';
 select counterparty_id into cp from public.financial_vat_counterparty_map where organization_id=new.organization_id and vat_contact_id=d.counterparty_contact_id;
 select base_currency into base from public.organizations where id=new.organization_id;
 if d.id is null or e.id is null or cp is null or new.source_event_key is distinct from 'vat_documents:'||d.id||':cash-forecast'
  or d.document_type<>'SALES' or new.direction<>'INFLOW' or new.flow_type<>'OPERATING' or new.currency<>base
  or new.amount<>d.gross_amount or new.base_amount<>d.gross_amount or new.due_date is distinct from d.due_date
  or new.counterparty_id is distinct from cp or e.counterparty_id is distinct from cp
  or new.settled_amount<0 or new.settled_amount>new.amount
  or not exists(select 1 from public.financial_event_obligations o where o.event_id=e.id and o.obligation_type='RECEIVABLE' and o.settleable_base_amount=new.base_amount)
 then raise exception 'QA_INVOICE_FLOW_FINANCIAL_PARITY_REQUIRED'; end if;
 return new;
end $$;
revoke all on function private.qa_invoice_review_flow_integrity() from public,anon,authenticated;
-- Extend the existing trigger function without deleting its legacy validation.
do $patch$
declare v_def text; v_body text;
begin
 select pg_get_functiondef('private.phase2c_expected_integrity()'::regprocedure) into v_def;
 if strpos(v_def,'is_invoice_review_qa_org')>0 then raise exception 'QA_SUPPORT_ALREADY_APPLIED'; end if;
 select prosrc into v_body from pg_proc where oid='private.qa_invoice_review_flow_integrity()'::regprocedure;
 v_body:=substr(v_body,strpos(v_body,'begin')+5);
 v_body:=regexp_replace(v_body,'end[;[:space:]]*$','');
 v_def:=replace(v_def,'declare b public.financial_vat_source_bindings%rowtype;',
  'declare d public.vat_documents%rowtype; cp uuid; base text; b public.financial_vat_source_bindings%rowtype;');
 v_def:=replace(v_def,E'begin\n',E'begin\n if private.is_invoice_review_qa_org(case when tg_op=''DELETE'' then old.organization_id else new.organization_id end) then\n'||v_body||E'\n end if;\n');
 execute v_def;
end $patch$;
drop function private.qa_invoice_review_flow_integrity();
