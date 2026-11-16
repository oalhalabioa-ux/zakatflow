create or replace function private.bind_asset_vat_document(p_document_id uuid,p_transaction_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.vat_documents%rowtype;t public.transactions%rowtype;e public.financial_events%rowtype;uid uuid:=auth.uid();mapped uuid;vat numeric;fx numeric;binding_entity uuid;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 select * into d from public.vat_documents where id=p_document_id for update;
 if d.id is null or not public.has_organization_permission(d.organization_id,'assets.edit') or not public.has_organization_permission(d.organization_id,'vat.edit') then raise exception 'ASSET_VAT_ACCESS_DENIED';end if;
 select * into t from public.transactions where id=p_transaction_id and organization_id=d.organization_id for update;
 if t.id is null or d.document_kind<>'INVOICE' or (d.document_type='PURCHASE' and t.transaction_type<>'PURCHASE') or (d.document_type='SALES' and t.transaction_type<>'SALE') then raise exception 'ASSET_VAT_TRANSACTION_MISMATCH';end if;
 select * into e from public.financial_events where id=nullif(t.metadata->>'financial_event_id','')::uuid and organization_id=d.organization_id and source_module in('ASSETS_INTEGRATION','ASSET_LIFECYCLE') and status not in('CANCELLED','REVERSED');
 if e.id is null then raise exception 'ASSET_FINANCIAL_EVENT_REQUIRED';end if;
 fx:=coalesce((t.metadata->>'fx_rate')::numeric,1);vat:=coalesce((t.metadata->>'vat_amount')::numeric,0);
 if d.transaction_date is distinct from t.transaction_date or d.due_date is distinct from e.due_date or d.source_currency is distinct from t.currency or d.currency<>e.base_currency or d.exchange_rate is distinct from fx
  or round(d.net_amount,2)<>round(t.base_value,2) or round(d.source_net_amount,2)<>round(t.gross_value,2)
  or round(d.source_tax_amount,2)<>round(vat,2) or round(d.tax_amount,2)<>round(vat*fx,2)
  or round(d.gross_amount,2)<>round((t.gross_value+vat)*fx,2)
  or (d.document_type='PURCHASE' and d.recoverable_percent<>coalesce((t.metadata->>'recoverable_percent')::numeric,100)) then raise exception 'ASSET_VAT_MUST_MATCH_FROZEN_ACQUISITION';end if;
 if not exists(select 1 from public.vat_contacts where id=d.counterparty_contact_id and organization_id=d.organization_id and contact_type in(case when d.document_type='PURCHASE' then 'SUPPLIER' else 'CUSTOMER' end,'BOTH')) then raise exception 'ASSET_VAT_CONTACT_SCOPE_MISMATCH';end if;
 select counterparty_id into mapped from public.financial_vat_counterparty_map where organization_id=d.organization_id and vat_contact_id=d.counterparty_contact_id;
 if mapped is not null and mapped is distinct from e.counterparty_id then raise exception 'ASSET_VAT_COUNTERPARTY_MISMATCH';end if;
 if mapped is null then insert into public.financial_vat_counterparty_map(organization_id,vat_contact_id,counterparty_id,created_by) values(d.organization_id,d.counterparty_contact_id,e.counterparty_id,uid);end if;
 binding_entity:=coalesce(e.entity_id,t.entity_id,(select id from public.organization_entities where organization_id=d.organization_id and active order by created_at limit 1));
 if binding_entity is null then raise exception 'ASSET_VAT_ENTITY_REQUIRED';end if;
 if exists(select 1 from public.vat_documents where asset_transaction_id=t.id and id<>d.id) then raise exception 'ASSET_INVOICE_ALREADY_BOUND';end if;
 update public.vat_documents set asset_transaction_id=t.id where id=d.id;
 insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id,metadata) values(e.id,d.organization_id,'SOURCE','vat_documents',d.id,jsonb_build_object('asset_transaction_id',t.id)) on conflict do nothing;
 insert into public.financial_vat_source_bindings(organization_id,source_table,source_record_id,event_id,canonical_payload,payload_fingerprint,document_kind,side,contact_id,entity_id,due_date,is_alias,created_by)
 values(d.organization_id,'vat_documents',d.id,e.id,jsonb_build_object('asset_transaction_id',t.id,'net_amount',d.net_amount,'tax_amount',d.tax_amount,'gross_amount',d.gross_amount,'recoverable_percent',d.recoverable_percent),encode(extensions.digest(convert_to(d.id::text||'|'||e.id::text,'UTF8'),'sha256'),'hex'),d.document_kind,d.document_type,d.counterparty_contact_id,binding_entity,d.due_date,true,uid) on conflict(organization_id,source_table,source_record_id) do nothing;
 return e.id;
