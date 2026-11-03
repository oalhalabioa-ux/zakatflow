-- Reconstruct historical cost and accumulated depreciation from saved book effects.
-- Sale proceeds and current market/zakat valuations are never cost inputs.
create or replace function private.financial_opening_asset_book(p_org uuid,p_asset uuid,p_cutoff date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t record;gross numeric:=0;dep numeric:=0;qty numeric:=0;cost numeric;ratio numeric;known boolean:=false;base text;issue text;
begin
 select base_currency into base from public.organizations where id=p_org;
 for t in select x.* from public.transactions x where x.organization_id=p_org and x.asset_account_id=p_asset and x.transaction_date<=p_cutoff
   and x.transaction_type::text<>'REVERSAL'
   and not coalesce((x.metadata->>'recognition_pending')::boolean,false)
   and (not(x.metadata ? 'financial_event_id') or private.financial_opening_event_active(p_org,(x.metadata->>'financial_event_id')::uuid,p_cutoff))
   and not exists(select 1 from public.transactions r where r.organization_id=p_org and r.reversal_of_transaction_id=x.id and r.transaction_date<=p_cutoff)
   order by x.transaction_date,x.created_at,x.id loop
  known:=true;
  if t.base_currency<>base then issue:='SOURCE_CURRENCY_MISMATCH';exit;end if;
  if t.transaction_type::text in('OPENING_BALANCE','ADD','PURCHASE','TRANSFER_IN') then gross:=gross+t.base_value;qty:=qty+t.quantity;
  elsif t.transaction_type::text='ADJUSTMENT' and t.metadata->>'reason'='DEPRECIATION' then
   dep:=dep+coalesce(nullif(t.metadata->>'cost_basis_base','')::numeric,t.base_value);
  elsif t.transaction_type::text in('SALE','WITHDRAWAL','TRANSFER_OUT','ZAKAT_PAYMENT') or t.metadata->>'reason'='DISPOSAL_ZERO_VALUE' then
   select sum(value_base) into cost from public.transaction_allocations where transaction_id=t.id;
   cost:=coalesce(cost,nullif(t.metadata->>'cost_basis_base','')::numeric,nullif(t.metadata->>'disposed_cost_base','')::numeric);
   if cost is null then issue:='ASSET_COST_REVIEW_REQUIRED';exit;end if;
   if qty>0 and t.quantity>0 then ratio:=t.quantity/qty;
   elsif gross-dep>0 then ratio:=cost/(gross-dep);
   else issue:='ASSET_COST_REVIEW_REQUIRED';exit;end if;
   if ratio<0 or ratio>1 or abs(cost-(gross-dep)*ratio)>0.0001 then issue:='ASSET_COST_RECONCILIATION_REQUIRED';exit;end if;
   gross:=gross*(1-ratio);dep:=dep*(1-ratio);qty:=qty-t.quantity;
  elsif t.transaction_type::text='ADJUSTMENT' and t.metadata->>'adjustment_direction'='IN' then gross:=gross+t.base_value;qty:=qty+t.quantity;
  else issue:='ASSET_COST_REVIEW_REQUIRED';exit;
  end if;
  if gross<0 or dep<0 or dep>gross then issue:='ASSET_COST_RECONCILIATION_REQUIRED';exit;end if;
 end loop;
 return jsonb_build_object('known',known,'gross',round(gross,4)::numeric(24,4)::text,'depreciation',round(dep,4)::numeric(24,4)::text,'issue',issue);
end $$;
revoke all on function private.financial_opening_asset_book(uuid,uuid,date) from public,anon,authenticated;
