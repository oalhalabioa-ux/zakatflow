-- Associate an existing expense with a sale for reporting only.
create table private.asset_sale_expense_links (
  source_kind text not null check (source_kind in ('PERSONAL_PAYMENT','POSTED_EXPENSE')),
  source_id uuid not null,
  sale_id uuid not null references public.transactions(id) on delete cascade,
  linked_by uuid not null,
  linked_at timestamptz not null default now(),
  primary key (source_kind, source_id)
);
create index asset_sale_expense_links_sale_idx on private.asset_sale_expense_links(sale_id);
alter table private.asset_sale_expense_links enable row level security;
revoke all on private.asset_sale_expense_links from public, anon, authenticated;

create function private.asset_sale_expense_lineage(p_sale_id uuid)
returns setof uuid language sql stable set search_path='' as $$
  with recursive lineage as (
    select t.id,t.user_id,t.organization_id,t.metadata,array[t.id] visited
      from public.transactions t where t.id=p_sale_id and t.transaction_type='SALE'
    union all
    select old.id,old.user_id,old.organization_id,old.metadata,l.visited||old.id
      from lineage l
      join public.transactions old on old.id=case
        when l.metadata->>'corrects_sale_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (l.metadata->>'corrects_sale_id')::uuid end
      where l.organization_id is null and old.organization_id is null and old.user_id=l.user_id
        and old.transaction_type='SALE' and old.metadata->>'sale_correction_replacement_id'=l.id::text
        and not old.id=any(l.visited)
  )
  select l.id from lineage l;
$$;

create function private.asset_sale_expense_source(p_sale_id uuid, p_source_id uuid)
returns table(state text,amount numeric)
language plpgsql stable set search_path='' as $$
declare sale public.transactions%rowtype; payment public.transactions%rowtype;
  expense public.financial_events%rowtype; total numeric; unsupported boolean;
begin
  select * into sale from public.transactions where id=p_sale_id;
  if sale.organization_id is null then
    select t.* into payment from public.transactions t join public.asset_accounts a on a.id=t.asset_account_id
      where t.id=p_source_id and t.user_id=sale.user_id and t.organization_id is null
        and a.user_id=sale.user_id and a.organization_id is null and a.asset_type in ('CASH','BANK')
        and t.transaction_type='WITHDRAWAL' and t.reversal_of_transaction_id is null and t.transfer_id is null
        and t.base_currency=sale.base_currency and t.base_value>0;
    if not found or payment.metadata->>'asset_deleted'='true' then
      return query select 'INCOMPLETE'::text,null::numeric;
    elsif payment.metadata->>'lifecycle_reversed'='true' or exists(
      select 1 from public.transactions r where r.reversal_of_transaction_id=payment.id
        and r.user_id=payment.user_id and r.organization_id is null and r.metadata->>'asset_deleted' is distinct from 'true'
    ) then return query select 'REVERSED'::text,0::numeric;
    else return query select 'RECORDED'::text,payment.base_value;
    end if;
    return;
  end if;

  select * into expense from public.financial_events e
    where e.id=p_source_id and e.organization_id=sale.organization_id and e.event_type='EXPENSE'
      and e.entity_id is not distinct from sale.entity_id and e.base_currency=sale.base_currency;
  if not found or expense.status not in ('ACTUAL','REVERSED') then
    return query select 'INCOMPLETE'::text,null::numeric;
    return;
  elsif expense.status='REVERSED' then
    return query select 'REVERSED'::text,0::numeric;
    return;
  end if;
  -- Read recognition lines only. Tax notes require separate reconciliation.
  if exists(
    select 1 from public.financial_vat_source_bindings b join public.financial_events n on n.id=b.event_id
      where b.original_event_id=expense.id and n.organization_id=expense.organization_id and n.status='ACTUAL'
  ) or exists(
    select 1 from public.financial_event_links l join public.financial_events n on n.id=l.event_id
      where l.related_event_id=expense.id and l.link_type='CORRECTS'
        and n.organization_id=expense.organization_id and n.status='ACTUAL'
  ) then
    return query select 'INCOMPLETE'::text,null::numeric;
    return;
  end if;
  select sum(case when c.classification_type='OPEX' and line.vat_amount=0 then line.base_amount
             when c.classification_type='TAX' and line.metadata->>'source_role'='INPUT_VAT'
               and line.metadata->>'recoverable_percent' ~ '^[0-9]{1,3}(\.[0-9]+)?$'
             then case when (line.metadata->>'recoverable_percent')::numeric between 0 and 100
                       then round(line.base_amount*(100-(line.metadata->>'recoverable_percent')::numeric)/100,4) end
             end),
    bool_or(case when c.classification_type='OPEX' then line.vat_amount<>0
                 when c.classification_type='TAX' and line.metadata->>'source_role'='INPUT_VAT'
                   and line.metadata->>'recoverable_percent' ~ '^[0-9]{1,3}(\.[0-9]+)?$'
                 then (line.metadata->>'recoverable_percent')::numeric not between 0 and 100
                 else true end)
    into total,unsupported
    from public.financial_event_lines line join public.financial_classifications c
      on c.id=line.classification_id and c.organization_id=line.organization_id
    where line.event_id=expense.id and line.organization_id=expense.organization_id;
  if total>0 and unsupported=false and exists(
    select 1 from public.financial_event_lines l join public.financial_classifications c
      on c.id=l.classification_id and c.organization_id=l.organization_id
      where l.event_id=expense.id and l.organization_id=expense.organization_id and c.classification_type='OPEX'
  ) then return query select 'RECORDED'::text,total;
  else return query select 'INCOMPLETE'::text,null::numeric;
  end if;
