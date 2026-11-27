-- One installment schedule per newly acquired institutional asset. The V2
-- purchase, supplier obligation, settlements and reversal remain authoritative.
create table private.asset_supplier_payment_schedules (
  event_id uuid primary key,
  organization_id uuid not null,
  asset_id uuid not null unique references public.asset_accounts(id),
  purchase_id uuid not null unique references public.transactions(id),
  obligation_id uuid not null unique,
  acquired_on date not null,
  first_due date not null,
  currency text not null references public.currencies(code),
  document_total numeric(24,4) not null check (document_total > 0),
  terms jsonb not null,
  foreign key (event_id,organization_id) references public.financial_events(id,organization_id),
  foreign key (obligation_id,organization_id) references public.financial_event_obligations(id,organization_id)
);
alter table private.asset_supplier_payment_schedules enable row level security;
revoke all on private.asset_supplier_payment_schedules from public,anon,authenticated;
grant select on private.asset_supplier_payment_schedules to authenticated;
create policy asset_supplier_payment_schedules_read on private.asset_supplier_payment_schedules
 for select to authenticated using (
  public.has_organization_permission(organization_id,'assets.view')
  and public.financial_core_can(organization_id,'financial_core.view')
 );

create function private.bind_asset_supplier_payment_schedule(p_purchase uuid,p_terms jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  purchase public.transactions%rowtype;
  event public.financial_events%rowtype;
  debt public.financial_event_obligations%rowtype;
  saved private.asset_supplier_payment_schedules%rowtype;
  entry jsonb;
  due date;
  last_due date;
  first_due date;
  amount numeric;
  total numeric := 0;
  scale integer;
  installment_count integer := 0;
  entry_count integer := 0;
begin
  select * into purchase from public.transactions where id=p_purchase;
  if auth.uid() is null or purchase.user_id is distinct from auth.uid()
    or purchase.organization_id is null or purchase.transaction_type<>'PURCHASE'
    or not public.has_organization_permission(purchase.organization_id,'assets.edit')
    or not public.financial_core_can(purchase.organization_id,'financial_core.create')
    or not exists(select 1 from public.asset_accounts a where a.id=purchase.asset_account_id
      and a.organization_id=purchase.organization_id and a.ownership_scope='ORGANIZATION'
      and a.asset_type in ('OTHER','REAL_ESTATE') and a.asset_class_code in ('PPE','INTANGIBLE'))
  then raise exception 'ASSET_SUPPLIER_SCHEDULE_DENIED'; end if;

  select * into strict event from public.financial_events
  where source_record_id=p_purchase and organization_id=purchase.organization_id
    and event_type='ASSET_PURCHASE' and source_module='ASSETS_INTEGRATION'
    and source_event_key='asset-purchase:'||p_purchase::text
  for update;
  select * into saved from private.asset_supplier_payment_schedules where event_id=event.id;
  if found then
    if saved.terms is distinct from p_terms then raise exception 'ASSET_SUPPLIER_SCHEDULE_CONFLICT'; end if;
    return;
  end if;
  if event.status<>'DRAFT' or purchase.transaction_date<>event.event_date then
    raise exception 'ASSET_SUPPLIER_SCHEDULE_DRAFT_REQUIRED';
  end if;
  select * into strict debt from public.financial_event_obligations
  where event_id=event.id and organization_id=event.organization_id
    and obligation_type='PAYABLE' and adjusts_obligation_id is null
    and obligation_key='asset-purchase-gross';
  select decimals into scale from public.currencies where code=debt.currency;
  if purchase.currency<>event.base_currency or debt.currency<>event.base_currency or debt.exchange_rate<>1
    or scale is null or scale not between 0 and 4
  then raise exception 'ASSET_SUPPLIER_SCHEDULE_CURRENCY_UNSUPPORTED'; end if;
  if jsonb_typeof(p_terms) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_terms) k where k not in ('mode','entries'))
    or coalesce(p_terms->>'mode','') not in ('DEFERRED','INSTALLMENTS')
    or jsonb_typeof(p_terms->'entries') is distinct from 'array'
    or jsonb_array_length(p_terms->'entries') not between 1 and 120
  then raise exception 'ASSET_SUPPLIER_SCHEDULE_INVALID'; end if;

  for entry in select value from jsonb_array_elements(p_terms->'entries') loop
    entry_count:=entry_count+1;
    if jsonb_typeof(entry) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(entry) k where k not in ('kind','due_date','principal'))
      or coalesce(entry->>'kind','') not in ('DOWN_PAYMENT','INSTALLMENT')
      or coalesce(entry->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(entry->>'principal','') !~ '^[0-9]{1,12}(\.[0-9]{1,4})?$'
    then raise exception 'ASSET_SUPPLIER_SCHEDULE_INVALID'; end if;
    due:=(entry->>'due_date')::date;
    amount:=(entry->>'principal')::numeric;
    if amount<=0 or amount<>round(amount,scale) or due<event.event_date
      or (last_due is not null and due<last_due)
    then raise exception 'ASSET_SUPPLIER_SCHEDULE_INVALID'; end if;
    if entry->>'kind'='DOWN_PAYMENT' then
      if entry_count<>1 or due<>event.event_date then raise exception 'ASSET_SUPPLIER_SCHEDULE_INVALID'; end if;
    else
      installment_count:=installment_count+1;
      first_due:=coalesce(first_due,due);
    end if;
    total:=total+amount;
    last_due:=due;
  end loop;
  if (p_terms->>'mode'='DEFERRED' and installment_count<>1)
    or (p_terms->>'mode'='INSTALLMENTS' and installment_count<2)
    or first_due is distinct from event.due_date
  then raise exception 'ASSET_SUPPLIER_SCHEDULE_INVALID'; end if;
  if total<>debt.settleable_amount or total<>debt.settleable_base_amount then
    raise exception 'ASSET_SUPPLIER_SCHEDULE_TOTAL_MISMATCH';
  end if;
  insert into private.asset_supplier_payment_schedules
    (event_id,organization_id,asset_id,purchase_id,obligation_id,acquired_on,first_due,currency,document_total,terms)
  values(event.id,event.organization_id,purchase.asset_account_id,purchase.id,debt.id,event.event_date,
    first_due,debt.currency,total,p_terms);
end
$$;
revoke all on function private.bind_asset_supplier_payment_schedule(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.bind_asset_supplier_payment_schedule(uuid,jsonb) to authenticated;

create function public.create_scheduled_supplier_asset(p_asset jsonb,p_request_id uuid,p_terms jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  result jsonb;
  purchase_id uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_asset->>'ownership_scope' is distinct from 'ORGANIZATION'
    or p_asset#>>'{metadata,acquisition_mode}' is distinct from 'PURCHASE'
    or coalesce(p_asset->>'asset_type','') not in ('OTHER','REAL_ESTATE')
    or coalesce(p_asset->>'asset_class_code','') not in ('PPE','INTANGIBLE')
    or p_asset#>>'{metadata,funding_account_id}' is not null
  then raise exception 'ASSET_SUPPLIER_SCHEDULE_ASSET_UNSUPPORTED'; end if;
  result:=public.create_asset_with_acquisition(p_asset,p_request_id);
  select t.id into strict purchase_id from public.transactions t
  where t.asset_account_id=(result->>'id')::uuid and t.user_id=auth.uid()
    and t.organization_id=(p_asset->>'organization_id')::uuid and t.transaction_type='PURCHASE'
    and t.metadata->>'acquisition_request_id'=p_request_id::text;
  perform private.bind_asset_supplier_payment_schedule(purchase_id,p_terms);
  return result||jsonb_build_object('acquisition_transaction_id',purchase_id,
    'financial_event_id',(select event_id from private.asset_supplier_payment_schedules where asset_id=(result->>'id')::uuid));
end
$$;
revoke all on function public.create_scheduled_supplier_asset(jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_scheduled_supplier_asset(jsonb,uuid,jsonb) to authenticated;

-- A persisted schedule freezes its source dates and gross obligation in this slice.
-- Reject conflicting native draft edits before they can be approved.
create function private.guard_asset_supplier_schedule_post()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  schedule private.asset_supplier_payment_schedules%rowtype;
begin
  if new.source_module='ASSETS_INTEGRATION' and (
    new.event_date is distinct from old.event_date or new.due_date is distinct from old.due_date
    or (new.status='ACTUAL' and old.status<>'ACTUAL')) then
    select * into schedule from private.asset_supplier_payment_schedules where event_id=new.id;
    if found and (
      new.event_date<>schedule.acquired_on or new.due_date is distinct from schedule.first_due
      or not exists(select 1 from public.financial_event_obligations o
        where o.id=schedule.obligation_id and o.event_id=new.id and o.organization_id=new.organization_id
          and o.currency=schedule.currency and o.settleable_amount=schedule.document_total
          and o.settleable_base_amount=schedule.document_total)
    ) then raise exception 'ASSET_SUPPLIER_SCHEDULE_REQUIRES_RECONCILIATION'; end if;
  end if;
  return new;
end
$$;
revoke all on function private.guard_asset_supplier_schedule_post() from public,anon,authenticated;
create trigger asset_supplier_schedule_post_guard before update of status,event_date,due_date on public.financial_events
 for each row execute function private.guard_asset_supplier_schedule_post();

create function private.guard_asset_supplier_schedule_amount()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.currency,new.settleable_amount,new.settleable_base_amount,new.exchange_rate) is distinct from
     (old.currency,old.settleable_amount,old.settleable_base_amount,old.exchange_rate)
    and exists(select 1 from private.asset_supplier_payment_schedules where obligation_id=old.id)
  then raise exception 'ASSET_SUPPLIER_SCHEDULE_REQUIRES_RECONCILIATION'; end if;
  return new;
end
$$;
revoke all on function private.guard_asset_supplier_schedule_amount() from public,anon,authenticated;
create trigger asset_supplier_schedule_amount_guard
 before update of currency,settleable_amount,settleable_base_amount,exchange_rate on public.financial_event_obligations
 for each row execute function private.guard_asset_supplier_schedule_amount();

create function public.read_asset_supplier_schedule(p_asset_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  org uuid;
  schedule private.asset_supplier_payment_schedules%rowtype;
  event public.financial_events%rowtype;
  balance record;
  purchase public.transactions%rowtype;
  applied numeric;
  status text;
  entries jsonb;
  applications jsonb;
begin
  select organization_id into org from public.asset_accounts where id=p_asset_id;
  if auth.uid() is null or org is null
    or not public.has_organization_permission(org,'assets.view')
    or not public.financial_core_can(org,'financial_core.view')
  then raise exception 'ASSET_SUPPLIER_SCHEDULE_DENIED'; end if;
  select * into schedule from private.asset_supplier_payment_schedules where asset_id=p_asset_id and organization_id=org;
  if not found then return null; end if;
  select * into strict event from public.financial_events where id=schedule.event_id and organization_id=org;
  select * into strict purchase from public.transactions where id=schedule.purchase_id and organization_id=org;
  status:=event.status;
  applied:=0;

  if event.status='ACTUAL' then
    select * into balance from public.financial_event_obligation_balances
    where obligation_id=schedule.obligation_id and organization_id=org;
    if not found or balance.adjusted_settleable_base_amount<>schedule.document_total
      or balance.applied_base_amount not between 0 and schedule.document_total
      or balance.outstanding_base_amount<>schedule.document_total-balance.applied_base_amount
    then status:='REVIEW_REQUIRED';
    else applied:=balance.applied_base_amount;
    end if;
  end if;

  select jsonb_agg(jsonb_build_object('id',schedule.event_id::text||':'|| ordinal,'position',ordinal,
    'kind',kind,'due_date',due_date,'principal',principal::text,
    'applied',case when status='ACTUAL' then least(principal,greatest(0,applied-prior))::text end,
    'remaining',case when status='ACTUAL' then (principal-least(principal,greatest(0,applied-prior)))::text end) order by ordinal)
  into entries from (
    select ordinal, kind, due_date, principal,coalesce(sum(principal) over
      (order by ordinal rows between unbounded preceding and 1 preceding),0) prior
    from (
      select ordinal,value->>'kind' kind,value->>'due_date' due_date,(value->>'principal')::numeric principal
      from jsonb_array_elements(schedule.terms->'entries') with ordinality as p(value,ordinal)
    ) terms
  ) projected;

  select coalesce(jsonb_agg(jsonb_build_object('allocation_id',a.id,'event_id',e.id,'date',e.event_date,
    'amount',a.base_amount::text,'kind',a.allocation_type,'event_status',e.status,'settlement_id',s.id,
    'reversal_settlement_id',r.id,'reversal_date',r.settlement_date)
    order by e.event_date,a.created_at,a.id),'[]'::jsonb) into applications
  from public.financial_event_obligation_allocations a
  join public.financial_events e on e.id=a.application_event_id and e.organization_id=a.organization_id
  left join public.liquidity_settlements s on s.financial_event_id=e.id and s.organization_id=org
  left join public.liquidity_settlements r on r.reversal_of_id=s.id and r.organization_id=org and r.status='POSTED'
  where a.obligation_id=schedule.obligation_id and a.organization_id=org and e.status in ('ACTUAL','REVERSED');

  return jsonb_build_object('asset_id',p_asset_id,'purchase_id',schedule.purchase_id,
    'event_id',event.id,'obligation_id',schedule.obligation_id,'status',status,'currency',schedule.currency,
    'mode',schedule.terms->>'mode','document_total',schedule.document_total::text,
    'invoice_net',purchase.gross_value::text,'vat_total',coalesce(purchase.metadata->>'vat_amount','0'),
    'asset_cost',purchase.metadata->>'acquisition_cost_base',
    'applied',case when status='ACTUAL' then applied::text end,
    'remaining',case when status='ACTUAL' then (schedule.document_total-applied)::text end,
    'entries',entries,'applications',applications,
    'native_forecast_id',(select l.target_record_id from public.financial_event_links l
      where l.event_id=event.id and l.organization_id=org and l.link_type='CASH_FLOW'
        and l.target_module='liquidity_flows' and l.metadata->>'purpose'='ASSET_DUE_FORECAST'));
end
$$;
revoke all on function public.read_asset_supplier_schedule(uuid) from public,anon,authenticated;
grant execute on function public.read_asset_supplier_schedule(uuid) to authenticated;
