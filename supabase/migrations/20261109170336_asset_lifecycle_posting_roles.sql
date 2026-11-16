-- Explicit source roles for NEW lifecycle commands; no historical rows rewritten.
-- A guarded private helper reads the existing canonical book reconstruction.
create function private.asset_lifecycle_posting_context(p_asset uuid,p_date date,p_expected_net numeric)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare org uuid;book jsonb;entry record;cid uuid;ids jsonb:='{}';
begin
 select organization_id into org from public.asset_accounts where id=p_asset and ownership_scope='ORGANIZATION';
 if auth.uid() is null or org is null or public.has_organization_permission(org,'assets.edit') is not true
   or public.financial_core_can(org,'financial_core.create') is not true then raise exception 'ASSET_ORGANIZATION_ACCESS_DENIED';end if;
 if p_date is null or p_expected_net is null or p_expected_net<0 then raise exception 'ASSET_BOOK_RECONCILIATION_REQUIRED';end if;
 book:=private.financial_opening_asset_book(org,p_asset,p_date);
 if book->>'known' is distinct from 'true' or book->>'issue' is not null
   or abs((book->>'gross')::numeric-(book->>'depreciation')::numeric-p_expected_net)>0.0001 then
  raise exception 'ASSET_BOOK_RECONCILIATION_REQUIRED';
 end if;
 -- Existing generic classifications are reused; account-specific classifications
 -- cannot accidentally become a fallback for a native asset operation.
 for entry in select * from (values('OPEX','المصروفات التشغيلية'),('REVENUE','الإيرادات'),('ASSET','الأصول'),('TAX','الضرائب')) v(code,name) loop
  insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)
   values(org,entry.code,entry.name,entry.code,true,auth.uid()) on conflict(organization_id,code) do nothing;
  select id into cid from public.financial_classifications where organization_id=org and code=entry.code
   and classification_type=entry.code and active and not(metadata ? 'accountInheritance') and not(metadata ? 'automaticExpenseAccount');
  if cid is null then raise exception 'ASSET_FINANCIAL_CLASSIFICATION_REQUIRED';end if;
  ids:=ids||jsonb_build_object(entry.code,cid);
 end loop;
 return book||jsonb_build_object('classifications',ids);
end $$;
revoke all on function private.asset_lifecycle_posting_context(uuid,date,numeric) from public,anon,authenticated;
-- Narrow privilege boundary: the internal helper checks the actual user and
-- asset organization before reading canonical book data or seeding classifications.
-- No schema-wide private USAGE grant or elevated lifecycle command is needed.
create function public.asset_lifecycle_posting_context(p_asset uuid,p_date date,p_expected_net numeric)
returns jsonb language sql security definer set search_path='' as $$
 select private.asset_lifecycle_posting_context(p_asset,p_date,p_expected_net)