end;
$$;

create function private.asset_sale_expenses_internal(p_sale_ids uuid[])
returns table(sale_id uuid,source_id uuid,voucher text,state text,amount text)
language sql stable security definer set search_path='' as $$
  select t.id,link.source_id,v.document_number,source.state,source.amount::text
    from public.transactions t
    cross join lateral private.asset_sale_expense_lineage(t.id) ancestor(id)
    join private.asset_sale_expense_links link on link.sale_id=ancestor.id
    cross join lateral private.asset_sale_expense_source(t.id,link.source_id) source
    left join public.voucher_numbers v on v.source_id=link.source_id
      and v.source_table=case when link.source_kind='PERSONAL_PAYMENT' then 'transactions' else 'financial_events' end
    where cardinality(p_sale_ids) between 1 and 100 and auth.uid() is not null
      and t.id=any(p_sale_ids) and t.transaction_type='SALE'
      and t.metadata->>'asset_deleted' is distinct from 'true'
      and (case when t.organization_id is null then t.user_id=auth.uid()
           else public.has_organization_permission(t.organization_id,'assets.view')
             and public.financial_core_can(t.organization_id,'financial_core.view') end)
  union all
  select t.id,null::uuid,null::text,'INCOMPLETE'::text,null::text
    from public.transactions t where cardinality(p_sale_ids) between 1 and 100 and auth.uid() is not null
      and t.id=any(p_sale_ids) and t.transaction_type='SALE' and t.organization_id is not null
      and t.metadata->>'asset_deleted' is distinct from 'true'
      and public.has_organization_permission(t.organization_id,'assets.view')
      and not public.financial_core_can(t.organization_id,'financial_core.view')
    order by 1,2;
$$;

