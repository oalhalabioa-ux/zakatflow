-- The purchase, payable and each payment keep their existing ledgers.
create table public.personal_asset_supplier_schedules (
  purchase_id uuid primary key references public.transactions(id),
  asset_id uuid not null unique references public.asset_accounts(id),
  user_id uuid not null references auth.users(id),
  payable_id uuid not null unique,
  down_payment_id uuid references public.personal_payable_payments(id),
  terms jsonb not null,
  foreign key (payable_id,user_id) references public.personal_payables(id,user_id)
);
alter table public.personal_asset_supplier_schedules enable row level security;
revoke all on public.personal_asset_supplier_schedules from public,anon,authenticated;
grant select on public.personal_asset_supplier_schedules to authenticated;
create policy personal_asset_supplier_schedules_owner on public.personal_asset_supplier_schedules
  for select to authenticated using (user_id=(select auth.uid()));

create function private.bind_personal_asset_supplier_schedule(p_purchase_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  purchase public.transactions%rowtype;
  asset public.asset_accounts%rowtype;
  terms jsonb;
  entry jsonb;
  first_due date;
  previous_due date;
  entry_due date;
  amount numeric;
  scale integer;
  inventory_total numeric;
  total numeric:=0;
  down numeric:=0;
  installments integer:=0;
  payable_id uuid;
  down_id uuid;
  down_account_id uuid;
  payment jsonb;
  position integer:=0;
begin
  select * into purchase from public.transactions where id=p_purchase_id and user_id=actor for update;
  select * into asset from public.asset_accounts where id=purchase.asset_account_id and user_id=actor;
  if actor is null or purchase.id is null or asset.id is null
    or purchase.transaction_type<>'PURCHASE' or purchase.organization_id is not null
    or purchase.metadata->>'source' is distinct from 'ATOMIC_ASSET_ACQUISITION'
    or purchase.metadata ?| array['funding_account_id','funding_amount','funding_currency','purchase_funding']
    or asset.organization_id is not null or asset.ownership_scope<>'PERSONAL'
    or asset.is_zakatable or asset.asset_type not in ('OTHER','REAL_ESTATE')
    or (asset.asset_class_code is not null and asset.asset_class_code not in ('PPE','INTANGIBLE'))
    or asset.currency is distinct from purchase.currency or purchase.base_currency<>purchase.currency
    or not exists(select 1 from public.lots l where l.source_transaction_id=purchase.id
      and l.user_id=actor and l.asset_account_id=asset.id)
  then raise exception 'PERSONAL_SUPPLIER_ASSET_UNSUPPORTED'; end if;

  terms:=purchase.metadata->'personal_supplier_terms';
  if jsonb_typeof(terms) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(terms) k where k not in ('mode','supplier_name','down_payment_account_id','entries'))
    or coalesce(terms->>'mode','') not in ('DEFERRED','INSTALLMENTS')
    or length(trim(coalesce(terms->>'supplier_name',''))) not between 1 and 120
    or jsonb_typeof(terms->'entries') is distinct from 'array'
    or jsonb_array_length(terms->'entries') not between 1 and 120
  then raise exception 'PERSONAL_SUPPLIER_SCHEDULE_INVALID'; end if;
  select decimals into scale from public.currencies where code=purchase.currency;
  if scale is null or scale not between 0 and 4
  then raise exception 'PERSONAL_SUPPLIER_CURRENCY_UNSUPPORTED'; end if;
  inventory_total:=purchase.gross_value+(purchase.metadata->>'vat_amount')::numeric;
  if inventory_total is null or inventory_total<=0 or inventory_total>1e12
  then raise exception 'PERSONAL_SUPPLIER_SCHEDULE_INVALID'; end if;
  down_account_id:=nullif(terms->>'down_payment_account_id','')::uuid;

  for entry in select value from jsonb_array_elements(terms->'entries') loop
    position:=position+1;
    if jsonb_typeof(entry) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(entry) k where k not in ('kind','due_date','principal'))
      or coalesce(entry->>'kind','') not in ('DOWN_PAYMENT','INSTALLMENT')
      or coalesce(entry->>'due_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or jsonb_typeof(entry->'principal') is distinct from 'string'
      or coalesce(entry->>'principal','') !~ '^[0-9]{1,12}(\.[0-9]{1,4})?$'
    then raise exception 'PERSONAL_SUPPLIER_SCHEDULE_INVALID'; end if;
    amount:=(entry->>'principal')::numeric;
    entry_due:=(entry->>'due_date')::date;
    if amount<=0 or round(amount,scale)<>amount or entry_due<purchase.transaction_date
      or (previous_due is not null and entry_due<previous_due)
    then raise exception 'PERSONAL_SUPPLIER_SCHEDULE_INVALID'; end if;
    if entry->>'kind'='DOWN_PAYMENT' then
      if position<>1 or entry_due<>purchase.transaction_date
      then raise exception 'PERSONAL_SUPPLIER_SCHEDULE_INVALID'; end if;
      down:=amount;
    else
      first_due:=coalesce(first_due,entry_due);
      installments:=installments+1;
    end if;
    previous_due:=entry_due;
    total:=total+amount;
  end loop;
  if (terms->>'mode'='DEFERRED' and installments<>1)
    or (terms->>'mode'='INSTALLMENTS' and installments<2)
    or (down>0) is distinct from (down_account_id is not null)
  then raise exception 'PERSONAL_SUPPLIER_SCHEDULE_INVALID'; end if;
  if total<>inventory_total then raise exception 'PERSONAL_SUPPLIER_SCHEDULE_TOTAL_MISMATCH'; end if;

  payable_id:=(public.personal_payable_categorized_command(jsonb_build_object(
    'action','CREATE','request_id',purchase.id,'party',terms->>'supplier_name',
    'description','Asset purchase / '||asset.name,'category','P_AP_INSTALLMENT',
    'amount',total,'date',purchase.transaction_date,'due_date',first_due,
    'reference',coalesce(purchase.reference,purchase.id::text)))->>'id')::uuid;
  insert into public.personal_asset_supplier_schedules(purchase_id,asset_id,user_id,payable_id,terms)
    values(purchase.id,asset.id,actor,payable_id,terms);
  if down>0 then
    payment:=public.personal_payable_command(jsonb_build_object(
      'action','PAY','request_id',purchase.id,'payable_id',payable_id,'account_id',down_account_id,
      'amount',down,'date',purchase.transaction_date,'notes','Asset supplier down payment'));
    down_id:=(payment->>'id')::uuid;
    update public.personal_asset_supplier_schedules s set down_payment_id=down_id
      where s.purchase_id=purchase.id;
  end if;
  return payable_id;
end
$$;
revoke all on function private.bind_personal_asset_supplier_schedule(uuid) from public,anon,authenticated;
grant execute on function private.bind_personal_asset_supplier_schedule(uuid) to authenticated;

-- Purchase keeps its actual type/date, its native lot, and the #531 cash branch.
-- Existing corporate and personal cash paths retain their exact logic.
do $migration$
declare
  definition text:=pg_get_functiondef('public.create_asset_with_acquisition(jsonb,uuid)'::regprocedure);
  old_body text:='  wid:=private.fund_personal_asset_purchase(tid);';
begin
  if md5(definition)<>'861d2f352283b7420e160fcbc9ffbfbf'
    or length(definition)-length(replace(definition,old_body,''))<>length(old_body)
  then raise exception 'PERSONAL_SUPPLIER_ACQUISITION_DEFINITION_CHANGED'; end if;
  execute replace(definition,old_body,$branch$  if m ? 'personal_supplier_terms' then
   perform private.bind_personal_asset_supplier_schedule(tid);
  else
   wid:=private.fund_personal_asset_purchase(tid);
  end if;$branch$);
end
$migration$;

-- Existing payment RPC already books, allocates and reverses FIFO. A supplier
-- payment in the base currency must debit the nominal cash units as well.
create function private.guard_personal_asset_supplier_payment()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.personal_asset_supplier_schedules s
    where s.payable_id=new.payable_id and s.user_id=new.user_id)
    and not exists(select 1 from public.transactions t
       where t.id=new.transaction_id and t.user_id=new.user_id and t.organization_id is null
         and t.asset_account_id=new.account_id and t.transaction_type='WITHDRAWAL'
         and t.transaction_date=new.payment_date
         and t.quantity=new.amount and t.gross_value=new.amount and t.base_value=new.amount
         and t.currency=t.base_currency)
  then raise exception 'PERSONAL_SUPPLIER_PAYMENT_UNITS_MISMATCH'; end if;
  return new;
