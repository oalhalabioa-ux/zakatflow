-- Internal posting primitive. The caller supplies locked, policy-eligible rows
-- read by the server in acquisition_date, created_at, id order.
create or replace function public.plan_asset_sale_lots(
  p_candidates jsonb, p_quantity numeric, p_method text default 'FIFO',
  p_selection jsonb default '[]'::jsonb
) returns table (
  lot_id uuid, allocated_quantity numeric, cost_base numeric,
  quantity_after numeric, cost_after numeric
) language plpgsql immutable security invoker set search_path = '' as $$
declare
  candidate record;
  requested numeric;
  used_count integer := 0;
  needed numeric := p_quantity;
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity <> round(p_quantity,8)
     or p_quantity::text in ('NaN','Infinity','-Infinity')
     or p_method is null or p_method not in ('FIFO','MANUAL')
     or jsonb_typeof(p_candidates) is distinct from 'array'
     or jsonb_typeof(p_selection) is distinct from 'array' then
    raise exception 'INVALID_SALE_SELECTION';
  end if;
  if (p_method = 'FIFO' and jsonb_array_length(p_selection) <> 0)
     or (p_method = 'MANUAL' and jsonb_array_length(p_selection) = 0) then
    raise exception 'INVALID_SALE_SELECTION';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_selection) s(id uuid, quantity numeric)
    group by s.id having count(*) <> 1 or s.id is null)
    or exists (select 1 from jsonb_to_recordset(p_candidates) c(id uuid)
    group by c.id having count(*) <> 1 or c.id is null) then
    raise exception 'INVALID_LOT_ID';
  end if;
  for candidate in
    select c.*, s.quantity as selected_quantity, s.id is not null as selected
    from jsonb_array_elements(p_candidates) with ordinality e(item, position)
    cross join lateral jsonb_to_record(e.item) c(id uuid, remaining_quantity numeric, remaining_value_base numeric)
    left join jsonb_to_recordset(p_selection) s(id uuid,quantity numeric) on s.id=c.id
    order by e.position
  loop
    if p_method = 'MANUAL' and not candidate.selected then continue; end if;
    if p_method = 'FIFO' and needed = 0 then exit; end if;
    requested := case when p_method = 'FIFO' then least(needed,candidate.remaining_quantity)
                      else candidate.selected_quantity end;
    if requested is null or requested <= 0 or requested <> round(requested,8)
       or requested::text in ('NaN','Infinity','-Infinity')
       or candidate.remaining_quantity is null or requested > candidate.remaining_quantity
       or requested > needed or candidate.remaining_value_base is null or candidate.remaining_value_base < 0 then
      raise exception 'INVALID_LOT_QUANTITY';
    end if;
    lot_id := candidate.id;
    allocated_quantity := requested;
    quantity_after := candidate.remaining_quantity-requested;
    cost_base := case when quantity_after=0 then candidate.remaining_value_base
      else round(candidate.remaining_value_base*requested/candidate.remaining_quantity,8) end;
    cost_after := candidate.remaining_value_base-cost_base;
    needed := needed-requested;
    used_count := used_count+1;
    return next;
  end loop;
  if needed <> 0 or (p_method='MANUAL' and used_count <> jsonb_array_length(p_selection)) then
    raise exception 'SALE_LOTS_UNAVAILABLE';
  end if;
end $$;
revoke all on function public.plan_asset_sale_lots(jsonb,numeric,text,jsonb) from public, anon, authenticated;
