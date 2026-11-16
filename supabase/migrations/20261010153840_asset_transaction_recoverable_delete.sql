-- Delete only disconnected asset ledger entries; preserve the removed record in audit history.
create or replace function public.asset_transaction_delete_eligibility(p_ids uuid[])
returns table(transaction_id uuid,can_delete boolean,delete_block_reason text)
language plpgsql stable security invoker set search_path='' as $$
declare row record;fk record;linked boolean;
begin
 for row in select t.id,reason from public.transactions t
 cross join lateral (select case
 when t.metadata->>'asset_deleted'='true' then 'DELETED'
 when t.transfer_id is not null or t.reversal_of_transaction_id is not null then 'TRANSFER_OR_REVERSAL'
 when exists(select 1 from public.lots l where l.source_transaction_id=t.id) then 'ASSET_LOTS'
 when exists(select 1 from public.transaction_allocations a where a.transaction_id=t.id) then 'LOT_ALLOCATION'
 when exists(select 1 from public.transactions x where x.reversal_of_transaction_id=t.id) then 'REVERSAL'
 when exists(select 1 from public.vat_documents x where x.asset_transaction_id=t.id) then 'INVOICE'
 when exists(select 1 from public.asset_lifecycle_commands x where x.transaction_id=t.id) then 'ASSET_OPERATION'
 when t.metadata ?| array['financial_event_id','financial_core_intent','purchase_transaction_id','sale_transaction_id','funding_transaction_id','proceeds_transaction_id','lifecycle_reversed','disposed_cost_base','asset_effect_base'] then 'FINANCIAL_EFFECT'
 when exists(select 1 from public.financial_event_links x where x.target_module='transactions' and x.target_record_id=t.id) then 'FINANCIAL_LINK'
 when exists(select 1 from public.financial_events x where x.source_record_id=t.id) then 'FINANCIAL_EVENT'
 when exists(select 1 from public.transactions x where x.id<>t.id and (x.metadata->>'purchase_transaction_id'=t.id::text or x.metadata->>'sale_transaction_id'=t.id::text or x.metadata->>'funding_transaction_id'=t.id::text or x.metadata->>'proceeds_transaction_id'=t.id::text)) then 'RELATED_TRANSACTION'
 when t.transaction_type::text='ZAKAT_PAYMENT' then 'ZAKAT_PAYMENT'
 else null end reason) guard
 where t.id=any(p_ids) and t.user_id=(select auth.uid()) loop
  if row.reason is null then
   for fk in select n.nspname schema_name,c.relname table_name,a.attname column_name from pg_catalog.pg_constraint k
    join pg_catalog.pg_class c on c.oid=k.conrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1]
    where k.contype='f' and k.confrelid='public.transactions'::regclass and array_length(k.conkey,1)=1 loop
    execute format('select exists(select 1 from %I.%I where %I=$1)',fk.schema_name,fk.table_name,fk.column_name) into linked using row.id;
    if linked then row.reason:='REFERENCE';exit;end if;
   end loop;
  end if;
  transaction_id:=row.id;can_delete:=row.reason is null;delete_block_reason:=row.reason;return next;
 end loop;
end $$;
create or replace function public.delete_unlinked_asset_transaction(p_transaction_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.transactions;allowed boolean;reason text;uid uuid:=(select auth.uid());
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 select * into t from public.transactions where id=p_transaction_id and user_id=uid for update;
 if not found then raise exception 'TRANSACTION_NOT_FOUND';end if;
 select can_delete,delete_block_reason into allowed,reason from public.asset_transaction_delete_eligibility(array[t.id]);
 if allowed is distinct from true then raise exception 'TRANSACTION_DELETE_LINKED: %',reason;end if;
 update public.transactions set metadata=metadata||jsonb_build_object('asset_deleted',true,'asset_deleted_at',clock_timestamp()) where id=t.id and user_id=uid;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data)
 values(uid,'transaction',t.id,'DELETE_UNLINKED',to_jsonb(t),'{}'::jsonb);
 return jsonb_build_object('ok',true,'id',t.id);
end $$;
revoke all on function public.asset_transaction_delete_eligibility(uuid[]) from public,anon;
revoke all on function public.delete_unlinked_asset_transaction(uuid) from public,anon;
grant execute on function public.asset_transaction_delete_eligibility(uuid[]),public.delete_unlinked_asset_transaction(uuid) to authenticated;

create or replace function public.restore_unlinked_asset_transaction(p_transaction_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.transactions;uid uuid:=(select auth.uid());
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 select * into t from public.transactions where id=p_transaction_id and user_id=uid and metadata->>'asset_deleted'='true' for update;
 if not found then raise exception 'DELETED_TRANSACTION_NOT_FOUND';end if;
 update public.transactions set metadata=metadata-array['asset_deleted','asset_deleted_at'] where id=t.id and user_id=uid;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data) values(uid,'transaction',t.id,'RESTORE_UNLINKED',to_jsonb(t));
 return jsonb_build_object('ok',true,'id',t.id);
end $$;
revoke all on function public.restore_unlinked_asset_transaction(uuid) from public,anon;
grant execute on function public.restore_unlinked_asset_transaction(uuid) to authenticated;