create function private.link_asset_sale_expense_internal(p_sale_id uuid,p_source text,p_reason text,p_remove boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); sale public.transactions%rowtype; source uuid;
  kind text; voucher_table text; existing uuid; amount numeric;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  if length(trim(coalesce(p_reason,''))) not between 5 and 500
    or length(trim(coalesce(p_source,''))) not between 1 and 80 or p_remove is null then
    raise exception 'SALE_EXPENSE_INPUT_INVALID';
  end if;
  select * into sale from public.transactions t
    where t.id=p_sale_id and t.transaction_type='SALE'
      and (case when t.organization_id is null then t.user_id=actor
        else public.has_organization_permission(t.organization_id,'assets.edit')
          and public.financial_core_can(t.organization_id,'financial_core.post') end)
    for update;
  if not found or sale.metadata->>'asset_deleted'='true' then raise exception 'SALE_EXPENSE_ACCESS_DENIED'; end if;
  kind:=case when sale.organization_id is null then 'PERSONAL_PAYMENT' else 'POSTED_EXPENSE' end;
  voucher_table:=case when sale.organization_id is null then 'transactions' else 'financial_events' end;
  if trim(p_source) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    source:=trim(p_source)::uuid;
  else
    select case when count(*)=1 then (array_agg(v.source_id))[1] end into source from public.voucher_numbers v where v.source_table=voucher_table
      and v.document_number=upper(trim(p_source)) and v.organization_id is not distinct from sale.organization_id
      and (sale.organization_id is not null or v.owner_id=actor);
  end if;
  if source is null then raise exception 'SALE_EXPENSE_SOURCE_UNAVAILABLE'; end if;

  perform pg_advisory_xact_lock(hashtextextended(kind||':'||source::text,0));
  select link.sale_id into existing from private.asset_sale_expense_links link
    where link.source_kind=kind and link.source_id=source for update;
  if p_remove then
    if existing is null then return source; end if;
    if not exists(select 1 from private.asset_sale_expense_lineage(sale.id) a(id) where a.id=existing) then
      raise exception 'SALE_EXPENSE_SOURCE_UNAVAILABLE';
    end if;
    delete from private.asset_sale_expense_links where source_kind=kind and source_id=source;
  else
    if sale.metadata->>'lifecycle_reversed'='true' or sale.metadata ? 'sale_correction_replacement_id'
      or exists(select 1 from public.transactions r where r.reversal_of_transaction_id=sale.id
        and r.organization_id is not distinct from sale.organization_id
        and r.user_id=sale.user_id and r.metadata->>'asset_deleted' is distinct from 'true') then
      raise exception 'SALE_EXPENSE_SALE_INACTIVE';
    end if;
    if sale.organization_id is not null and not exists(
      select 1 from public.asset_lifecycle_commands c join public.financial_events e on e.id=c.financial_event_id
        where c.transaction_id=sale.id and c.organization_id=sale.organization_id and c.asset_account_id=sale.asset_account_id
          and c.operation='SALE' and c.applied_at is not null and e.status='ACTUAL'
          and e.organization_id=sale.organization_id and e.source_module='ASSET_LIFECYCLE' and e.source_record_id=c.id
    ) then raise exception 'SALE_EXPENSE_SALE_INACTIVE'; end if;
    if sale.organization_id is null and not exists(
      select 1 from public.transactions r where r.user_id=actor and r.organization_id is null
        and r.transaction_type='ADD' and r.transfer_id=sale.transfer_id and r.base_value=sale.base_value
        and r.asset_account_id::text=sale.metadata->>'proceeds_account_id' and r.base_currency=sale.base_currency
        and r.metadata->>'sale_transaction_id'=sale.id::text and r.metadata->>'source'='sale_proceeds'
        and r.metadata->>'asset_deleted' is distinct from 'true'
        and r.metadata->>'lifecycle_reversed' is distinct from 'true'
        and not exists(select 1 from public.transactions rv where rv.reversal_of_transaction_id=r.id
          and rv.user_id=actor and rv.organization_id is null and rv.metadata->>'asset_deleted' is distinct from 'true')
    ) then raise exception 'SALE_EXPENSE_SALE_INACTIVE'; end if;
    select s.amount into amount from private.asset_sale_expense_source(sale.id,source) s where s.state='RECORDED';
    if amount is null then raise exception 'SALE_EXPENSE_SOURCE_UNAVAILABLE'; end if;
    if existing is not null then
      if exists(select 1 from private.asset_sale_expense_lineage(sale.id) a(id) where a.id=existing) then return source; end if;
      raise exception 'SALE_EXPENSE_ALREADY_LINKED';
    end if;
    insert into private.asset_sale_expense_links(source_kind,source_id,sale_id,linked_by) values(kind,source,sale.id,actor);
  end if;
  insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)
    values(actor,'transaction',sale.id,case when p_remove then 'UNLINK_ASSET_SALE_EXPENSE' else 'LINK_ASSET_SALE_EXPENSE' end,
      jsonb_build_object('source_id',source,'source_kind',kind,'original_sale_id',existing,
        'organization_id',sale.organization_id,'amount_base',amount,'reason',trim(p_reason)));
  return source;
end;
$$;

create function public.asset_sale_expenses(p_sale_ids uuid[])
returns table(sale_id uuid,source_id uuid,voucher text,state text,amount text)
language sql stable security invoker set search_path='' as $$
  select * from private.asset_sale_expenses_internal(p_sale_ids);
$$;

create function public.link_asset_sale_expense(p_sale_id uuid,p_source text,p_reason text,p_remove boolean default false)
returns uuid language sql security invoker set search_path='' as $$
  select private.link_asset_sale_expense_internal(p_sale_id,p_source,p_reason,p_remove);
$$;

revoke all on function private.asset_sale_expenses_internal(uuid[]),private.link_asset_sale_expense_internal(uuid,text,text,boolean)
  from public,anon,authenticated;
grant execute on function private.asset_sale_expenses_internal(uuid[]),private.link_asset_sale_expense_internal(uuid,text,text,boolean)
  to authenticated;

revoke all on function private.asset_sale_expense_lineage(uuid),private.asset_sale_expense_source(uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.asset_sale_expenses(uuid[]),public.link_asset_sale_expense(uuid,text,text,boolean)
  from public,anon,authenticated;
grant execute on function public.asset_sale_expenses(uuid[]),public.link_asset_sale_expense(uuid,text,text,boolean) to authenticated;
notify pgrst,'reload schema';