end
$$;
revoke all on function private.guard_personal_asset_supplier_payment() from public,anon,authenticated;
create trigger personal_asset_supplier_payment_units
  before insert on public.personal_payable_payments
  for each row execute function private.guard_personal_asset_supplier_payment();

create function private.guard_personal_asset_supplier_payable()
returns trigger language plpgsql set search_path='' as $$
declare source_purchase uuid;
begin
  select s.purchase_id into source_purchase from public.personal_asset_supplier_schedules s
    where s.payable_id=old.id and s.user_id=old.user_id;
  if source_purchase is not null and (
    (new.amount,new.currency,new.event_date,new.due_date,new.reference,new.party) is distinct from
    (old.amount,old.currency,old.event_date,old.due_date,old.reference,old.party)
    or (new.cancelled_at is distinct from old.cancelled_at and
      (new.cancelled_at is null or old.cancelled_at is not null or not exists(
        select 1 from public.transactions r where r.user_id=old.user_id and r.organization_id is null
          and r.reversal_of_transaction_id=source_purchase and r.transaction_type='REVERSAL'
          and r.transaction_date=(new.cancelled_at at time zone 'Asia/Riyadh')::date
      )))
  ) then raise exception 'PERSONAL_SUPPLIER_USE_ASSET_SOURCE'; end if;
  return new;