end $$;
revoke all on function private.bind_asset_vat_document(uuid,uuid) from public,anon,authenticated;
create or replace function public.bind_asset_purchase_vat_document(p_document_id uuid,p_transaction_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
 return private.bind_asset_vat_document(p_document_id,p_transaction_id);
end $$;
revoke all on function public.bind_asset_purchase_vat_document(uuid,uuid) from public,anon;
grant execute on function public.bind_asset_purchase_vat_document(uuid,uuid) to authenticated;

create or replace function public.create_asset_vat_document(p_values jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();v public.vat_documents%rowtype;d public.vat_documents%rowtype;eid uuid;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 select * into v from jsonb_populate_record(null::public.vat_documents,p_values);
 if v.asset_transaction_id is null or v.document_kind<>'INVOICE' or not public.has_organization_permission(v.organization_id,'assets.edit') or not public.has_organization_permission(v.organization_id,'vat.edit') then raise exception 'ASSET_VAT_ACCESS_DENIED';end if;
 insert into public.vat_documents(user_id,created_by,organization_id,document_type,document_kind,document_number,transaction_date,due_date,counterparty_contact_id,counterparty_name,counterparty_tax_number,supply_type,net_amount,tax_rate,tax_amount,recoverable_percent,gross_amount,line_items,currency,source_currency,exchange_rate,source_net_amount,source_tax_amount,source_gross_amount,notes,asset_transaction_id,preceding_document_id)
 values(uid,uid,v.organization_id,v.document_type,v.document_kind,v.document_number,v.transaction_date,v.due_date,v.counterparty_contact_id,v.counterparty_name,v.counterparty_tax_number,v.supply_type,v.net_amount,v.tax_rate,v.tax_amount,v.recoverable_percent,v.gross_amount,v.line_items,v.currency,v.source_currency,v.exchange_rate,v.source_net_amount,v.source_tax_amount,v.source_gross_amount,v.notes,v.asset_transaction_id,v.preceding_document_id) returning * into d;
 eid:=public.bind_asset_purchase_vat_document(d.id,d.asset_transaction_id);
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(uid,'vat_document',d.id,'CREATE_ASSET_ALIAS',jsonb_build_object('financial_event_id',eid,'asset_transaction_id',d.asset_transaction_id));
 return to_jsonb(d)||jsonb_build_object('financial_core',jsonb_build_object('event_id',eid,'recognition','EXISTING_ASSET_EVENT'));
end $$;
revoke all on function public.create_asset_vat_document(jsonb) from public,anon;
grant execute on function public.create_asset_vat_document(jsonb) to authenticated;

create or replace function public.post_sale_with_proceeds(
 p_user_id uuid,p_asset_account_id uuid,p_destination_account_id uuid,p_date date,p_quantity numeric,p_sale_value numeric,p_currency text,p_base_currency text,p_base_value numeric,p_notes text default null
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare v_dest_currency text;v_deposit numeric;v_sale uuid;v_cash uuid;v_needed numeric:=p_quantity;v_lot record;v_take numeric;v_cost numeric;v_cost_total numeric:=0;v_transfer uuid:=gen_random_uuid();
begin
 if (select auth.uid()) is null or (select auth.uid())<>p_user_id then raise exception 'UNAUTHORIZED'; end if;
 if p_quantity<=0 or p_sale_value<=0 or p_base_value<=0 then raise exception 'INVALID_SALE'; end if;
 if p_asset_account_id=p_destination_account_id then raise exception 'DESTINATION_MUST_DIFFER'; end if;
 if not exists(select 1 from public.asset_accounts where id=p_asset_account_id and user_id=p_user_id and ownership_scope='PERSONAL' and currency=p_currency) then raise exception 'ASSET_NOT_FOUND'; end if;
 if not exists(select 1 from public.asset_accounts where id=p_destination_account_id and user_id=p_user_id and asset_type in ('CASH','BANK')) then raise exception 'DESTINATION_MUST_BE_CASH_OR_BANK'; end if;
 select currency into v_dest_currency from public.asset_accounts where id=p_destination_account_id and user_id=p_user_id and ownership_scope='PERSONAL' for update;
 if v_dest_currency is null or v_dest_currency not in(p_currency,p_base_currency) or not exists(select 1 from public.profiles where id=p_user_id and base_currency=p_base_currency) then raise exception 'SALE_PROCEEDS_CURRENCY_MISMATCH';end if;
 v_deposit:=case when v_dest_currency=p_base_currency then p_base_value else p_sale_value end;
 perform 1 from public.asset_accounts where id=p_asset_account_id for update;
 perform 1 from public.lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0 order by id for update;
 if coalesce((select sum(remaining_quantity) from public.lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0),0)<p_quantity then raise exception 'INSUFFICIENT_LOT_BALANCE'; end if;
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,notes,transfer_id,metadata,created_by)
 values(p_user_id,p_asset_account_id,'SALE',p_date,p_quantity,upper(p_currency),p_sale_value,upper(p_base_currency),p_base_value,p_notes,v_transfer,jsonb_build_object('proceeds_account_id',p_destination_account_id),p_user_id) returning id into v_sale;
 for v_lot in select * from public.lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0 order by acquisition_date,created_at,id for update loop
  exit when v_needed<=0;v_take:=least(v_needed,v_lot.remaining_quantity);v_cost:=case when v_lot.remaining_quantity=0 then 0 else v_lot.remaining_value_base*v_take/v_lot.remaining_quantity end;v_cost_total:=v_cost_total+v_cost;
  insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method) values(p_user_id,v_sale,v_lot.id,v_take,v_cost,'FIFO');
  update public.lots set remaining_quantity=remaining_quantity-v_take,remaining_value_base=greatest(0,remaining_value_base-v_cost),status=case when remaining_quantity-v_take<=0 then 'CLOSED'::public.lot_status else 'PARTIALLY_USED'::public.lot_status end where id=v_lot.id;
  v_needed:=v_needed-v_take;
 end loop;
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,unit_price,currency,gross_value,base_currency,base_value,notes,transfer_id,metadata,created_by)
 values(p_user_id,p_destination_account_id,'ADD',p_date,v_deposit,1,v_dest_currency,v_deposit,upper(p_base_currency),p_base_value,p_notes,v_transfer,jsonb_build_object('source','sale_proceeds','sale_transaction_id',v_sale),p_user_id) returning id into v_cash;
 insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)
 values(p_user_id,p_destination_account_id,v_cash,p_date,v_deposit,v_deposit,p_base_value,p_base_value,'ACTIVE',jsonb_build_object('source','sale_proceeds','sale_transaction_id',v_sale));
 return jsonb_build_object('sale_transaction_id',v_sale,'proceeds_transaction_id',v_cash,'realized_gain_base',p_base_value-v_cost_total,'cost_basis_base',v_cost_total,'transfer_id',v_transfer);
