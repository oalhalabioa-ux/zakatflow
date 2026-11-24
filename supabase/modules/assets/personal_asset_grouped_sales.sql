-- Read one asset's share of grouped sales. Snapshot fields are written by the
-- posting transaction; later changes to the lots cannot alter the receipt.
create function public.personal_asset_grouped_sales(p_asset_id uuid,p_until date,p_limit integer default 50)
returns table(sale_id uuid,sale_date date,receipt_id uuid,method text,quantity numeric,
  unit_price numeric,currency text,proceeds numeric,cost_base numeric,gain_base numeric,allocations jsonb)
language sql stable security invoker set search_path='' as $$
  select sale.id,sale.transaction_date,receipt.id,sale.metadata#>>'{lot_selection,method}',
    sum(a.quantity),sale.unit_price,sale.currency,sum(a.quantity)*sale.unit_price,
    sum(a.value_base),sum(a.quantity)*sale.unit_price-sum(a.value_base),
    jsonb_agg(jsonb_build_object('lot_id',lot.id,'quantity',a.quantity,'cost_base',a.value_base,
      'quantity_after',snap.item->'quantity_after','cost_after',snap.item->'cost_after')
      order by lot.acquisition_date,lot.created_at,lot.id)
  from public.asset_accounts asset
  join public.lots lot on lot.asset_account_id=asset.id and lot.user_id=asset.user_id
  join public.transaction_allocations a on a.lot_id=lot.id and a.user_id=asset.user_id
  join public.transactions sale on sale.id=a.transaction_id and sale.user_id=asset.user_id
  join public.transactions receipt on receipt.id::text=sale.metadata#>>'{lot_sale_result,proceeds_transaction_id}'
    and receipt.user_id=sale.user_id and receipt.transfer_id=sale.transfer_id
    and receipt.metadata->>'sale_transaction_id'=sale.id::text
  join lateral jsonb_array_elements(sale.metadata#>'{lot_selection,allocations}') snap(item)
    on snap.item->>'lot_id'=lot.id::text
  where asset.id=p_asset_id and asset.user_id=auth.uid() and asset.ownership_scope='PERSONAL'
    and asset.organization_id is null and sale.organization_id is null and sale.transaction_type='SALE'
    and sale.currency=sale.base_currency and sale.metadata ? 'lot_sale_request'
    and sale.transaction_date<=p_until
  group by sale.id,receipt.id order by sale.transaction_date desc,sale.created_at desc,sale.id desc
  limit greatest(0,least(coalesce(p_limit,50),200))
$$;
revoke all on function public.personal_asset_grouped_sales(uuid,date,integer) from public,anon;
grant execute on function public.personal_asset_grouped_sales(uuid,date,integer) to authenticated;