end
$$;
revoke all on function private.guard_personal_asset_supplier_payable() from public,anon,authenticated;
create trigger personal_asset_supplier_payable_guard
  before update on public.personal_payables
  for each row execute function private.guard_personal_asset_supplier_payable();

create function public.create_personal_supplier_asset(p_asset jsonb,p_request_id uuid,p_terms jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  asset jsonb;
  source public.personal_asset_supplier_schedules%rowtype;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_asset->>'ownership_scope' is distinct from 'PERSONAL'
    or p_asset#>>'{metadata,acquisition_mode}' is distinct from 'PURCHASE'
    or coalesce((p_asset->>'is_zakatable')::boolean,true)
    or p_asset->>'asset_type' is null or p_asset->>'asset_type' not in ('OTHER','REAL_ESTATE')
    or p_asset->>'organization_id' is not null or p_asset->>'entity_id' is not null or p_asset->>'cost_center_id' is not null
    or jsonb_typeof(p_terms) is distinct from 'object'
  then raise exception 'PERSONAL_SUPPLIER_ASSET_UNSUPPORTED'; end if;
  asset:=public.create_asset_with_acquisition(
    jsonb_set(p_asset,'{metadata,personal_supplier_terms}',p_terms),p_request_id);
  select * into strict source from public.personal_asset_supplier_schedules
    where asset_id=(asset->>'id')::uuid and user_id=auth.uid();
  return asset||jsonb_build_object('acquisition_transaction_id',source.purchase_id,'payable_id',source.payable_id);
end
$$;
revoke all on function public.create_personal_supplier_asset(jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_personal_supplier_asset(jsonb,uuid,jsonb) to authenticated;

create function private.reverse_personal_asset_supplier_payable()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  schedule public.personal_asset_supplier_schedules%rowtype;
  down_payment_active boolean;
begin
  select * into schedule from public.personal_asset_supplier_schedules where purchase_id=new.reversal_of_transaction_id;
  if not found then return new; end if;
  if auth.uid() is distinct from schedule.user_id or new.user_id<>schedule.user_id
    or new.organization_id is not null or new.asset_account_id<>schedule.asset_id
    or new.transaction_type<>'REVERSAL'
    or not exists(select 1 from public.lots l where l.source_transaction_id=schedule.purchase_id
      and l.user_id=schedule.user_id and l.remaining_quantity=0 and l.remaining_value_base=0)
  then raise exception 'PERSONAL_SUPPLIER_REVERSAL_INVALID'; end if;

  if exists(select 1 from public.transactions t where t.asset_account_id=schedule.asset_id
      and t.id not in (schedule.purchase_id,new.id) and t.user_id=schedule.user_id
      and coalesce(t.metadata->>'asset_deleted','false')<>'true')
  then raise exception 'PERSONAL_SUPPLIER_REVERSAL_HAS_ASSET_MOVEMENTS'; end if;

  perform pg_advisory_xact_lock(hashtextextended('personal-payable:'||schedule.user_id::text,0));
  perform id from public.personal_payables where id=schedule.payable_id and user_id=schedule.user_id for update;
  if exists(select 1 from public.personal_payable_payments p where p.payable_id=schedule.payable_id
      and p.user_id=schedule.user_id and p.id is distinct from schedule.down_payment_id
      and not exists(select 1 from public.transactions r where r.reversal_of_transaction_id=p.transaction_id
        and r.user_id=schedule.user_id and r.organization_id is null and r.transaction_type='REVERSAL'))
  then raise exception 'PERSONAL_SUPPLIER_REVERSE_INSTALLMENTS_FIRST'; end if;

  select exists(select 1 from public.personal_payable_payments p where p.id=schedule.down_payment_id
      and p.payable_id=schedule.payable_id and p.user_id=schedule.user_id
      and not exists(select 1 from public.transactions r where r.reversal_of_transaction_id=p.transaction_id
        and r.user_id=schedule.user_id and r.organization_id is null and r.transaction_type='REVERSAL'))
  into down_payment_active;
  if down_payment_active then
    perform public.personal_payable_command(jsonb_build_object('action','REVERSE_PAYMENT',
      'payable_id',schedule.payable_id,'payment_id',schedule.down_payment_id,'reason','Reverse asset supplier down payment'));
  end if;

  update public.personal_payables set
    cancelled_at=(new.transaction_date::timestamp+interval '12 hours') at time zone 'Asia/Riyadh',
    cancel_reason='ASSET_SUPPLIER_PURCHASE_REVERSED'
  where id=schedule.payable_id and user_id=schedule.user_id and cancelled_at is null;
  insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)
  values(schedule.user_id,'personal_payable',schedule.payable_id,'REVERSE_ASSET_SUPPLIER_PURCHASE',
    jsonb_build_object('purchase_id',schedule.purchase_id,'reversal_id',new.id));
  return new;
end
$$;
revoke all on function private.reverse_personal_asset_supplier_payable() from public,anon,authenticated;
create trigger personal_asset_supplier_purchase_reverse after insert on public.transactions
  for each row when (new.reversal_of_transaction_id is not null)
  execute function private.reverse_personal_asset_supplier_payable();

create function private.guard_personal_asset_supplier_purchase()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.personal_asset_supplier_schedules s
      where s.purchase_id in (old.id,old.reversal_of_transaction_id) and s.user_id=old.user_id) then
    if tg_op='DELETE' then raise exception 'PERSONAL_SUPPLIER_USE_ASSET_SOURCE'; end if;
    if (new.user_id,new.asset_account_id,new.organization_id,new.transaction_type,new.transaction_date,
        new.quantity,new.unit_price,new.currency,new.gross_value,new.base_currency,new.base_value,
        new.reversal_of_transaction_id,new.metadata->'personal_supplier_terms',new.metadata->>'asset_deleted') is distinct from
       (old.user_id,old.asset_account_id,old.organization_id,old.transaction_type,old.transaction_date,
        old.quantity,old.unit_price,old.currency,old.gross_value,old.base_currency,old.base_value,
        old.reversal_of_transaction_id,old.metadata->'personal_supplier_terms',old.metadata->>'asset_deleted')
    then raise exception 'PERSONAL_SUPPLIER_USE_ASSET_SOURCE'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function private.guard_personal_asset_supplier_purchase() from public,anon,authenticated;
