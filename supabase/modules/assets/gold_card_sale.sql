-- Candidate for isolated QA. One authorized entry point for group selection and posting.
create function public.gold_card_sale(p_asset uuid,p_date date,p_payload jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid:=auth.uid();
  asset public.asset_accounts%rowtype;
  candidates jsonb;
  banks jsonb;
  planned jsonb;
  posted jsonb;
  price numeric;
  qty numeric;
  method text;
  key uuid;
begin
  select a.* into strict asset from public.asset_accounts a join public.profiles p on p.id=a.user_id
    where a.id=p_asset and a.user_id=uid and a.ownership_scope='PERSONAL' and a.organization_id is null
    and a.asset_type='GOLD' and a.unit='g' and a.currency=p.base_currency and a.status='ACTIVE'
    and a.metadata->>'karat' in ('9','10','12','14','18','20','21','22','23','24');
  if p_date is null or p_date>(now() at time zone 'Asia/Riyadh')::date then raise exception 'INVALID_SALE_DATE'; end if;
  if p_payload ? 'expected' then
    key:=(p_payload->>'request')::uuid;
    posted:=public.post_personal_gold_lot_sale(key,(asset.metadata->>'karat')::int,
      (p_payload->>'bank')::uuid,p_date,(p_payload->>'quantity')::numeric,(p_payload->>'price')::numeric,
      p_payload->>'method',p_payload->'selection');
    -- On mismatch raising here unwinds the entire sale, linked receipt, lots and audit.
    if posted->'allocations' is distinct from p_payload->'expected' then raise exception 'SALE_PREVIEW_CHANGED'; end if;
    return posted;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'asset',a.name,'date',l.acquisition_date,
    'source',coalesce(v.document_number,t.reference,t.id::text),'remaining_quantity',l.remaining_quantity,
    'remaining_value_base',l.remaining_value_base,'asset_account_id',a.id) order by l.acquisition_date,l.created_at,l.id),'[]')
    into candidates from public.asset_accounts a join public.lots l on l.asset_account_id=a.id and l.user_id=uid
    join public.transactions t on t.id=l.source_transaction_id and t.user_id=uid
    left join public.voucher_numbers v on v.source_table='transactions' and v.source_id=t.id
    where a.user_id=uid and a.ownership_scope='PERSONAL' and a.organization_id is null and a.status='ACTIVE'
    and a.asset_type='GOLD' and a.currency=asset.currency and a.unit='g'
    and a.metadata->>'karat'=asset.metadata->>'karat' and l.acquisition_date<=p_date and l.remaining_quantity>0 and l.status<>'CLOSED';
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]') into banks
    from public.asset_accounts where user_id=uid and ownership_scope='PERSONAL' and organization_id is null
      and currency=asset.currency and status='ACTIVE' and asset_type in ('BANK','CASH');
  if p_payload is null then return jsonb_build_object('lots',candidates,'banks',banks,'currency',asset.currency,'karat',asset.metadata->>'karat'); end if;
  qty:=(p_payload->>'quantity')::numeric; price:=(p_payload->>'price')::numeric; method:=p_payload->>'method';
  if price is null or not(price>0 and price<1e16) then raise exception 'INVALID_SALE'; end if;
  select jsonb_agg(to_jsonb(plan)||jsonb_build_object('asset_account_id',source.item->'asset_account_id') order by source.position)
    into planned from public.plan_asset_sale_lots(candidates,qty,method,p_payload->'selection') plan
    join jsonb_array_elements(candidates) with ordinality source(item,position) on source.item->>'id'=plan.lot_id::text;
  return jsonb_build_object('allocations',planned,'gross',round(qty*price,8),
    'cost',(select sum((a->>'cost_base')::numeric) from jsonb_array_elements(planned) a));
end $$;
revoke all on function public.gold_card_sale(uuid,date,jsonb) from public,anon;
grant execute on function public.gold_card_sale(uuid,date,jsonb) to authenticated;
