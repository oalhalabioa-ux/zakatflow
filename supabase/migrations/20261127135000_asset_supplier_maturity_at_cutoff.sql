-- Read-only maturity evidence for the existing supplier payable, not a second obligation.
create function private.asset_supplier_maturity_at_cutoff(
 p_org uuid,p_obligation uuid,p_cutoff date,p_current_through date
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 schedule private.asset_supplier_payment_schedules%rowtype;
 acquisition public.financial_events%rowtype;
 root public.financial_event_obligations%rowtype;
 result jsonb;
 applied numeric;
 open_balance numeric;
 due_current numeric;
 due_later numeric;
 overdue numeric;
 entries jsonb;
 missing_reversal boolean;
begin
 if auth.uid() is null or p_org is null
    or public.has_organization_permission(p_org,'assets.view') is not true
    or public.financial_core_can(p_org,'financial_core.view') is not true
 then raise exception 'ASSET_SUPPLIER_MATURITY_DENIED'; end if;
 if p_obligation is null or p_cutoff is null or p_current_through is null or p_current_through<p_cutoff
 then raise exception 'ASSET_SUPPLIER_MATURITY_INVALID'; end if;

 select * into schedule from private.asset_supplier_payment_schedules
 where organization_id=p_org and obligation_id=p_obligation;
 if not found then return null; end if;
 select * into strict acquisition from public.financial_events where organization_id=p_org and id=schedule.event_id;
 select * into strict root from public.financial_event_obligations where organization_id=p_org and id=p_obligation;

 result:=jsonb_build_object('organization_id',p_org,'asset_id',schedule.asset_id,'event_id',schedule.event_id,
   'obligation_id',p_obligation,'currency',schedule.currency,'cutoff',p_cutoff,'current_through',p_current_through);
 if acquisition.event_date>p_cutoff or acquisition.status not in ('ACTUAL','REVERSED')
   or not private.financial_opening_event_active(p_org,acquisition.id,p_cutoff)
 then return result||jsonb_build_object('status','NOT_OUTSTANDING'); end if;

 -- Until the linked reversal is proven, current status alone cannot establish
 -- an historical balance. Apply the same rule to the originating acquisition.
 select exists(
  select 1 from public.financial_events e
  where e.organization_id=p_org and e.event_date<=p_cutoff and e.status='REVERSED'
    and (e.id=acquisition.id or exists(select 1 from public.financial_event_obligation_allocations a
      where a.organization_id=p_org and a.obligation_id=p_obligation and a.application_event_id=e.id)
      or exists(select 1 from public.financial_event_obligations a
      where a.organization_id=p_org and a.adjusts_obligation_id=p_obligation and a.event_id=e.id))
    and not exists(select 1 from public.financial_event_links l
      join public.financial_events r on r.id=l.event_id and r.organization_id=l.organization_id
      where l.organization_id=p_org and l.related_event_id=e.id and l.link_type='REVERSAL_OF'
        and r.status in ('ACTUAL','REVERSED') and r.event_type='REVERSAL'
        and r.event_date>=e.event_date)
 ) into missing_reversal;
 if missing_reversal then
   return result||jsonb_build_object('status','REVIEW_REQUIRED','reason','REVERSAL_DATE_UNPROVEN');
 end if;
 if root.event_id<>acquisition.id or root.obligation_type<>'PAYABLE' or root.adjusts_obligation_id is not null
   or root.currency<>schedule.currency or root.base_currency<>schedule.currency or root.exchange_rate<>1
   or root.settleable_base_amount<>schedule.document_total or root.settleable_amount<>schedule.document_total
   or exists(select 1 from public.financial_event_obligations o where o.organization_id=p_org
     and o.adjusts_obligation_id=p_obligation and private.financial_opening_event_active(p_org,o.event_id,p_cutoff))
 then return result||jsonb_build_object('status','REVIEW_REQUIRED','reason','SCHEDULE_RECONCILIATION_REQUIRED'); end if;

 select coalesce(sum(a.base_amount),0) into applied from public.financial_event_obligation_allocations a
 where a.organization_id=p_org and a.obligation_id=p_obligation
   and private.financial_opening_event_active(p_org,a.application_event_id,p_cutoff);
 open_balance:=schedule.document_total-applied;
 if applied<0 or open_balance<0 then
   return result||jsonb_build_object('status','REVIEW_REQUIRED','reason','ALLOCATION_RECONCILIATION_REQUIRED');
 end if;

 select coalesce(sum(remaining) filter (where due<=p_current_through),0),
   coalesce(sum(remaining) filter (where due>p_current_through),0),
   coalesce(sum(remaining) filter (where due<p_cutoff),0),
   jsonb_agg(jsonb_build_object('id',schedule.event_id::text||':'||position,'due_date',due,'principal',principal::text,
     'remaining',remaining::text,'within_current_horizon',due<=p_current_through) order by position)
 into due_current,due_later,overdue,entries
 from (
   select position,due,principal,principal-least(principal,greatest(0,applied-coalesce(
      sum(principal) over(order by position rows between unbounded preceding and 1 preceding),0))) remaining
   from (
     select position,(entry->>'due_date')::date due,(entry->>'principal')::numeric principal
     from jsonb_array_elements(schedule.terms->'entries') with ordinality as terms(entry,position)
   ) dated
 ) balances;
 if due_current+due_later<>open_balance then
   return result||jsonb_build_object('status','REVIEW_REQUIRED','reason','INSTALLMENTS_DO_NOT_RECONCILE');
 end if;
 return result||jsonb_build_object('status','VERIFIED','original_payable',schedule.document_total::text,
   'applied',applied::text,'outstanding',open_balance::text,'due_within_horizon',due_current::text,
   'due_after_horizon',due_later::text,'overdue',overdue::text,'entries',entries);
end
$$;
revoke all on function private.asset_supplier_maturity_at_cutoff(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function private.asset_supplier_maturity_at_cutoff(uuid,uuid,date,date) to authenticated;

create function public.read_asset_supplier_maturity_at_cutoff(
 p_org uuid,p_obligation uuid,p_cutoff date,p_current_through date
)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.asset_supplier_maturity_at_cutoff(p_org,p_obligation,p_cutoff,p_current_through)
$$;
revoke all on function public.read_asset_supplier_maturity_at_cutoff(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.read_asset_supplier_maturity_at_cutoff(uuid,uuid,date,date) to authenticated;
