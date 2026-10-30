create or replace function private.bind_asset_vat_document(p_document_id uuid,p_transaction_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.vat_documents%rowtype;t public.transactions%rowtype;e public.financial_events%rowtype;uid uuid:=auth.uid();mapped uuid;vat numeric;fx numeric;binding_entity uuid;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 select * into d from public.vat_documents where id=p_document_id for update;
 if d.id is null or not public.has_organization_permission(d.organization_id,'assets.edit') or not public.has_organization_permission(d.organization_id,'vat.edit') then raise exception 'ASSET_VAT_ACCESS_DENIED';end if;
 select * into t from public.transactions where id=p_transaction_id and organization_id=d.organization_id for update;
 if d.asset_transaction_id is not null and d.asset_transaction_id<>p_transaction_id then raise exception 'ASSET_INVOICE_ALREADY_BOUND';end if;
 if t.id is null or d.document_kind<>'INVOICE' or (d.document_type='PURCHASE' and t.transaction_type<>'PURCHASE') or (d.document_type='SALES' and t.transaction_type<>'SALE') then raise exception 'ASSET_VAT_TRANSACTION_MISMATCH';end if;
 select * into e from public.financial_events where id=nullif(t.metadata->>'financial_event_id','')::uuid and organization_id=d.organization_id and source_module in('ASSETS_INTEGRATION','ASSET_LIFECYCLE') and status not in('CANCELLED','REVERSED');
 if e.id is null then raise exception 'ASSET_FINANCIAL_EVENT_REQUIRED';end if;
 if exists(select 1 from public.financial_vat_source_bindings where organization_id=d.organization_id and source_table='vat_documents' and source_record_id=d.id and event_id<>e.id) or exists(select 1 from public.financial_event_links where organization_id=d.organization_id and target_module='vat_documents' and target_record_id=d.id and link_type='SOURCE' and event_id<>e.id) then raise exception 'ASSET_INVOICE_HAS_ANOTHER_FINANCIAL_EVENT';end if;
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
 update public.vat_documents set asset_transaction_id=t.id where id=d.id and asset_transaction_id is distinct from t.id;
 insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id,metadata) values(e.id,d.organization_id,'SOURCE','vat_documents',d.id,jsonb_build_object('asset_transaction_id',t.id)) on conflict do nothing;
 insert into public.financial_vat_source_bindings(organization_id,source_table,source_record_id,event_id,canonical_payload,payload_fingerprint,document_kind,side,contact_id,entity_id,due_date,is_alias,created_by)
 values(d.organization_id,'vat_documents',d.id,e.id,jsonb_build_object('asset_transaction_id',t.id,'net_amount',d.net_amount,'tax_amount',d.tax_amount,'gross_amount',d.gross_amount,'recoverable_percent',d.recoverable_percent),encode(extensions.digest(convert_to(d.id::text||'|'||e.id::text,'UTF8'),'sha256'),'hex'),d.document_kind,d.document_type,d.counterparty_contact_id,binding_entity,d.due_date,true,uid) on conflict(organization_id,source_table,source_record_id) do nothing;
 return e.id;
end $$;

revoke all on function private.bind_asset_vat_document(uuid,uuid) from public,anon,authenticated;