$$;
revoke all on function public.asset_lifecycle_posting_context(uuid,date,numeric) from public,anon;
grant execute on function public.asset_lifecycle_posting_context(uuid,date,numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.prepare_asset_lifecycle(p_asset_id uuid, p_payload jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare uid uuid:=auth.uid();a public.asset_accounts%rowtype;c public.asset_lifecycle_commands%rowtype;kind text:=p_payload->>'operation';dt date:=(p_payload->>'date')::date;qty numeric:=coalesce((p_payload->>'quantity')::numeric,0);amt numeric:=coalesce((p_payload->>'amount')::numeric,0);q numeric;b numeric;cost numeric;vat numeric:=coalesce((p_payload->>'vat_amount')::numeric,0);cid uuid;aid uuid;taxid uuid;eid uuid;lines jsonb;obs jsonb:='[]';base text;gain numeric;context jsonb;released_depreciation numeric:=0;role_prefix text;fingerprint text:=md5(p_asset_id::text||p_payload::text);
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if p_request_id is null then raise exception 'ASSET_REQUEST_ID_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
 select * into c from public.asset_lifecycle_commands where created_by=uid and request_id=p_request_id;
 if c.id is not null then if c.payload_fingerprint<>fingerprint then raise exception 'ASSET_REQUEST_CONFLICT';end if;return to_jsonb(c);end if;
 select * into a from public.asset_accounts where id=p_asset_id and ownership_scope='ORGANIZATION' for update;
 if a.id is null or not public.has_organization_permission(a.organization_id,'assets.edit') then raise exception 'ASSET_ORGANIZATION_ACCESS_DENIED';end if;
 select base_currency into base from public.organizations where id=a.organization_id;
 select sum(remaining_quantity),sum(remaining_value_base) into q,b from public.lots where asset_account_id=a.id and remaining_quantity>0 and coalesce((metadata->>'recognition_pending')::boolean,false)=false;
 if kind not in('DEPRECIATION','SALE','DISPOSAL') or dt is null or amt<0 or vat<0 or (kind<>'SALE' and vat<>0) or q is null or q<=0 or dt<(select min(acquisition_date) from public.lots where asset_account_id=a.id) then raise exception 'ASSET_OPERATION_INVALID';end if;
 if kind='DEPRECIATION' then
  if exists(select 1 from public.asset_lifecycle_commands cmd join public.financial_events e on e.id=cmd.financial_event_id where cmd.asset_account_id=a.id and cmd.operation='DEPRECIATION' and date_trunc('month',cmd.operation_date)=date_trunc('month',dt) and e.status not in('CANCELLED','REVERSED')) then raise exception 'ASSET_DEPRECIATION_PERIOD_EXISTS';end if;
  if a.asset_class_code not in('PPE','INTANGIBLE') or a.asset_type_code in('LAND','GOODWILL') or amt<=0 or amt>b-coalesce((a.metadata->>'residual_value_base')::numeric,0) then raise exception 'ASSET_DEPRECIATION_INVALID';end if;qty:=0;cost:=amt;
 else
  if qty<=0 or qty>q or (kind='DISPOSAL' and amt<>0) then raise exception 'ASSET_QUANTITY_INVALID';end if;
  cost:=b*qty/q;
 end if;
 if kind='SALE' and (nullif(p_payload->>'counterparty_id','') is null or nullif(p_payload->>'due_date','') is null or (p_payload->>'due_date')::date<dt) then raise exception 'ASSET_CUSTOMER_DUE_REQUIRED';end if;
 if kind='SALE' and not exists(select 1 from public.liquidity_counterparties where id=(p_payload->>'counterparty_id')::uuid and organization_id=a.organization_id and party_type in('CUSTOMER','BOTH')) then raise exception 'ASSET_CUSTOMER_SCOPE_MISMATCH';end if;
 gain:=case when kind='SALE' then amt-cost else -cost end;
 context:=public.asset_lifecycle_posting_context(a.id,dt,b);
 role_prefix:=case when a.asset_class_code in ('PPE','INTANGIBLE') then '' else coalesce(a.asset_class_code,'UNCLASSIFIED')||'_' end;
 cid:=(context->'classifications'->>case when gain>0 then 'REVENUE' else 'OPEX' end)::uuid;
 aid:=(context->'classifications'->>'ASSET')::uuid;
 taxid:=(context->'classifications'->>'TAX')::uuid;
 if kind<>'DEPRECIATION' then released_depreciation:=round((context->>'depreciation')::numeric*qty/q,4);end if;
 lines:='[]';
 if gain<>0 then lines:=jsonb_build_array(jsonb_build_object('line_number',1,'description',kind||' / '||a.name,'classification_id',cid,'cost_center_id',a.cost_center_id,'amount',abs(gain),'currency',base,'exchange_rate',1,'base_amount',abs(gain),'metadata',jsonb_build_object('source_role',role_prefix||case when kind='DEPRECIATION' then 'DEPRECIATION' when kind='DISPOSAL' then 'DISPOSAL_LOSS' when gain>0 then 'SALE_GAIN' else 'SALE_LOSS' end),'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0));end if;
 if kind='SALE' and cost>0 then lines:=lines||jsonb_build_array(jsonb_build_object('line_number',jsonb_array_length(lines)+1,'description','Carrying value released / '||a.name,'classification_id',aid,'cost_center_id',a.cost_center_id,'amount',cost,'currency',base,'exchange_rate',1,'base_amount',cost,'metadata',jsonb_build_object('source_role',role_prefix||'SALE_NET_BOOK_VALUE'),'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0));end if;
 if kind='SALE' and vat>0 then
  lines:=lines||jsonb_build_array(jsonb_build_object('line_number',jsonb_array_length(lines)+1,'description','Output VAT / '||a.name,'classification_id',taxid,'cost_center_id',a.cost_center_id,'amount',vat,'currency',base,'exchange_rate',1,'base_amount',vat,'metadata',jsonb_build_object('source_role',role_prefix||'OUTPUT_VAT'),'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0));
 end if;
 -- Restore the gross-cost / accumulated-depreciation presentation when
 -- disposing of all or part of a depreciated asset, including zero-net assets.
 if released_depreciation>0 then
  lines:=lines||jsonb_build_array(jsonb_build_object('line_number',jsonb_array_length(lines)+1,
   'description','Accumulated depreciation released / '||a.name,'classification_id',aid,'cost_center_id',a.cost_center_id,
   'amount',released_depreciation,'currency',base,'exchange_rate',1,'base_amount',released_depreciation,
   'metadata',jsonb_build_object('source_role',role_prefix||'ACCUMULATED_DEPRECIATION_RELEASE'),
   'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0));
 end if;
 if jsonb_array_length(lines)=0 then raise exception 'ASSET_OPERATION_ZERO_EFFECT';end if;
 if kind='SALE' and amt+vat>0 then obs:=jsonb_build_array(jsonb_build_object('obligation_key','asset-sale-receivable','obligation_type','RECEIVABLE','settleable_amount',amt+vat,'currency',base,'exchange_rate',1,'base_currency',base,'settleable_base_amount',amt+vat));end if;
 insert into public.asset_lifecycle_commands(asset_account_id,organization_id,created_by,request_id,payload_fingerprint,operation,operation_date,quantity,amount,expected_quantity,expected_book_value,book_effect,vat_amount)
 values(a.id,a.organization_id,uid,p_request_id,fingerprint,kind,dt,qty,amt,q,b,cost,vat) returning * into c;
 eid:=public.create_financial_event_command(jsonb_build_object('organization_id',a.organization_id,'entity_id',a.entity_id,'counterparty_id',nullif(p_payload->>'counterparty_id','')::uuid,'event_type','ADJUSTMENT','source_module','ASSET_LIFECYCLE','source_record_id',c.id,'source_event_key','asset-lifecycle:'||c.id,'event_date',dt,'due_date',coalesce(nullif(p_payload->>'due_date','')::date,dt),'base_currency',base,'description',kind||' / '||a.name,'lines',lines,'obligations',obs,'links',jsonb_build_array(jsonb_build_object('link_type','ASSET','target_module','asset_accounts','target_record_id',a.id,'metadata',jsonb_build_object('operation',kind,'quantity_delta',-qty,'asset_effect_base',-cost,'gain_loss_base',gain)))));
 perform public.ensure_asset_cash_forecast(eid);
 -- The Core INSERT trigger stores the event link; UPDATE rights are not public.
 return to_jsonb(c)||jsonb_build_object('financial_event_id',eid);
end $function$;

revoke all on function public.prepare_asset_lifecycle(uuid,jsonb,uuid) from public,anon;
grant execute on function public.prepare_asset_lifecycle(uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';

-- Qualify the saved-state column so reversal does not collide with the local value variable.
create or replace function public.apply_asset_lifecycle_event()
returns trigger language plpgsql security invoker set search_path=public as $$
declare c public.asset_lifecycle_commands%rowtype;a public.asset_accounts%rowtype;l record;remaining numeric;take numeric;value numeric;q numeric;b numeric;tid uuid;states jsonb:='[]';st jsonb;
begin
 if new.source_module<>'ASSET_LIFECYCLE' then return new;end if;
 select * into c from public.asset_lifecycle_commands where id=new.source_record_id for update;
 if c.id is null or c.organization_id<>new.organization_id or new.source_event_key<>'asset-lifecycle:'||c.id then raise exception 'ASSET_OPERATION_SOURCE_MISMATCH';end if;
 if tg_op='INSERT' then update public.asset_lifecycle_commands set financial_event_id=new.id where id=c.id;return new;end if;
 if old.status=new.status or new.status not in('ACTUAL','REVERSED') then return new;end if;
 select * into a from public.asset_accounts where id=c.asset_account_id for update;
 perform 1 from public.lots where asset_account_id=a.id order by id for update;
 if new.status='REVERSED' then
  if c.applied_at is null then return new;end if;
  if exists(select 1 from public.asset_lifecycle_commands where asset_account_id=a.id and applied_at>c.applied_at) then raise exception 'ASSET_REVERSAL_HAS_LATER_OPERATIONS';end if;
  for st in select state.value from jsonb_array_elements(c.lot_states) state(value) loop
   if not exists(select 1 from public.lots where id=(st->>'id')::uuid and remaining_quantity=(st->>'after_quantity')::numeric and remaining_value_base=(st->>'after_value')::numeric) then raise exception 'ASSET_REVERSAL_BALANCE_CHANGED';end if;
   update public.lots set remaining_quantity=(st->>'quantity')::numeric,remaining_value_base=(st->>'value')::numeric,status=(st->>'status')::public.lot_status where id=(st->>'id')::uuid;
  end loop;
  update public.transactions set metadata=metadata||jsonb_build_object('lifecycle_reversed',true) where id=c.transaction_id;
  return new;
 end if;
 if c.applied_at is not null then raise exception 'ASSET_OPERATION_ALREADY_APPLIED';end if;
 select sum(remaining_quantity),sum(remaining_value_base) into q,b from public.lots where asset_account_id=a.id and remaining_quantity>0 and coalesce((metadata->>'recognition_pending')::boolean,false)=false;
 if q is distinct from c.expected_quantity or b is distinct from c.expected_book_value then raise exception 'ASSET_OPERATION_BALANCE_CHANGED_RECREATE';end if;
 insert into public.transactions(user_id,asset_account_id,organization_id,entity_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,metadata,created_by)
 values(new.created_by,a.id,a.organization_id,a.entity_id,case when c.operation='SALE' then 'SALE'::public.transaction_type else 'ADJUSTMENT'::public.transaction_type end,c.operation_date,c.quantity,new.base_currency,c.amount,new.base_currency,c.amount,jsonb_build_object('due_date',new.due_date,'vat_amount',c.vat_amount,'fx_rate',1,'operation',c.operation,'reason',case when c.operation='DISPOSAL' then 'DISPOSAL_ZERO_VALUE' else c.operation end,'financial_event_id',new.id,'cost_basis_base',c.book_effect,'asset_effect_base',-c.book_effect,'proceeds_value',c.amount,'realized_gain_base',case when c.operation='SALE' then c.amount-c.book_effect else -c.book_effect end),new.created_by) returning id into tid;
 for l in select * from public.lots where asset_account_id=a.id and remaining_quantity>0 and coalesce((metadata->>'recognition_pending')::boolean,false)=false order by id for update loop
  take:=case when c.operation='DEPRECIATION' then 0 else l.remaining_quantity*c.quantity/q end;
  value:=case when c.operation='DEPRECIATION' then l.remaining_value_base*c.book_effect/b else l.remaining_value_base*c.quantity/q end;
  states:=states||jsonb_build_array(jsonb_build_object('id',l.id,'quantity',l.remaining_quantity,'value',l.remaining_value_base,'status',l.status,'after_quantity',round(greatest(0,l.remaining_quantity-take),8),'after_value',round(greatest(0,l.remaining_value_base-value),8)));
  update public.lots set remaining_quantity=round(greatest(0,remaining_quantity-take),8),remaining_value_base=round(greatest(0,remaining_value_base-value),8),status=case when remaining_quantity-take<=0 then 'CLOSED'::public.lot_status else status end where id=l.id;
 end loop;
 update public.asset_lifecycle_commands set applied_at=clock_timestamp(),transaction_id=tid,lot_states=states where id=c.id;
 return new;
end $$;

revoke all on function public.apply_asset_lifecycle_event() from public,anon,authenticated;