end $$;
revoke execute on function public.post_sale_with_proceeds(uuid,uuid,uuid,date,numeric,numeric,text,text,numeric,text) from public,anon;
grant execute on function public.post_sale_with_proceeds(uuid,uuid,uuid,date,numeric,numeric,text,text,numeric,text) to authenticated;


create or replace function public.post_asset_disposal(
 p_user_id uuid,p_asset_account_id uuid,p_date date,p_quantity numeric,p_notes text default null
) returns uuid language plpgsql security invoker set search_path=''
as $$
declare v_id uuid;v_needed numeric:=p_quantity;v_lot record;v_take numeric;v_cost numeric;v_cost_total numeric:=0;
begin
 if (select auth.uid()) is null or (select auth.uid())<>p_user_id then raise exception 'UNAUTHORIZED'; end if;
 if p_quantity<=0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
 if not exists(select 1 from public.asset_accounts where id=p_asset_account_id and user_id=p_user_id and ownership_scope='PERSONAL') then raise exception 'ASSET_NOT_FOUND'; end if;
 perform 1 from public.asset_accounts where id=p_asset_account_id for update;
 perform 1 from public.lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0 order by id for update;
 if coalesce((select sum(remaining_quantity) from public.lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0),0)<p_quantity then raise exception 'INSUFFICIENT_LOT_BALANCE'; end if;
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,notes,metadata,created_by)
 select p_user_id,id,'ADJUSTMENT',p_date,p_quantity,currency,0,(select base_currency from public.profiles where id=p_user_id),0,p_notes,jsonb_build_object('adjustment_direction','OUT','reason','DISPOSAL_ZERO_VALUE','proceeds_value',0),p_user_id from public.asset_accounts where id=p_asset_account_id returning id into v_id;
 for v_lot in select * from public.lots where user_id=p_user_id and asset_account_id=p_asset_account_id and remaining_quantity>0 order by acquisition_date,created_at,id for update loop
  exit when v_needed<=0;v_take:=least(v_needed,v_lot.remaining_quantity);v_cost:=case when v_lot.remaining_quantity=0 then 0 else v_lot.remaining_value_base*v_take/v_lot.remaining_quantity end;v_cost_total:=v_cost_total+v_cost;
  insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method) values(p_user_id,v_id,v_lot.id,v_take,v_cost,'FIFO');
  update public.lots set remaining_quantity=remaining_quantity-v_take,remaining_value_base=greatest(0,remaining_value_base-v_cost),status=case when remaining_quantity-v_take<=0 then 'CLOSED'::public.lot_status else 'PARTIALLY_USED'::public.lot_status end where id=v_lot.id;
  v_needed:=v_needed-v_take;
 end loop;
 update public.transactions set base_value=v_cost_total,metadata=metadata||jsonb_build_object('disposed_cost_base',v_cost_total,'asset_effect_base',-v_cost_total) where id=v_id;
 return v_id;
end $$;
revoke execute on function public.post_asset_disposal(uuid,uuid,date,numeric,text) from public,anon;
grant execute on function public.post_asset_disposal(uuid,uuid,date,numeric,text) to authenticated;
