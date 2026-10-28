do $$
declare obj text;
begin
 foreach obj in array array['organizations','organization_members','liquidity_accounts','liquidity_counterparties','debt_contracts','financial_events','financial_event_lines','financial_event_obligations','liquidity_settlements','financial_event_command_registry','voucher_numbers'] loop
  if to_regclass('public.'||obj) is null then raise exception 'PR302_MISSING_RELATION: %',obj;end if;
 end loop;
 foreach obj in array array['public.create_debt_contract(jsonb)','public.post_debt_contract(uuid)','public.open_financial_account(jsonb)','public.approve_financial_event(uuid,text)'] loop
  if to_regprocedure(obj) is null then raise exception 'PR302_MISSING_RPC: %',obj;end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.debt_contracts'::regclass and tgname='register_voucher_number' and tgdeferrable and tginitdeferred) then raise exception 'PR302_MISSING_REAL_VOUCHER_TRIGGER';end if;
 if exists(select 1 from public.debt_contracts) or exists(select 1 from public.financial_events) or exists(select 1 from public.liquidity_settlements) then raise exception 'PR302_EXPECTED_EMPTY_FINANCIAL_FIXTURE';end if;
end $$;
-- Timing instrumentation only; all business functions remain unchanged.
create table private.pr302_overlap(source_id uuid primary key,backend int not null,started timestamptz not null,finished timestamptz);
create function private.pr302_probe() returns trigger language plpgsql set search_path='' as $$
begin
 insert into private.pr302_overlap values(new.id,pg_backend_pid(),clock_timestamp(),null);
 perform pg_sleep(1);
 update private.pr302_overlap set finished=clock_timestamp() where source_id=new.id;
 return new;
end $$;
revoke all on function private.pr302_probe() from public,anon,authenticated;
create trigger pr302_overlap_probe before insert on public.debt_contracts for each row execute function private.pr302_probe();
notify pgrst,'reload schema';
