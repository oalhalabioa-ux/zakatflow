create or replace function public.sync_asset_purchase_recognition()
returns trigger language plpgsql security invoker set search_path=public as $$
declare t public.transactions%rowtype;l record;f record;
begin
 if new.source_module not in('ASSETS_INTEGRATION','ASSET_LIFECYCLE') or old.status=new.status then return new;end if;
 if new.source_module='ASSETS_INTEGRATION' then
  select * into t from public.transactions where id=new.source_record_id and organization_id=new.organization_id for update;
  if t.id is null then raise exception 'ASSET_TRANSACTION_SCOPE_MISMATCH';end if;
  for l in select * from public.lots where source_transaction_id=t.id for update loop
   if new.status='ACTUAL' then update public.lots set metadata=metadata||jsonb_build_object('recognition_pending',false) where id=l.id;
   elsif new.status in('CANCELLED','REVERSED') then
    if new.status='REVERSED' and (l.remaining_quantity<>l.original_quantity or l.remaining_value_base<>l.original_value_base) then raise exception 'ASSET_PURCHASE_REVERSAL_HAS_STOCK_MOVEMENTS';end if;
    update public.lots set remaining_quantity=0,remaining_value_base=0,status='CLOSED',metadata=metadata||jsonb_build_object('recognition_pending',false,'recognition_cancelled',true) where id=l.id;
   end if;
  end loop;
  update public.transactions set metadata=metadata||jsonb_build_object('financial_core_status',new.status) where id=t.id;
 end if;
 if new.status in('CANCELLED','REVERSED') then
  for f in select lf.id,lf.settled_amount from public.liquidity_flows lf join public.financial_event_links link on link.target_record_id=lf.id and link.target_module='liquidity_flows' and link.link_type='CASH_FLOW' where link.event_id=new.id for update of lf loop
   if f.settled_amount>0 then raise exception 'ASSET_EVENT_HAS_CASH_SETTLEMENT';end if;
   delete from public.financial_event_links where event_id=new.id and link_type='CASH_FLOW' and target_record_id=f.id;
   delete from public.liquidity_flows where id=f.id;
  end loop;
 end if;
 return new;
end $$;
create trigger trg_asset_purchase_recognition after update of status on public.financial_events for each row execute function public.sync_asset_purchase_recognition();
revoke all on function public.sync_asset_purchase_recognition() from public,anon,authenticated;

