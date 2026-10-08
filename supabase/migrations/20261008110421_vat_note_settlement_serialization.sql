-- Serialize invoice settlement and note adjustments on the same root obligation.
-- The bank operation and this validation share the transaction, so a conflict
-- rolls back all bank and settlement evidence.
create or replace function private.guard_vat_note_settlement()
returns trigger language plpgsql security definer set search_path='' as $$
declare allocation record; root public.financial_event_obligations%rowtype; adjusted numeric; paid numeric;
begin
 if old.status='ACTUAL' and new.status='REVERSED' and exists(select 1 from public.financial_vat_source_bindings b join public.financial_events note_event on note_event.id=b.event_id and note_event.organization_id=b.organization_id where b.original_event_id=new.id and b.organization_id=new.organization_id and note_event.status='ACTUAL') then raise exception 'VAT_ORIGINAL_HAS_POSTED_NOTES'; end if;
 if new.status<>'ACTUAL' or old.status='ACTUAL' or new.event_type<>'SETTLEMENT' then return new; end if;
 for allocation in select a.obligation_id,sum(a.base_amount) amount from public.financial_event_obligation_allocations a where a.application_event_id=new.id and a.organization_id=new.organization_id group by a.obligation_id order by a.obligation_id loop
  select * into root from public.financial_event_obligations where id=allocation.obligation_id and organization_id=new.organization_id for update;
  if not exists(select 1 from public.financial_event_links where event_id=root.event_id and organization_id=new.organization_id and link_type='SOURCE' and target_module='vat_documents') then continue; end if;
  if root.adjusts_obligation_id is not null or root.obligation_type not in('RECEIVABLE','PAYABLE') then raise exception 'VAT_SETTLEMENT_ROOT_REQUIRED'; end if;
  select adjusted_settleable_base_amount into adjusted from public.financial_event_obligation_balances where obligation_id=root.id and organization_id=new.organization_id;
  select coalesce(sum(a.base_amount),0) into paid from public.financial_event_obligation_allocations a join public.financial_events e on e.id=a.application_event_id and e.organization_id=a.organization_id where a.obligation_id=root.id and a.organization_id=new.organization_id and e.status='ACTUAL' and e.id<>new.id;
  if adjusted is null or paid+allocation.amount>adjusted then raise exception 'SETTLEMENT_EXCEEDS_OUTSTANDING'; end if;
 end loop;
 return new;
end $$;
revoke all on function private.guard_vat_note_settlement() from public,anon,authenticated;
create trigger guard_vat_note_settlement before update of status on public.financial_events for each row execute function private.guard_vat_note_settlement();