create trigger personal_asset_supplier_purchase_guard before update or delete on public.transactions
  for each row when (old.organization_id is null and old.transaction_type in ('PURCHASE','REVERSAL'))
  execute function private.guard_personal_asset_supplier_purchase();

create function private.guard_personal_asset_supplier_identity()
returns trigger language plpgsql set search_path='' as $$
begin
  if (new.user_id,new.organization_id,new.ownership_scope,new.asset_type,new.currency,new.is_zakatable)
    is distinct from (old.user_id,old.organization_id,old.ownership_scope,old.asset_type,old.currency,old.is_zakatable)
    and exists(select 1 from public.personal_asset_supplier_schedules
      where asset_id=old.id and user_id=old.user_id)
  then raise exception 'PERSONAL_SUPPLIER_USE_ASSET_SOURCE'; end if;
  return new;
end
$$;
revoke all on function private.guard_personal_asset_supplier_identity() from public,anon,authenticated;
create trigger personal_asset_supplier_identity_guard before update of user_id,organization_id,ownership_scope,asset_type,currency,is_zakatable
  on public.asset_accounts for each row execute function private.guard_personal_asset_supplier_identity();

create function public.reverse_personal_supplier_asset(p_asset_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  actor uuid:=auth.uid();
  purchase_id uuid;
  reversal_id uuid;
begin
  select s.purchase_id into purchase_id from public.personal_asset_supplier_schedules s
    where s.asset_id=p_asset_id and s.user_id=actor;
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  if purchase_id is null then raise exception 'PERSONAL_SUPPLIER_ACCESS_DENIED'; end if;
  perform id from public.transactions where id=purchase_id and user_id=actor for update;
  select id into reversal_id from public.transactions
    where reversal_of_transaction_id=purchase_id and user_id=actor and organization_id is null;
  if reversal_id is null then
    perform set_config('TimeZone','Asia/Riyadh',true);
    reversal_id:=public.reverse_transaction(actor,purchase_id);
  end if;
  return reversal_id;
end
$$;
revoke all on function public.reverse_personal_supplier_asset(uuid) from public,anon,authenticated;
grant execute on function public.reverse_personal_supplier_asset(uuid) to authenticated;

create function public.read_personal_supplier_schedule(p_asset_id uuid,p_as_of date default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  actor uuid:=auth.uid();
  cutoff date:=coalesce(p_as_of,(now() at time zone 'Asia/Riyadh')::date);
  schedule public.personal_asset_supplier_schedules%rowtype;
  debt public.personal_payables%rowtype;
  purchase public.transactions%rowtype;
  reversal_id uuid;
  payments jsonb;
  entries jsonb;
  paid numeric;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists(select 1 from public.asset_accounts a where a.id=p_asset_id and a.user_id=actor
    and a.organization_id is null and a.ownership_scope='PERSONAL')
  then raise exception 'PERSONAL_SUPPLIER_ACCESS_DENIED'; end if;
  select * into schedule from public.personal_asset_supplier_schedules where asset_id=p_asset_id and user_id=actor;
  if not found then return null; end if;
  select * into strict purchase from public.transactions where id=schedule.purchase_id and user_id=actor;
  if purchase.transaction_date>cutoff then return null; end if;
  select * into strict debt from public.personal_payables where id=schedule.payable_id and user_id=actor;
  select id into reversal_id from public.transactions where reversal_of_transaction_id=purchase.id
    and user_id=actor and organization_id is null and transaction_date<=cutoff;
  select coalesce(sum(p.amount) filter(where r.id is null),0),
    coalesce(jsonb_agg(jsonb_build_object('payment_id',p.id,'transaction_id',p.transaction_id,
      'account_id',p.account_id,'amount',p.amount::text,'date',p.payment_date,
      'kind',case when p.id=schedule.down_payment_id then 'DOWN_PAYMENT' else 'INSTALLMENT' end,
      'reversal_id',r.id,'reversal_date',r.transaction_date) order by p.payment_date,p.created_at,p.id),'[]'::jsonb)
  into paid,payments
    from public.personal_payable_payments p left join public.transactions r
      on r.reversal_of_transaction_id=p.transaction_id and r.user_id=actor and r.organization_id is null
        and r.transaction_type='REVERSAL' and r.transaction_date<=cutoff
    where p.payable_id=debt.id and p.user_id=actor and p.payment_date<=cutoff;
  select jsonb_agg(jsonb_build_object('id',purchase.id::text||':'||position,'position',position,
    'kind',kind,'due_date',due_date,'principal',principal::text,
    'applied',case when reversal_id is null then allocated::text end,
    'remaining',case when reversal_id is null then (principal-allocated)::text end) order by position)
  into entries from (
    select *,least(principal,greatest(0,paid-coalesce(sum(principal) over
      (order by position rows between unbounded preceding and 1 preceding),0))) allocated
    from (
      select position,value->>'kind' kind,value->>'due_date' due_date,(value->>'principal')::numeric principal
      from jsonb_array_elements(schedule.terms->'entries') with ordinality as p(value,position)
    ) terms
  ) distribution;
  return jsonb_build_object('asset_id',p_asset_id,'purchase_id',purchase.id,'payable_id',debt.id,
    'supplier_name',debt.party,'mode',schedule.terms->>'mode','currency',debt.currency,'as_of',cutoff,
    'status',case when reversal_id is not null then 'REVERSED' else 'ACTUAL' end,'purchase_reversal_id',reversal_id,
    'document_total',debt.amount::text,'invoice_net',purchase.gross_value::text,
    'vat_total',purchase.metadata->>'vat_amount','asset_cost',purchase.metadata->>'acquisition_cost_base',
    'applied',paid::text,'remaining',(case when reversal_id is null then debt.amount-paid else 0 end)::text,
    'entries',entries,'applications',payments);
end
$$;
revoke all on function public.read_personal_supplier_schedule(uuid,date) from public,anon,authenticated;
grant execute on function public.read_personal_supplier_schedule(uuid,date) to authenticated;
