alter table public.vat_documents add column if not exists asset_transaction_id uuid null references public.transactions(id) on delete restrict;
create unique index if not exists vat_documents_asset_transaction_unique on public.vat_documents(asset_transaction_id) where asset_transaction_id is not null;

create or replace function public.bind_asset_purchase_vat_document(p_document_id uuid,p_transaction_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.vat_documents%rowtype; t public.transactions%rowtype; a public.asset_accounts%rowtype; eid uuid; taxid uuid; vatbase numeric; vatrecover numeric;
begin
 select * into d from public.vat_documents where id=p_document_id for update;
 if d.id is null or d.document_type<>'PURCHASE' or d.document_kind<>'INVOICE' then raise exception 'ASSET_PURCHASE_VAT_DOCUMENT_REQUIRED'; end if;
 select * into t from public.transactions where id=p_transaction_id for update;
 if t.id is null or t.transaction_type::text<>'PURCHASE' or t.organization_id is distinct from d.organization_id then raise exception 'ASSET_PURCHASE_TRANSACTION_MISMATCH'; end if;
 select * into a from public.asset_accounts where id=t.asset_account_id;
 if a.id is null or a.ownership_scope<>'ORGANIZATION' or a.organization_id is distinct from d.organization_id then raise exception 'ORGANIZATION_ASSET_REQUIRED'; end if;
 eid:=nullif(t.metadata->>'financial_event_id','')::uuid;
 if eid is null then raise exception 'ASSET_FINANCIAL_EVENT_REQUIRED'; end if;
 if not exists(select 1 from public.financial_events e where e.id=eid and e.organization_id=d.organization_id and e.event_type='ASSET_PURCHASE') then raise exception 'ASSET_FINANCIAL_EVENT_MISMATCH'; end if;
 vatbase:=round(d.tax_amount*d.recoverable_percent/100,2); vatrecover:=d.tax_amount-vatbase;
 if vatrecover<>0 then raise exception 'ASSET_NONRECOVERABLE_VAT_POLICY_REQUIRED'; end if;
 select id into taxid from public.financial_classifications where organization_id=d.organization_id and classification_type='TAX' and active order by is_system desc limit 1;
 if d.tax_amount>0 and taxid is null then raise exception 'VAT_FINANCIAL_CLASSIFICATION_REQUIRED'; end if;
 if round(t.base_value,2)<>round(d.net_amount,2) then raise exception 'ASSET_PURCHASE_NET_MUST_MATCH_VAT_DOCUMENT'; end if;
 update public.vat_documents set asset_transaction_id=t.id where id=d.id;
 insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id,metadata)
 values(eid,d.organization_id,'VAT','vat_documents',d.id,jsonb_build_object('asset_transaction_id',t.id,'recoverable_percent',d.recoverable_percent)) on conflict do nothing;
 insert into public.financial_vat_source_bindings(organization_id,source_table,source_record_id,event_id,canonical_payload,payload_fingerprint,document_kind,side,contact_id,entity_id,due_date,original_event_id,is_alias,created_by)
 values(d.organization_id,'vat_documents',d.id,eid,jsonb_build_object('asset_transaction_id',t.id,'net_amount',d.net_amount,'tax_amount',d.tax_amount,'gross_amount',d.gross_amount,'recoverable_percent',d.recoverable_percent),encode(extensions.digest(convert_to(d.id::text||'|'||eid::text,'UTF8'),'sha256'),'hex'),d.document_kind,'PURCHASE',d.counterparty_contact_id,t.entity_id,d.transaction_date,null,true,auth.uid())
 on conflict (organization_id,source_table,source_record_id) do update set event_id=excluded.event_id,is_alias=true;
 return eid;
end $$;
revoke all on function public.bind_asset_purchase_vat_document(uuid,uuid) from public,anon;
grant execute on function public.bind_asset_purchase_vat_document(uuid,uuid) to authenticated;