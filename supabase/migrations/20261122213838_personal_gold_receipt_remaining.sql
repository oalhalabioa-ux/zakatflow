-- Residual cash in the original receipt only. Source order is the immutable
-- acquisition order recorded at posting, including the lot ID tie breaker.
create function public.personal_gold_receipt_remaining(p_receipt_id uuid)
returns table(source_lot_id uuid, source_order integer, remaining numeric,
 remaining_base numeric, currency text, base_currency text, inherited_hawl_start_date date)
language sql stable security invoker set search_path='' as $$
 with components as (
   select s.*,sum(s.proceeds) over(order by s.source_order) as boundary,
     sum(s.proceeds_base) over(order by s.source_order) as base_boundary
   from public.personal_gold_receipt_hawl_sources(p_receipt_id) s
 ), balances as (
   select l.*,count(*) over() as lot_count from public.lots l
   where l.user_id=(select auth.uid()) and l.source_transaction_id=p_receipt_id
 )
 select c.source_lot_id,c.source_order,
   least(c.proceeds,greatest(0,c.boundary-(b.original_quantity-b.remaining_quantity))),
   least(c.proceeds_base,greatest(0,c.base_boundary-(b.original_value_base-b.remaining_value_base))),
   c.currency,c.base_currency,c.inherited_hawl_start_date
 from components c cross join balances b
 where b.lot_count=1 and b.remaining_quantity between 0 and b.original_quantity
   and b.remaining_value_base between 0 and b.original_value_base
   and (not c.reversed or (b.remaining_quantity=0 and b.remaining_value_base=0))
 order by c.source_order;
$$;
revoke all on function public.personal_gold_receipt_remaining(uuid) from public, anon, authenticated, service_role;
grant execute on function public.personal_gold_receipt_remaining(uuid) to authenticated;
