-- Current invoice and cash positions at the assessed date, reconstructed from the dated accounting source.
create function public.personal_invoice_hawl_positions_at_cutoff(p_cutoff date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 actor uuid:=auth.uid();
 invoice public.personal_income_documents;
 terms jsonb;
 receipts jsonb;
 receipt jsonb;
 on_receipt jsonb;
 previous_day jsonb;
 receipt_date date;
 eligible_since date;
 receivable_lot_id uuid;
 gross_remaining numeric;
 net_remaining numeric;
 root_gross numeric;
 root_net numeric;
 receipt_lot_id uuid;
 bank_rows jsonb;
 output_rows jsonb:='[]';
 any_invalid boolean;
begin
 if actor is null then raise exception 'UNAUTHORIZED'; end if;
 if p_cutoff is null or not isfinite(p_cutoff) or p_cutoff>(now() at time zone 'Asia/Riyadh')::date then
  raise exception 'PERSONAL_CUTOFF_INVALID';
 end if;

 for invoice in
  select d.* from public.personal_income_documents d
  join public.asset_accounts a on a.id=d.receivable_id and a.user_id=actor
   and a.organization_id is null and a.ownership_scope='PERSONAL'
   and a.asset_type='RECEIVABLE' and a.is_zakatable
  where d.owner_id=actor and d.document_date<=p_cutoff
  order by d.id
 loop
  terms:=public.read_personal_invoice_hawl_at_cutoff(invoice.id,p_cutoff);
  receipts:=public.read_personal_invoice_collection_lots_at_cutoff(invoice.id,p_cutoff);
  if terms->>'status' is distinct from 'VERIFIED' or receipts->>'status' is distinct from 'VERIFIED'
    or (terms->>'grossRemaining')::numeric is distinct from (receipts->>'grossRemaining')::numeric
    or (terms->>'netCollected')::numeric is distinct from (receipts->>'netCollected')::numeric then
   raise exception 'HAWL_CONTINUITY_INVOICE_EVIDENCE_REQUIRED';
  end if;

  gross_remaining:=(terms->>'grossRemaining')::numeric;
  net_remaining:=(terms->>'netEligibleReceivable')::numeric;
  if gross_remaining>0 then
   select l.id into strict receivable_lot_id
   from public.lots l
   join public.transactions t on t.id=l.source_transaction_id and t.user_id=actor
   where l.asset_account_id=invoice.receivable_id and l.user_id=actor and l.organization_id is null
    and t.asset_account_id=invoice.receivable_id and t.organization_id is null and t.transaction_type='ADD'
    and t.metadata->>'personal_income_document_id'=invoice.id::text
    and l.acquisition_date=invoice.document_date
    and l.original_quantity=invoice.gross_amount and l.original_value_base=invoice.gross_amount;
   output_rows:=output_rows||jsonb_build_array(jsonb_build_object(
    'lotId',receivable_lot_id,'documentId',invoice.id,'kind','RECEIVABLE',
    'grossBase',gross_remaining,'netBase',net_remaining,
    'eligibleSince',terms->>'receivableEligibleSince','eventId',terms->>'eventId'));
  end if;

  for receipt in select value from jsonb_array_elements(receipts->'rows') loop
   receipt_date:=(receipt->>'collectedOn')::date;
   receipt_lot_id:=(receipt->>'bankLotId')::uuid;
   root_gross:=(receipt->>'grossCollected')::numeric;
   root_net:=(receipt->>'netCollected')::numeric;
   on_receipt:=public.read_personal_invoice_hawl_at_cutoff(invoice.id,receipt_date);
   if on_receipt->>'status' is distinct from 'VERIFIED' then
    raise exception 'HAWL_CONTINUITY_INVOICE_EVIDENCE_REQUIRED';
   end if;
   eligible_since:=receipt_date;
   if on_receipt->>'classification' in ('GOOD','EXCELLENT')
      and (on_receipt->>'dueDate')::date<=receipt_date and receipt_date>invoice.document_date then
    previous_day:=public.read_personal_invoice_hawl_at_cutoff(invoice.id,receipt_date-1);
    eligible_since:=coalesce((previous_day->>'receivableEligibleSince')::date,receipt_date);
   end if;

   with recursive
   -- Physical bank balance remains gross. The intervals below partition the
   -- original receipt before rounding, including a remainder after FIFO use.
   family as (
    select l.id,l.asset_account_id,l.source_transaction_id,l.acquisition_date,l.original_value_base,
      l.original_quantity,l.remaining_value_base,l.remaining_quantity,l.hawl_continuity_source_lot_id,l.metadata,
      array[l.id] path,false cycle
    from public.lots l where l.id=receipt_lot_id and l.user_id=actor and l.organization_id is null
    union all
    select l.id,l.asset_account_id,l.source_transaction_id,l.acquisition_date,l.original_value_base,
      l.original_quantity,l.remaining_value_base,l.remaining_quantity,l.hawl_continuity_source_lot_id,l.metadata,
      f.path||l.id,l.id=any(f.path)
    from family f
    join public.lots l on l.hawl_continuity_source_lot_id=f.id and l.user_id=actor and l.organization_id is null
    where not f.cycle and l.acquisition_date<=p_cutoff
   ), allocation as (
    select x.id,x.lot_id,x.quantity,x.value_base,t.id transaction_id,t.transaction_type,t.transaction_date,
      t.created_at,t.transfer_id,t.currency,t.base_currency,t.asset_account_id,t.metadata,t.reversal_of_transaction_id
    from family f
    join public.transaction_allocations x on x.lot_id=f.id and x.user_id=actor
    join public.transactions t on t.id=x.transaction_id and t.user_id=actor and t.organization_id is null
    where not f.cycle
   ), ordered as (
    select x.*,coalesce(sum(x.value_base) over(partition by x.lot_id
     order by x.transaction_date,x.created_at,x.transaction_id,x.id
     rows between unbounded preceding and 1 preceding),0) consumed_before
    from allocation x
   ), edges as (
    select child.id,p.id parent_id, x.consumed_before
    from family child
    join family p on p.id=child.hawl_continuity_source_lot_id
    join public.transactions incoming on incoming.id=child.source_transaction_id and incoming.user_id=actor
      and incoming.organization_id is null and incoming.transaction_type='TRANSFER_IN'
      and incoming.reversal_of_transaction_id is null and incoming.asset_account_id=child.asset_account_id
      and incoming.transaction_date=child.acquisition_date
    join ordered x on x.lot_id=p.id and x.asset_account_id=p.asset_account_id
      and x.transaction_type='TRANSFER_OUT' and x.transfer_id=incoming.transfer_id
      and x.transaction_date=incoming.transaction_date and x.currency=incoming.currency
      and x.base_currency=incoming.base_currency and x.reversal_of_transaction_id is null
      and child.original_value_base=x.value_base and child.original_quantity=x.quantity
    where not child.cycle and not p.cycle
      and child.metadata->>'source'='internal_transfer'
      and child.metadata->>'source_lot_id'=p.id::text
      and child.metadata->>'transfer_id'=incoming.transfer_id::text
      and incoming.currency=receipts->>'currency' and incoming.base_currency=receipts->>'currency'
   ), intervals as (
    select id,0::numeric start_gross,array[id] path
    from family where id=receipt_lot_id and not cycle
    union all
    select e.id,i.start_gross+e.consumed_before,i.path||e.id
    from intervals i join edges e on e.parent_id=i.id where not e.id=any(i.path)
   ), remaining as (
    select f.*,i.start_gross,
      f.original_value_base-coalesce(s.before_cutoff,0) gross_at_cutoff,
      a.id as validated_account,s.invalid,
      f.original_value_base-coalesce(s.total,0) reconciled_remaining
    from family f
    left join intervals i on i.id=f.id
    left join public.asset_accounts a on a.id=f.asset_account_id and a.user_id=actor
      and a.organization_id is null and a.ownership_scope='PERSONAL'
      and a.asset_type in ('BANK','CASH') and a.currency=receipts->>'currency'
    left join lateral (
     select sum(x.value_base) total,sum(x.value_base) filter(where x.transaction_date<=p_cutoff) before_cutoff,
       bool_or(x.quantity<>x.value_base or x.value_base<=0 or x.asset_account_id<>f.asset_account_id
        or x.currency<>receipts->>'currency' or x.base_currency<>receipts->>'currency'
        or x.reversal_of_transaction_id is not null
        or x.metadata->>'asset_deleted'='true'
        or (x.transaction_type='TRANSFER_OUT' and x.transaction_date<=p_cutoff and
         (select count(*)
          from edges e join family child on child.id=e.id
          join public.transactions incoming on incoming.id=child.source_transaction_id
          where e.parent_id=f.id and incoming.transfer_id=x.transfer_id
            and child.original_value_base=x.value_base and child.original_quantity=x.quantity)<>1)
        or x.transaction_type not in ('TRANSFER_OUT','WITHDRAWAL','ZAKAT_PAYMENT')
        or exists(select 1 from public.transactions r where r.user_id=actor
            and r.organization_id is null and r.reversal_of_transaction_id=x.transaction_id)) invalid
     from ordered x where x.lot_id=f.id
    ) s on true
   )
   select coalesce(bool_or(r.cycle or r.validated_account is null or r.start_gross is null
     or r.start_gross<0 or r.start_gross+r.original_value_base>root_gross
     or r.original_quantity<>r.original_value_base or r.remaining_quantity<>r.remaining_value_base
     or r.reconciled_remaining<>r.remaining_value_base or r.gross_at_cutoff<0 or r.invalid),false)
    or count(*)=0 or count(*)<>count(distinct r.id),
    coalesce(jsonb_agg(jsonb_build_object('lotId',r.id,'documentId',invoice.id,'kind','RECEIPT_CASH',
      'rootBankLotId',receipt_lot_id,'transferId',receipt->>'transferId','collectedOn',receipt_date,
      'grossBase',r.gross_at_cutoff,
      'netBase',round(root_net*(r.start_gross+r.original_value_base)/root_gross,8)
        -round(root_net*(r.start_gross+r.original_value_base-r.gross_at_cutoff)/root_gross,8),
      'eligibleSince',eligible_since,'eventId',on_receipt->>'eventId'
    ) order by r.id) filter(where r.gross_at_cutoff>0),'[]')
   into any_invalid,bank_rows from remaining r;
   if any_invalid then raise exception 'HAWL_CONTINUITY_INVOICE_BANK_LINEAGE_REQUIRED'; end if;
   output_rows:=output_rows||bank_rows;
  end loop;
 end loop;
 if (select count(*)<>count(distinct p->>'lotId') from jsonb_array_elements(output_rows) p) then
  raise exception 'HAWL_CONTINUITY_INVOICE_BANK_LINEAGE_REQUIRED';
 end if;
 return output_rows;
exception when no_data_found or too_many_rows then
 raise exception 'HAWL_CONTINUITY_INVOICE_EVIDENCE_REQUIRED';
end
$$;
revoke all on function public.personal_invoice_hawl_positions_at_cutoff(date) from public,anon;
grant execute on function public.personal_invoice_hawl_positions_at_cutoff(date) to authenticated;

-- Method periods come from the same invoice and FIFO evidence the database saves.
create function private.personal_invoice_assessment_positions(
 p_cycle uuid,p_method uuid,p_cutoff date,p_continuity jsonb
) returns jsonb language sql stable security invoker set search_path='' as $$
 with method as (
  select code,calendar_type from public.zakat_methods where id=p_method
 ), cycle as (
  select hawl_start_date,hawl_due_date from public.zakat_hawl_cycles
  where id=p_cycle and user_id=auth.uid()
 ), positions as materialized (
  select r,l.id, m.code,m.calendar_type,(r->>'eligibleSince')::date holding_since,
   greatest(c.hawl_due_date,(p_continuity->>'effectiveDue')::date) pool_due,
   coalesce((p_continuity->>'effectiveStart')::date,c.hawl_start_date) pool_start
  from jsonb_array_elements(public.personal_invoice_hawl_positions_at_cutoff(p_cutoff)) r
  join public.lots l on l.id=(r->>'lotId')::uuid and l.user_id=auth.uid()
  join public.asset_accounts a on a.id=l.asset_account_id and a.user_id=auth.uid()
    and a.organization_id is null and a.ownership_scope='PERSONAL' and a.is_zakatable
  cross join method m left join cycle c on true
 ), coverage as (
  select p.*,greatest(base.covered_through,invoice_final.covered_through) covered_through,
   greatest(base.hawl_period,invoice_final.hawl_period+1) hawl_period
  from positions p
  left join lateral (
   select x.covered_through,x.hawl_period from public.zakat_lot_hawl_periods(p.calendar_type) x where x.lot_id=p.id
  ) base on p.holding_since is not null
  left join lateral (
   -- Cash collected after a final receivable assessment keeps that coverage
   -- only when the collected principal inherited the same eligibility range.
   select (line.valuation_snapshot->>'hawlDueDate')::date covered_through,
          (line.valuation_snapshot->>'hawlPeriod')::integer hawl_period
   from public.zakat_assessment_lines line
   join public.zakat_assessments saved on saved.id=line.assessment_id and saved.user_id=auth.uid()
   join public.zakat_hawl_cycles closed on closed.final_assessment_id=saved.id and closed.user_id=saved.user_id
   where line.zakat_amount>0
    and line.valuation_snapshot->'invoiceHawlPosition'->>'documentId'=p.r->>'documentId'
    and line.valuation_snapshot->'invoiceHawlPosition'->>'eligibleSince'=p.r->>'eligibleSince'
    and (line.lot_id=p.id or (
     p.r->>'kind'='RECEIPT_CASH'
     and line.valuation_snapshot->'invoiceHawlPosition'->>'kind'='RECEIVABLE'
     and saved.assessment_date<(p.r->>'collectedOn')::date))
   order by covered_through desc,hawl_period desc limit 1
  ) invoice_final on p.holding_since is not null
 ), previous as (
  select p.*,
   p.code='UNIFIED_HAWL' and p.holding_since<=p.pool_due
    and (p.covered_through is null or p.covered_through<p.pool_due) as pooled
  from coverage p
 ), dates as (
  select *,case when holding_since is null then null
   when pooled then pool_start
   else greatest(holding_since,covered_through,public.personal_first_hawl_start(),
    (p_continuity->>'effectiveStart')::date) end starts_on
  from previous
 )
 select coalesce(jsonb_agg(r||jsonb_build_object(
  'hawlStartDate',starts_on,
  'hawlDueDate',case when pooled then pool_due
                  when starts_on is not null then public.zakat_next_hawl_date(starts_on,calendar_type) end,
  'coveredThrough',covered_through,'hawlPeriod',coalesce(hawl_period,1),
  'periodBasis',case when pooled then 'PERSONAL_POOL_V1' else 'INVOICE_NET_V1' end
 ) order by id),'[]')
 from dates
$$;
revoke all on function private.personal_invoice_assessment_positions(uuid,uuid,date,jsonb) from public,anon;
grant execute on function private.personal_invoice_assessment_positions(uuid,uuid,date,jsonb) to authenticated;

-- Scope the continuity validation to accounts with evidence by the assessment cutoff.
create or replace function private.personal_hawl_continuity(p_cycle uuid, p_method uuid, p_cutoff date)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  actor uuid:=auth.uid();
  cycle public.zakat_hawl_cycles%rowtype;
  base_currency text;
  calendar text;
  standard text;
  preference text;
  quote_grams numeric;
  effective_start date;
  due_date date;
  original_due date;
  invoice_from date;
  closing record;
  current_day date;
  movement_ids uuid[];
  quote_ids uuid[];
  opening_movements uuid[];
  opening_quotes uuid[];
  recovery_movements uuid[];
  recovery_quotes uuid[];
  evidence_hash text:='';
  qualifies boolean;
  unsupported_asset boolean;
  unreconciled_balance boolean;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  select c.* into cycle from public.zakat_hawl_cycles c where c.id=p_cycle and c.user_id=actor and c.status in ('ACTIVE','OPEN');
  if not found or cycle.cycle_no<>1
    or cycle.snapshot->>'personal_start_policy' is distinct from 'FIRST_NISAB_V1'
    or cycle.snapshot->'nisabEvidence'->>'status' is distinct from 'PROVEN'
  then return null; end if;
  select s.hawl_nisab_policy into preference from public.user_settings s where s.user_id=actor;
  if coalesce(preference,'CONTINUOUS')<>'CONTINUOUS' then
    if cycle.snapshot->'activeHawlContinuity'->>'effectiveStart'<>cycle.hawl_start_date::text then
      raise exception 'HAWL_CONTINUITY_POLICY_CHANGED_REVIEW';
    end if;
    return null;
  end if;
  select m.calendar_type into strict calendar from public.zakat_methods m where m.id=p_method;
  select p.base_currency into strict base_currency from public.profiles p where p.id=actor;
  standard:=cycle.nisab_standard;
  quote_grams:=case standard when 'GOLD' then 85 when 'SILVER' then 595 end;
  if quote_grams is null or p_cutoff is null or p_cutoff<cycle.hawl_start_date then
    raise exception 'HAWL_CONTINUITY_EVIDENCE_REQUIRED';
  end if;
  if p_cutoff>cycle.hawl_start_date+interval '3 years' then
    raise exception 'HAWL_CONTINUITY_OVERDUE_REVIEW';
  end if;

  select min(d.document_date) into invoice_from from public.personal_income_documents d
  join public.asset_accounts a on a.id=d.receivable_id and a.user_id=actor
    and a.organization_id is null and a.ownership_scope='PERSONAL' and a.is_zakatable
  where d.owner_id=actor and d.document_date<=p_cutoff;

  -- Later acquisitions must not affect an earlier assessment. Reconcile each
  -- relevant account against current inventory using its complete movement ledger.
  with relevant_accounts as materialized (
    select a.id,a.asset_type,a.unit,a.currency,a.metadata
    from public.asset_accounts a
    where a.user_id=actor and a.ownership_scope='PERSONAL' and a.organization_id is null and a.is_zakatable
      and (
        exists(select 1 from public.transactions t where t.asset_account_id=a.id and t.user_id=actor
          and t.organization_id is null and t.transaction_date<=p_cutoff)
        or exists(select 1 from public.lots l where l.asset_account_id=a.id and l.user_id=actor
          and l.organization_id is null and l.acquisition_date<=p_cutoff and l.remaining_quantity>0)
      )
  )
  select exists(
    select 1 from relevant_accounts a
    where (a.asset_type in ('GOLD','SILVER') and a.unit is distinct from 'g')
       or (a.asset_type not in ('GOLD','SILVER') and (a.asset_type not in ('CASH','BANK') or a.currency is distinct from base_currency)
         and not (a.asset_type='RECEIVABLE' and a.currency=base_currency and exists (
           select 1 from public.personal_income_documents d where d.owner_id=actor
            and d.receivable_id=a.id and d.document_date<=p_cutoff)))
       or (a.asset_type='GOLD' and coalesce((a.metadata->>'karat')::numeric,24) not between 1 and 24)
       or (a.asset_type='SILVER' and coalesce((a.metadata->>'purity')::numeric,(a.metadata->>'karat')::numeric,999) not between 0.00000001 and 1000)
  ), exists(
    select 1 from relevant_accounts a
    cross join lateral (
      select sum(case when t.transaction_type in ('PURCHASE','ADD','TRANSFER_IN','OPENING_BALANCE') then t.quantity else -t.quantity end) qty,
        bool_or(t.quantity<0 or t.transaction_type not in ('PURCHASE','ADD','TRANSFER_IN','OPENING_BALANCE','SALE','TRANSFER_OUT','WITHDRAWAL','ZAKAT_PAYMENT')) unsupported
      from public.transactions t where t.asset_account_id=a.id and t.user_id=actor and t.organization_id is null
    ) ledger
    cross join lateral (
      select sum(l.remaining_quantity) qty from public.lots l
      where l.asset_account_id=a.id and l.user_id=actor and l.organization_id is null
    ) inventory
    where ledger.unsupported or coalesce(ledger.qty,0)<>coalesce(inventory.qty,0)
  ) into unsupported_asset,unreconciled_balance;

  if unsupported_asset then raise exception 'HAWL_CONTINUITY_UNSUPPORTED_ASSET'; end if;
  if unreconciled_balance then raise exception 'HAWL_CONTINUITY_UNRECONCILED_BALANCE'; end if;

  original_due:=public.zakat_next_hawl_date(cycle.hawl_start_date,calendar);
  effective_start:=cycle.hawl_start_date;
  due_date:=original_due;
  for closing in
    with movements as materialized (
      select t.id,t.transaction_date as day,
        case when a.asset_type in ('GOLD','SILVER') then a.asset_type::text else 'CASH' end kind,
        case when t.transaction_type in ('PURCHASE','ADD','TRANSFER_IN','OPENING_BALANCE') then t.quantity else -t.quantity end
        * case a.asset_type
            when 'GOLD' then coalesce((a.metadata->>'karat')::numeric,24)/24
            when 'SILVER' then case when coalesce((a.metadata->>'purity')::numeric,(a.metadata->>'karat')::numeric,999)>1
              then coalesce((a.metadata->>'purity')::numeric,(a.metadata->>'karat')::numeric,999)/1000
              else coalesce((a.metadata->>'purity')::numeric,(a.metadata->>'karat')::numeric,999) end
            else 1 end units
      from public.transactions t join public.asset_accounts a on a.id=t.asset_account_id and a.user_id=actor
      where t.user_id=actor and t.organization_id is null and t.transaction_date<=p_cutoff
        and a.ownership_scope='PERSONAL' and a.organization_id is null and a.is_zakatable
        and a.asset_type<>'RECEIVABLE'
    ), changes as (
      select greatest(day,cycle.hawl_start_date) as day,
        coalesce(sum(units) filter (where kind='GOLD'),0) gold,
        coalesce(sum(units) filter (where kind='SILVER'),0) silver,
        coalesce(sum(units) filter (where kind='CASH'),0) cash,
        array_agg(id order by id) movement_ids
      from movements group by greatest(day,cycle.hawl_start_date)
    ), balances as (
      select d.day::date as day,
        sum(coalesce(c.gold,0)) over(order by d.day) gold,
        sum(coalesce(c.silver,0)) over(order by d.day) silver,
        sum(coalesce(c.cash,0)) over(order by d.day) cash,c.movement_ids
      from generate_series(cycle.hawl_start_date::timestamp,p_cutoff::timestamp,'1 day') d(day)
      left join changes c on c.day=d.day::date
    ), invoice_days as (
      select greatest(invoice_from,cycle.hawl_start_date) as day where invoice_from is not null
      union
      select day from changes where day>=invoice_from
      union
      select greatest(d.document_date,cycle.hawl_start_date)
      from public.personal_income_documents d where invoice_from is not null and d.owner_id=actor
      union
      select greatest(x.day,cycle.hawl_start_date)
      from public.personal_invoice_hawl_events t
      join public.personal_income_documents d on d.id=t.document_id and d.owner_id=actor
      cross join lateral (values (t.effective_date),(t.due_date)) x(day)
      where invoice_from is not null and t.effective_date<=p_cutoff
    ), invoice_closings as materialized (
      select i.day,coalesce(sum((r->>'netBase')::numeric
        -case when r->>'kind'='RECEIPT_CASH' then (r->>'grossBase')::numeric else 0 end) filter(where a.is_zakatable and a.organization_id is null),0) change_base
      from invoice_days i
      left join lateral jsonb_array_elements(public.personal_invoice_hawl_positions_at_cutoff(i.day)) r on true
      left join public.lots l on l.id=(r->>'lotId')::uuid and l.user_id=actor
      left join public.asset_accounts a on a.id=l.asset_account_id and a.user_id=actor
      where i.day<=p_cutoff
      group by i.day
    ), corrected as (
      select b.day,b.gold,b.silver,b.cash+coalesce(v.change_base,0) cash,b.movement_ids
      from balances b
      left join lateral (select i.change_base from invoice_closings i where i.day<=b.day order by i.day desc limit 1) v on true
    )
    select b.*,g.minimum gold_price,g.minimum=g.maximum gold_agrees,g.ids gold_ids,
        s.minimum silver_price,s.minimum=s.maximum silver_agrees,s.ids silver_ids
    from corrected b
    left join lateral (
      select min(p.price_per_unit) minimum,max(p.price_per_unit) maximum,array_agg(p.id order by p.id) ids
      from public.market_prices p where p.valuation_date=b.day and p.asset_type='GOLD' and p.currency=base_currency
        and (p.instrument_code is null or p.instrument_code='XAU') and (p.karat is null or p.karat=24) and nullif(p.source,'') is not null
    ) g on b.cash<>0 or (standard='GOLD' and b.silver<>0) or (standard='SILVER' and b.gold<>0)
      or (standard='GOLD' and (b.day=cycle.hawl_start_date or b.movement_ids is not null))
    left join lateral (
      select min(p.price_per_unit) minimum,max(p.price_per_unit) maximum,array_agg(p.id order by p.id) ids
      from public.market_prices p where p.valuation_date=b.day and p.asset_type='SILVER' and p.currency=base_currency
        and (p.instrument_code is null or p.instrument_code='XAG') and (p.karat is null or p.karat=999) and nullif(p.source,'') is not null
    ) s on b.cash<>0 or (standard='GOLD' and b.silver<>0) or (standard='SILVER' and b.gold<>0)
      or (standard='SILVER' and (b.day=cycle.hawl_start_date or b.movement_ids is not null))
    order by b.day
  loop
    current_day:=closing.day;
    if effective_start is not null and current_day>due_date then
      raise exception 'HAWL_CONTINUITY_OVERDUE_REVIEW';
    end if;
    if least(closing.gold,closing.silver,closing.cash)<0 then
      raise exception 'HAWL_CONTINUITY_UNRECONCILED_BALANCE';
    end if;
    movement_ids:=coalesce(closing.movement_ids,array[]::uuid[]);
    quote_ids:=array[]::uuid[];
    if closing.cash=0 and (case standard when 'GOLD' then closing.silver else closing.gold end)=0 then
      -- A single holding in the standard metal can be compared in pure grams.
      qualifies:=(case standard when 'GOLD' then closing.gold else closing.silver end)>=quote_grams;
      quote_ids:=case when standard='GOLD' and closing.gold_agrees and closing.gold_price>0 then closing.gold_ids
        when standard='SILVER' and closing.silver_agrees and closing.silver_price>0 then closing.silver_ids else quote_ids end;
    else
      if ((standard='GOLD' or closing.gold<>0) and (coalesce(closing.gold_price,0)<=0 or not coalesce(closing.gold_agrees,false)))
        or ((standard='SILVER' or closing.silver<>0) and (coalesce(closing.silver_price,0)<=0 or not coalesce(closing.silver_agrees,false)))
      then raise exception 'HAWL_CONTINUITY_DATED_PRICE_REQUIRED' using detail=current_day::text; end if;
      quote_ids:=coalesce(closing.gold_ids,array[]::uuid[])||coalesce(closing.silver_ids,array[]::uuid[]);
      qualifies:=closing.cash+closing.gold*coalesce(closing.gold_price,0)+closing.silver*coalesce(closing.silver_price,0)
        >=quote_grams*(case standard when 'GOLD' then closing.gold_price else closing.silver_price end);
    end if;
    if current_day=cycle.hawl_start_date then
      if not qualifies then raise exception 'HAWL_CONTINUITY_OPENING_EVIDENCE_CHANGED'; end if;
      opening_movements:=movement_ids;
      opening_quotes:=quote_ids;
    end if;
    if not qualifies then
      effective_start:=null;
    elsif effective_start is null then
      effective_start:=current_day;
      due_date:=public.zakat_next_hawl_date(effective_start,calendar);
      recovery_movements:=movement_ids;
      recovery_quotes:=quote_ids;
    end if;
    evidence_hash:=md5(evidence_hash||jsonb_build_array(current_day,closing.gold,closing.silver,closing.cash,
      closing.gold_price,closing.silver_price,movement_ids,quote_ids,qualifies)::text);
  end loop;
  if effective_start is null then raise exception 'HAWL_CONTINUITY_AWAITING_REATTAINMENT'; end if;
  return jsonb_build_object('version','DAILY_CLOSE_CONTINUITY_V1','effectiveStart',effective_start,'effectiveDue',due_date,
    'originalStart',cycle.hawl_start_date,'originalDue',original_due,'cutoff',p_cutoff,'standard',standard,
    'openingMovementIds',opening_movements,'openingQuoteIds',opening_quotes,
    'recoveryMovementIds',coalesce(recovery_movements,array[]::uuid[]),'recoveryQuoteIds',coalesce(recovery_quotes,array[]::uuid[]),
    'evidenceHash',evidence_hash);
end
$$;

create or replace function public.personal_zakat_assessment_context(p_cycle uuid, p_method uuid, p_cutoff date)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare continuity jsonb;
begin
  continuity:=private.personal_hawl_continuity(p_cycle,p_method,p_cutoff);
  return jsonb_build_object('continuity',continuity,'invoicePositions',
    private.personal_invoice_assessment_positions(p_cycle,p_method,p_cutoff,continuity),'periods',(
    select coalesce(jsonb_agg(to_jsonb(p) order by p.lot_id),'[]')
    from private.personal_hawl_periods_at_cutoff(p_cycle,p_method,continuity) p
  ));
end
$$;

create or replace function public.save_zakat_assessment_snapshot(p_assessment jsonb,p_lines jsonb,p_revision_of uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 uid uuid:=auth.uid(); a public.zakat_assessments%rowtype; c public.zakat_hawl_cycles%rowtype;
 coverage record; expected_eligible numeric; m public.zakat_methods%rowtype; period record;prev uuid; item jsonb; lot public.lots%rowtype;
 component_total numeric; component_due numeric; first_due date;
 continuity jsonb;invoice_positions jsonb;invoice_position jsonb;
 portfolio_market numeric:=0;eligible numeric:=0; due numeric:=0; price numeric; fx numeric; purity numeric; basis numeric; expected_nisab numeric; base_currency text;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 if (p_assessment->>'assessment_date')::date>(now() at time zone 'Asia/Riyadh')::date then raise exception 'ASSESSMENT_DATE_IN_FUTURE';end if;
 if jsonb_typeof(p_lines)<>'array' or coalesce((p_assessment->'calculation_snapshot'->>'schemaVersion')::integer,0)<>2
  or jsonb_array_length(p_lines) is distinct from (p_assessment->'calculation_snapshot'->>'candidateLots')::integer then raise exception 'ASSESSMENT_PAYLOAD_INVALID';end if;
 select * into m from public.zakat_methods where id=(p_assessment->>'method_id')::uuid;
 select profiles.base_currency into base_currency from public.profiles where id=uid;
 if m.id is null or m.zakat_rate is distinct from (p_assessment->>'zakat_rate')::numeric or base_currency is distinct from p_assessment->>'currency' then raise exception 'ASSESSMENT_METHOD_MISMATCH';end if;
 if p_assessment->>'hawl_cycle_id' is not null then
  select * into c from public.zakat_hawl_cycles where id=(p_assessment->>'hawl_cycle_id')::uuid and user_id=uid for update;
  if c.id is null or c.status not in ('OPEN','ACTIVE') then raise exception 'CLOSED_CYCLE_ASSESSMENT_LOCKED';end if;
  if (p_assessment->>'assessment_date')::date<c.hawl_start_date then raise exception 'ASSESSMENT_BEFORE_CYCLE_START';end if;
  prev:=c.assessment_id;
 end if;
 continuity:=private.personal_hawl_continuity(c.id,m.id,(p_assessment->>'assessment_date')::date);
 if continuity is not null and p_assessment->>'nisab_standard' is distinct from continuity->>'standard' then
  raise exception 'HAWL_CONTINUITY_NISAB_STANDARD_CHANGED';
 end if;
 if (p_assessment->'calculation_snapshot'->'hawlContinuity') is distinct from continuity
  then raise exception 'HAWL_CONTINUITY_RECALCULATION_REQUIRED';end if;
 invoice_positions:=private.personal_invoice_assessment_positions(c.id,m.id,(p_assessment->>'assessment_date')::date,continuity);
 if jsonb_array_length(invoice_positions)>0 then
  if p_assessment->'calculation_snapshot'->'invoiceHawlEvidence' is distinct from invoice_positions then
   raise exception 'HAWL_CONTINUITY_INVOICE_RECALCULATION_REQUIRED';
  end if;
  if exists(select 1 from jsonb_array_elements(invoice_positions) p
    where (p->>'netBase')::numeric>0
     and not exists(select 1 from jsonb_array_elements(p_lines) x where x->>'lot_id'=p->>'lotId')) then
   raise exception 'HAWL_CONTINUITY_INVOICE_RECALCULATION_REQUIRED';
  end if;
 elsif p_assessment->'calculation_snapshot'->'invoiceHawlEvidence' is not null then
  raise exception 'HAWL_CONTINUITY_INVOICE_RECALCULATION_REQUIRED';
 end if;
 if c.id is not null and m.code='UNIFIED_HAWL'
  and p_assessment->'calculation_snapshot'->>'personalHawlPeriodPolicy' is distinct from 'PERSONAL_POOL_V1'
 then raise exception 'POOLED_HAWL_RECALCULATION_REQUIRED';end if;
 if (c.id is null or m.code<>'UNIFIED_HAWL')
  and p_assessment->'calculation_snapshot'->>'personalHawlPeriodPolicy' is not null
 then raise exception 'ASSESSMENT_HAWL_PERIOD_MISMATCH';end if;
 if p_revision_of is not null and (prev is distinct from p_revision_of or not exists(select 1 from public.zakat_assessments where id=p_revision_of and user_id=uid and hawl_cycle_id=c.id and superseded_by is null)) then raise exception 'ASSESSMENT_SUPERSEDED';end if;
 expected_nisab:=(case when p_assessment->>'nisab_standard'='GOLD' then 85 else 595 end)
  *(p_assessment->'calculation_snapshot'->'metalPrices'->(p_assessment->>'nisab_standard')->>'price')::numeric
  *(p_assessment->'calculation_snapshot'->'metalPrices'->(p_assessment->>'nisab_standard')->>'fxRate')::numeric;
 if expected_nisab is null or expected_nisab<=0 or abs(expected_nisab-(p_assessment->>'nisab_value_base')::numeric)>0.00000001 then raise exception 'ASSESSMENT_NISAB_MISMATCH';end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x group by x->>'lot_id' having count(*)>1) then raise exception 'ASSESSMENT_DUPLICATE_LOT';end if;
 for item in select value from jsonb_array_elements(p_lines) loop
  select * into lot from public.lots where id=(item->>'lot_id')::uuid and user_id=uid for share;
  if lot.id is null or lot.remaining_quantity is distinct from (item->>'quantity')::numeric then raise exception 'ASSESSMENT_BALANCE_CHANGED';end if;
  select value into invoice_position from jsonb_array_elements(invoice_positions) where value->>'lotId'=lot.id::text;
  if invoice_position is not null then
   expected_eligible:=case when (invoice_position->>'hawlDueDate')::date<=(p_assessment->>'assessment_date')::date
      then (invoice_position->>'netBase')::numeric else 0 end;
   if (invoice_position->>'netBase')::numeric<=0
     or lot.remaining_value_base is distinct from (invoice_position->>'grossBase')::numeric
     or (item->>'market_value')::numeric is distinct from (invoice_position->>'netBase')::numeric
     or (item->>'eligible_value')::numeric is distinct from expected_eligible
     or item->'valuation_snapshot'->'invoiceHawlPosition' is distinct from invoice_position
     or item->'valuation_snapshot'->>'hawlStartDate' is distinct from invoice_position->>'hawlStartDate'
     or item->'valuation_snapshot'->>'hawlDueDate' is distinct from invoice_position->>'hawlDueDate'
     or item->'valuation_snapshot'->>'hawlPeriod' is distinct from invoice_position->>'hawlPeriod'
     or item->'valuation_snapshot'->>'periodBasis' is distinct from invoice_position->>'periodBasis'
     or (expected_eligible=0 and item->>'eligibility_status' is distinct from 'HAWL_NOT_COMPLETED')
     or (expected_eligible>0 and coalesce(item->>'eligibility_status','') not in ('ELIGIBLE','BELOW_NISAB'))
     or (invoice_position->>'coveredThrough')::date>(p_assessment->>'assessment_date')::date
     or public.zakat_next_hawl_date((invoice_position->>'hawlDueDate')::date,m.calendar_type)
        <=(p_assessment->>'assessment_date')::date then
    raise exception 'HAWL_CONTINUITY_INVOICE_RECALCULATION_REQUIRED';
   end if;
  else
  select sum(cp.remaining_base),sum(case when cp.period_due<=(p_assessment->>'assessment_date')::date then cp.remaining_base else 0 end),min(cp.period_due)
    into component_total,component_due,first_due from public.gold_receipt_assessment_periods(lot.source_transaction_id,m.calendar_type) cp;
  if component_total is not null then
    if item->'valuation_snapshot'->>'periodBasis'='PERSONAL_POOL_V1'
      or component_total is distinct from lot.remaining_value_base or component_total is distinct from (item->>'market_value')::numeric
      or component_due is distinct from (item->>'eligible_value')::numeric
      or first_due is distinct from (item->'valuation_snapshot'->>'hawlDueDate')::date
      or (component_due=0 and item->>'eligibility_status' is distinct from 'HAWL_NOT_COMPLETED')
      or (component_due>0 and coalesce(item->>'eligibility_status','') not in ('ELIGIBLE','BELOW_NISAB'))
    then raise exception 'GOLD_RECEIPT_COMPONENT_BASIS_MISMATCH';end if;
  else
  select * into period from private.personal_hawl_periods_at_cutoff(c.id,m.id,continuity) hp where hp.lot_id=lot.id;
  if period.lot_id is null or coalesce(item->'valuation_snapshot'->>'periodBasis','LOT_PERIOD') is distinct from period.period_basis
   or (item->'valuation_snapshot'->>'hawlStartDate')::date is distinct from period.hawl_start_date
   or (item->'valuation_snapshot'->>'hawlDueDate')::date is distinct from period.hawl_due_date
   or (item->'valuation_snapshot'->>'hawlPeriod')::integer is distinct from period.hawl_period then raise exception 'ASSESSMENT_HAWL_PERIOD_MISMATCH';end if;
  if period.covered_through>(p_assessment->>'assessment_date')::date then raise exception 'ASSESSMENT_BEFORE_FINAL_COVERAGE';end if;
  if period.hawl_due_date>(p_assessment->>'assessment_date')::date and item->>'eligibility_status'<>'HAWL_NOT_COMPLETED' then raise exception 'ASSESSMENT_HAWL_NOT_COMPLETED';end if;
  if period.hawl_due_date<=(p_assessment->>'assessment_date')::date and item->>'eligibility_status'='HAWL_NOT_COMPLETED' then raise exception 'ASSESSMENT_HAWL_STATUS_MISMATCH';end if;
  if public.zakat_next_hawl_date(period.hawl_due_date,m.calendar_type)<=(p_assessment->>'assessment_date')::date then raise exception 'MULTIPLE_UNASSESSED_HAWLS_REQUIRE_REVIEW';end if;
  end if;
  if component_total is null and period.period_basis='PERSONAL_POOL_V1' then
   expected_eligible:=case when period.hawl_due_date<=(p_assessment->>'assessment_date')::date then (item->>'market_value')::numeric else 0 end;
   if (item->>'eligible_value')::numeric is distinct from expected_eligible then
    raise exception 'POOLED_HAWL_LINE_BASIS_MISMATCH';
   end if;
  end if;
  end if;
  price:=(item->>'valuation_price')::numeric;fx:=(item->>'fx_rate')::numeric;purity:=(item->'valuation_snapshot'->>'purity')::numeric;
  basis:=(item->>'quantity')::numeric*price*fx*purity;
  if price is null or price<0 or fx is null or fx<=0 or purity is null or purity<=0 or purity>1 or abs(basis-(item->>'market_value')::numeric)>0.00000001 then raise exception 'ASSESSMENT_VALUATION_MISMATCH';end if;
  if (item->>'zakat_amount')::numeric<0 or (item->>'eligible_value')::numeric<0 or (item->>'eligible_value')::numeric>(item->>'market_value')::numeric then raise exception 'ASSESSMENT_LINE_INVALID';end if;
  if abs((item->>'zakat_amount')::numeric-(case when item->>'eligibility_status'='ELIGIBLE' then (item->>'eligible_value')::numeric*m.zakat_rate else 0 end))>0.00000001 then raise exception 'ASSESSMENT_RATE_MISMATCH';end if;
  select * into coverage from public.investment_zakat_lot_coverage(m.calendar_type) cv where cv.lot_id=lot.id;
  if coalesce((item->'valuation_snapshot'->'institutionCoverage'->>'coveredDays')::integer,0) is distinct from coalesce(coverage.covered_days,0)
   or (coverage.covered_days>0 and ((item->'valuation_snapshot'->'institutionCoverage'->>'periodDays')::integer is distinct from coverage.period_days
    or item->'valuation_snapshot'->'institutionCoverage'->'intervals' is distinct from coverage.coverage_intervals)) then raise exception 'ASSESSMENT_EXTERNAL_COVERAGE_MISMATCH';end if;
  if coverage.covered_days>0 then
   expected_eligible:=case when period.hawl_due_date<=(p_assessment->>'assessment_date')::date then (item->>'market_value')::numeric*(coverage.period_days-coverage.covered_days)/coverage.period_days else 0 end;
   if abs(expected_eligible-(item->>'eligible_value')::numeric)>0.00000001 then raise exception 'ASSESSMENT_EXTERNAL_COVERAGE_BASIS_MISMATCH';end if;
  end if;
  portfolio_market:=portfolio_market+(item->>'market_value')::numeric;
  eligible:=eligible+(item->>'eligible_value')::numeric;due:=due+(item->>'zakat_amount')::numeric;
 end loop;
 if jsonb_array_length(invoice_positions)>0 and
   exists(select 1 from jsonb_array_elements(p_lines) x
     where (x->>'eligible_value')::numeric>0
      and x->>'eligibility_status' is distinct from
       (case when portfolio_market>=expected_nisab then 'ELIGIBLE' else 'BELOW_NISAB' end)) then
  raise exception 'ASSESSMENT_NISAB_POOL_MISMATCH';
 end if;
 if p_assessment->'calculation_snapshot'->>'nisabQualificationBasis'='PORTFOLIO_MARKET_VALUE' then
  if portfolio_market is distinct from (p_assessment->'calculation_snapshot'->>'nisabQualificationValue')::numeric then raise exception 'ASSESSMENT_NISAB_POOL_MISMATCH';end if;
  if portfolio_market<expected_nisab then eligible:=0;end if;
 else
  if eligible<expected_nisab then eligible:=0;end if;
 end if;
 if abs(eligible-(p_assessment->>'total_zakatable_value')::numeric)>0.00000001 or abs(due-(p_assessment->>'zakat_due')::numeric)>0.00000001 or abs(due-eligible*m.zakat_rate)>0.00000001 then raise exception 'ASSESSMENT_TOTAL_MISMATCH';end if;
 if c.id is not null and m.code='UNIFIED_HAWL' then
  p_assessment:=jsonb_set(p_assessment,'{calculation_snapshot,personalHawlWitness}',
   to_jsonb(private.personal_pooled_hawl_witness(c.id,m.id,(p_assessment->>'assessment_date')::date)));
 end if;
 insert into public.zakat_assessments(user_id,assessment_date,valuation_date,method_id,nisab_standard,nisab_quantity,nisab_value_base,total_zakatable_value,zakat_rate,zakat_due,currency,status,method_version,calculation_snapshot,hawl_cycle_id,cycle_number,assessment_kind)
 values(uid,(p_assessment->>'assessment_date')::date,(p_assessment->>'valuation_date')::date,m.id,p_assessment->>'nisab_standard',(p_assessment->>'nisab_quantity')::numeric,expected_nisab,eligible,m.zakat_rate,due,base_currency,'CALCULATED',m.version,p_assessment->'calculation_snapshot',c.id,coalesce(c.cycle_no,1),'RECALCULATION') returning * into a;
 for item in select value from jsonb_array_elements(p_lines) loop
  insert into public.zakat_assessment_lines(assessment_id,lot_id,quantity,valuation_price,valuation_currency,fx_rate,valuation_snapshot,market_value,eligible_value,zakat_amount,eligibility_status,reason_code,explanation)
  values(a.id,(item->>'lot_id')::uuid,(item->>'quantity')::numeric,(item->>'valuation_price')::numeric,item->>'valuation_currency',(item->>'fx_rate')::numeric,item->'valuation_snapshot',(item->>'market_value')::numeric,(item->>'eligible_value')::numeric,(item->>'zakat_amount')::numeric,(item->>'eligibility_status')::public.eligibility_status,item->>'reason_code',item->>'explanation');
 end loop;
 if prev is not null then update public.zakat_assessments set superseded_by=a.id where id=prev and user_id=uid;end if;
 if c.id is not null then
  update public.zakat_hawl_cycles set assessment_id=a.id,valuation_date=a.valuation_date,nisab_value_base=a.nisab_value_base,
   hawl_due_date=greatest(c.hawl_due_date,(continuity->>'effectiveDue')::date),
   price_mode=a.calculation_snapshot->>'priceMode',price_source=a.calculation_snapshot->>'priceSource',
   gold_price=(a.calculation_snapshot->'prices'->>'gold')::numeric,silver_price=(a.calculation_snapshot->'prices'->>'silver')::numeric,
   snapshot=coalesce(snapshot,'{}'::jsonb)||jsonb_build_object('latestAssessmentId',a.id,'latestAssessmentDate',a.assessment_date,'calendarType',a.calculation_snapshot->>'calendarType','latestValuation',a.calculation_snapshot)
     ||case when (continuity->>'effectiveDue')::date>=c.hawl_due_date then jsonb_build_object('activeHawlContinuity',continuity) else '{}'::jsonb end
  where id=c.id and user_id=uid;
 end if;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(uid,'zakat_assessment',a.id,'CREATE_IMMUTABLE_SNAPSHOT',jsonb_build_object('assessment',to_jsonb(a),'previous_assessment_id',prev));
 return to_jsonb(a);
end $$;


create or replace function public.close_zakat_cycle(p_cycle_id uuid,p_final_assessment_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();c public.zakat_hawl_cycles%rowtype;a public.zakat_assessments%rowtype;continuity jsonb;effective_due date;invoice_positions jsonb;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 select * into c from public.zakat_hawl_cycles where id=p_cycle_id and user_id=uid for update;
 if c.id is null or c.status not in ('OPEN','ACTIVE') or c.final_assessment_id is not null then raise exception 'ACTIVE_CYCLE_NOT_FOUND';end if;
 select * into a from public.zakat_assessments where id=p_final_assessment_id and user_id=uid and hawl_cycle_id=c.id;
 if a.id is null or a.status::text in ('DRAFT','CANCELLED') or a.superseded_by is not null or c.assessment_id is distinct from a.id then raise exception 'FINAL_ASSESSMENT_NOT_IN_CYCLE';end if;
 if c.final_zakat_due is not null and c.final_zakat_due is distinct from a.zakat_due then raise exception 'RECORDED_FINAL_BASIS_REQUIRES_REVIEW';end if;
 continuity:=private.personal_hawl_continuity(c.id,a.method_id,a.assessment_date);
 if a.calculation_snapshot->'hawlContinuity' is distinct from continuity then
  raise exception 'HAWL_CONTINUITY_RECALCULATION_REQUIRED';end if;
 invoice_positions:=private.personal_invoice_assessment_positions(c.id,a.method_id,a.assessment_date,continuity);
 if (a.calculation_snapshot->'invoiceHawlEvidence') is distinct from
    (case when jsonb_array_length(invoice_positions)>0 then invoice_positions end) then
  raise exception 'HAWL_CONTINUITY_INVOICE_RECALCULATION_REQUIRED';
 end if;
 if exists(select 1 from jsonb_array_elements(invoice_positions) p
   where (p->>'netBase')::numeric>0
    and not exists(select 1 from public.lots l
      join public.zakat_assessment_lines al on al.lot_id=l.id and al.assessment_id=a.id
      where l.id=(p->>'lotId')::uuid and l.user_id=uid
       and l.remaining_quantity=al.quantity and l.remaining_value_base=(p->>'grossBase')::numeric
       and al.valuation_snapshot->'invoiceHawlPosition'=p)) then
  raise exception 'HAWL_CONTINUITY_INVOICE_RECALCULATION_REQUIRED';
 end if;
 effective_due:=greatest(c.hawl_due_date,(continuity->>'effectiveDue')::date);
 if a.assessment_date<effective_due or (now() at time zone 'Asia/Riyadh')::date<effective_due then raise exception 'CYCLE_HAWL_NOT_COMPLETED';end if;
 if a.calculation_snapshot->>'hawlPeriodPolicy' is distinct from 'FINAL_COVERAGE_V1' then raise exception 'FINAL_ASSESSMENT_RECALCULATION_REQUIRED';end if;
 if exists(select 1 from public.zakat_methods m where m.id=a.method_id and m.code='UNIFIED_HAWL') then
  if a.calculation_snapshot->>'personalHawlPeriodPolicy' is distinct from 'PERSONAL_POOL_V1'
   or a.calculation_snapshot->>'personalHawlWitness' is distinct from
    private.personal_pooled_hawl_witness(c.id,a.method_id,a.assessment_date)
   then raise exception 'POOLED_HAWL_RECALCULATION_REQUIRED';end if;
  if exists(
   select 1
   from public.zakat_assessment_lines al
   left join private.personal_hawl_periods_at_cutoff(c.id,a.method_id,continuity) hp on hp.lot_id=al.lot_id
   left join public.lots l on l.id=al.lot_id and l.user_id=uid
   where al.assessment_id=a.id and (
    l.remaining_quantity is distinct from al.quantity
    or (al.valuation_snapshot->'invoiceHawlPosition' is null
     and (al.valuation_snapshot->>'periodBasis'='PERSONAL_POOL_V1' or hp.period_basis='PERSONAL_POOL_V1')
     and not (al.valuation_snapshot->>'receiptComponentPolicy' is not null
      and al.valuation_snapshot->>'periodBasis' is distinct from 'PERSONAL_POOL_V1')
     and (hp.period_basis is distinct from al.valuation_snapshot->>'periodBasis'
      or hp.hawl_start_date is distinct from (al.valuation_snapshot->>'hawlStartDate')::date
      or hp.hawl_due_date is distinct from (al.valuation_snapshot->>'hawlDueDate')::date
      or hp.hawl_period is distinct from (al.valuation_snapshot->>'hawlPeriod')::integer))
   )
  ) then raise exception 'POOLED_HAWL_RECALCULATION_REQUIRED';end if;
 end if;
 update public.zakat_assessments set assessment_kind='FINAL' where id=a.id and user_id=uid;
 update public.zakat_hawl_cycles set status='CLOSED',final_assessment_id=a.id,final_zakat_due=a.zakat_due,closed_at=now(),assessment_id=a.id,snapshot=coalesce(snapshot,'{}')||jsonb_build_object('finalValuation',a.calculation_snapshot) where id=c.id and user_id=uid;
 perform public.reconcile_final_zakat_payments();
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(uid,'zakat_hawl_cycle',c.id,'FINALIZE_AND_APPLY_CARRIED_CREDIT',jsonb_build_object('final_assessment_id',a.id,'final_zakat_due',a.zakat_due));
 return c.id;
end $$;
