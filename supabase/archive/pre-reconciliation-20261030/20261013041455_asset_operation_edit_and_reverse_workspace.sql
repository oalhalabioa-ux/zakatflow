BEGIN;
-- Financial edit commands reuse the existing lifecycle engine and preserve the old draft.
CREATE OR REPLACE FUNCTION private.replace_asset_lifecycle_draft(p_event_id uuid,p_payload jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.financial_events%rowtype;c public.asset_lifecycle_commands%rowtype;r public.asset_lifecycle_commands%rowtype;result jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED';END IF;
 SELECT * INTO e FROM public.financial_events WHERE id=p_event_id;
 SELECT * INTO c FROM public.asset_lifecycle_commands WHERE id=e.source_record_id AND financial_event_id=e.id AND organization_id=e.organization_id;
 IF c.id IS NULL OR e.source_module<>'ASSET_LIFECYCLE' THEN RAISE EXCEPTION 'ASSET_LIFECYCLE_EVENT_REQUIRED';END IF;
 IF NOT public.has_organization_permission(e.organization_id,'assets.edit') OR NOT public.financial_core_can(e.organization_id,'financial_core.create') THEN RAISE EXCEPTION 'ASSET_DRAFT_EDIT_DENIED';END IF;
 IF jsonb_typeof(p_payload)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN('operation','date','quantity','amount','vat_amount','counterparty_id','due_date')) OR coalesce(p_payload->>'quantity','0') IN('NaN','Infinity','-Infinity') OR coalesce(p_payload->>'amount','0') IN('NaN','Infinity','-Infinity') OR coalesce(p_payload->>'vat_amount','0') IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'ASSET_OPERATION_INVALID';END IF;
 PERFORM id FROM public.financial_events WHERE id=e.id FOR UPDATE;
 SELECT * INTO r FROM public.asset_lifecycle_commands WHERE created_by=auth.uid() AND request_id=p_request_id;
 IF r.id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.financial_event_links WHERE event_id=r.financial_event_id AND organization_id=e.organization_id AND related_event_id=e.id AND link_type='CORRECTS') THEN RAISE EXCEPTION 'ASSET_REQUEST_CONFLICT';END IF;
  RETURN public.prepare_asset_lifecycle(c.asset_account_id,p_payload,p_request_id);
 END IF;
 IF e.status NOT IN('DRAFT','PLANNED','COMMITTED') OR EXISTS(SELECT 1 FROM public.financial_event_approvals WHERE event_id=e.id AND decision='APPROVED') THEN RAISE EXCEPTION 'ASSET_APPROVED_DRAFT_LOCKED';END IF;
 PERFORM public.transition_financial_event(e.id,'CANCELLED','Replace asset operation draft');
 result:=public.prepare_asset_lifecycle(c.asset_account_id,p_payload,p_request_id);
 INSERT INTO public.financial_event_links(organization_id,event_id,link_type,related_event_id,metadata) VALUES(e.organization_id,(result->>'financial_event_id')::uuid,'CORRECTS',e.id,jsonb_build_object('reason','DRAFT_AMENDMENT','created_by',auth.uid()));
 INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,new_data) VALUES(auth.uid(),'financial_event',e.id,'REPLACE_ASSET_DRAFT',jsonb_build_object('replacement_event_id',result->>'financial_event_id'));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.replace_asset_lifecycle_draft(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.replace_asset_lifecycle_draft(uuid,jsonb,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.replace_asset_lifecycle_draft(p_event_id uuid,p_payload jsonb,p_request_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.replace_asset_lifecycle_draft(p_event_id,p_payload,p_request_id); $$;
REVOKE ALL ON FUNCTION public.replace_asset_lifecycle_draft(uuid,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.replace_asset_lifecycle_draft(uuid,jsonb,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.asset_financial_reverse_block_reason(p_event_id uuid) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.financial_events%rowtype;asset uuid;tx uuid;c public.asset_lifecycle_commands%rowtype;amt numeric;
BEGIN
 IF auth.uid() IS NULL THEN RETURN 'UNAUTHORIZED';END IF;
 SELECT * INTO e FROM public.financial_events WHERE id=p_event_id;
 IF e.id IS NULL OR e.source_module NOT IN('ASSETS_INTEGRATION','ASSET_LIFECYCLE') THEN RETURN 'ASSET_EVENT_NOT_FOUND';END IF;
 SELECT coalesce(sum(abs(base_amount)),0) INTO amt FROM public.financial_event_lines WHERE event_id=e.id AND organization_id=e.organization_id;
 IF NOT public.has_organization_permission(e.organization_id,'assets.edit') OR NOT public.effective_organization_permission(e.organization_id,'financial_core.reverse',amt,e.base_currency) THEN RETURN 'ASSET_REVERSE_DENIED';END IF;
 IF e.status<>'ACTUAL' THEN RETURN 'ASSET_REVERSE_REQUIRES_POSTED';END IF;
 IF e.source_module='ASSETS_INTEGRATION' THEN SELECT asset_account_id,id INTO asset,tx FROM public.transactions WHERE id=e.source_record_id AND organization_id=e.organization_id;
 ELSE SELECT * INTO c FROM public.asset_lifecycle_commands WHERE id=e.source_record_id AND financial_event_id=e.id AND organization_id=e.organization_id;asset:=c.asset_account_id;tx:=c.transaction_id;END IF;
 IF asset IS NULL OR NOT EXISTS(SELECT 1 FROM public.asset_accounts WHERE id=asset AND organization_id=e.organization_id) THEN RETURN 'ASSET_EVENT_SCOPE_MISMATCH';END IF;
 IF EXISTS(SELECT 1 FROM public.financial_event_obligation_balances WHERE event_id=e.id AND organization_id=e.organization_id AND applied_base_amount<>0) THEN RETURN 'ASSET_REVERSE_HAS_SETTLEMENTS';END IF;
 IF EXISTS(SELECT 1 FROM public.financial_vat_source_bindings WHERE event_id=e.id AND organization_id=e.organization_id) THEN RETURN 'ASSET_REVERSE_HAS_VAT_DOCUMENT';END IF;
 IF EXISTS(SELECT 1 FROM public.vat_documents WHERE asset_transaction_id=tx AND organization_id=e.organization_id) THEN RETURN 'ASSET_REVERSE_HAS_VAT_DOCUMENT';END IF;
 IF e.source_module='ASSET_LIFECYCLE' AND EXISTS(SELECT 1 FROM public.asset_lifecycle_commands WHERE asset_account_id=asset AND applied_at>c.applied_at) THEN RETURN 'ASSET_REVERSAL_HAS_LATER_OPERATIONS';END IF;
 IF e.source_module='ASSETS_INTEGRATION' AND EXISTS(SELECT 1 FROM public.lots WHERE source_transaction_id=tx AND (remaining_quantity<>original_quantity OR remaining_value_base<>original_value_base)) THEN RETURN 'ASSET_PURCHASE_REVERSAL_HAS_STOCK_MOVEMENTS';END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.asset_financial_reverse_block_reason(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.asset_financial_reverse_block_reason(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.asset_financial_reverse_block_reason(p_event_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.asset_financial_reverse_block_reason(p_event_id); $$;
REVOKE ALL ON FUNCTION public.asset_financial_reverse_block_reason(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.asset_financial_reverse_block_reason(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.reverse_asset_financial_event(p_event_id uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.financial_events%rowtype;aid uuid;reason text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED';END IF;
 IF length(trim(coalesce(p_reason,'')))<5 OR length(p_reason)>500 THEN RAISE EXCEPTION 'REVERSAL_REASON_REQUIRED';END IF;
 SELECT * INTO e FROM public.financial_events WHERE id=p_event_id;
 reason:=public.asset_financial_reverse_block_reason(e.id);IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason;END IF;
 PERFORM id FROM public.financial_events WHERE id=e.id FOR UPDATE;
 IF e.source_module='ASSETS_INTEGRATION' THEN SELECT asset_account_id INTO aid FROM public.transactions WHERE id=e.source_record_id AND organization_id=e.organization_id;
 ELSE SELECT asset_account_id INTO aid FROM public.asset_lifecycle_commands WHERE id=e.source_record_id AND organization_id=e.organization_id AND financial_event_id=e.id;END IF;
 PERFORM id FROM public.asset_accounts WHERE id=aid AND organization_id=e.organization_id FOR UPDATE;
 PERFORM id FROM public.financial_event_obligations WHERE event_id=e.id AND organization_id=e.organization_id ORDER BY id FOR UPDATE;
 reason:=public.asset_financial_reverse_block_reason(e.id);IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason;END IF;
 PERFORM public.transition_financial_event(e.id,'REVERSED',trim(p_reason));
 INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,new_data) VALUES(auth.uid(),'financial_event',e.id,'REVERSE_ASSET_OPERATION',jsonb_build_object('reason',trim(p_reason)));
 RETURN jsonb_build_object('financial_event_id',e.id,'status','REVERSED');
END $$;
REVOKE ALL ON FUNCTION private.reverse_asset_financial_event(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.reverse_asset_financial_event(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.reverse_asset_financial_event(p_event_id uuid,p_reason text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.reverse_asset_financial_event(p_event_id,p_reason); $$;
REVOKE ALL ON FUNCTION public.reverse_asset_financial_event(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reverse_asset_financial_event(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.amend_asset_transaction_notes(p_transaction_id uuid,p_notes text,p_expected_notes text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.transactions%rowtype;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED';END IF;
 SELECT * INTO t FROM public.transactions WHERE id=p_transaction_id;
 IF t.id IS NULL OR t.user_id<>auth.uid() OR (t.organization_id IS NOT NULL AND NOT public.has_organization_permission(t.organization_id,'assets.edit')) THEN RAISE EXCEPTION 'TRANSACTION_EDIT_DENIED';END IF;
 PERFORM id FROM public.transactions WHERE id=t.id FOR UPDATE;
 SELECT * INTO t FROM public.transactions WHERE id=p_transaction_id;
 IF length(coalesce(p_notes,''))>2000 THEN RAISE EXCEPTION 'TRANSACTION_NOTES_TOO_LONG';END IF;
 IF coalesce(t.notes,'') IS DISTINCT FROM coalesce(p_expected_notes,'') THEN RAISE EXCEPTION 'TRANSACTION_EDIT_CONFLICT';END IF;
 UPDATE public.transactions SET notes=p_notes WHERE id=t.id;
 INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data) VALUES(auth.uid(),'transaction',t.id,'UPDATE_OPERATION_NOTES',jsonb_build_object('notes',t.notes),jsonb_build_object('notes',p_notes));
 RETURN jsonb_build_object('id',t.id,'notes',p_notes);
END $$;
REVOKE ALL ON FUNCTION private.amend_asset_transaction_notes(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.amend_asset_transaction_notes(uuid,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.amend_asset_transaction_notes(p_transaction_id uuid,p_notes text,p_expected_notes text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.amend_asset_transaction_notes(p_transaction_id,p_notes,p_expected_notes); $$;
REVOKE ALL ON FUNCTION public.amend_asset_transaction_notes(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.amend_asset_transaction_notes(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_financial_event(p_event_id uuid, p_new_status text, p_note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$declare e public.financial_events%rowtype;scope text;valid boolean:=false;asset_id uuid;block_reason text;begin select * into e from public.financial_events where id=p_event_id for update;if e.id is null then raise exception 'FINANCIAL_EVENT_NOT_FOUND';end if;if (e.status='DRAFT' and p_new_status in('PLANNED','CANCELLED')) or(e.status='PLANNED' and p_new_status in('COMMITTED','CANCELLED')) or(e.status='COMMITTED' and p_new_status in('ACTUAL','CANCELLED')) or(e.status='ACTUAL' and p_new_status='REVERSED') then valid:=true;end if;if not valid then raise exception 'INVALID_FINANCIAL_EVENT_TRANSITION:%->%',e.status,p_new_status;end if;scope:=case when p_new_status='ACTUAL' then case when e.event_type='REVERSAL' then 'financial_core.reverse' else 'financial_core.post' end when p_new_status='REVERSED' then 'financial_core.reverse' else 'financial_core.create' end;if not public.financial_core_can(e.organization_id,scope) then raise exception 'FINANCIAL_CORE_TRANSITION_DENIED';end if;if p_new_status='ACTUAL' and not public.financial_event_has_valid_approval(e.id) then raise exception 'VALID_APPROVAL_REQUIRED';end if;if p_new_status='ACTUAL' and (e.event_type='SETTLEMENT' or(e.event_type='REVERSAL' and exists(select 1 from public.financial_event_links l join public.liquidity_settlements s on s.financial_event_id=l.related_event_id where l.event_id=e.id and l.link_type='REVERSAL_OF'))) and not exists(select 1 from public.liquidity_settlements s where s.financial_event_id=e.id and s.organization_id=e.organization_id and s.status='POSTED') then raise exception 'CASH_POST_REQUIRES_ATOMIC_PATH';end if;
if p_new_status='REVERSED' and e.source_module in('ASSETS_INTEGRATION','ASSET_LIFECYCLE') then
 if e.source_module='ASSETS_INTEGRATION' then select asset_account_id into asset_id from public.transactions where id=e.source_record_id and organization_id=e.organization_id;else select asset_account_id into asset_id from public.asset_lifecycle_commands where id=e.source_record_id and financial_event_id=e.id and organization_id=e.organization_id;end if;
 perform id from public.asset_accounts where id=asset_id and organization_id=e.organization_id for update;
 perform id from public.financial_event_obligations where event_id=e.id and organization_id=e.organization_id order by id for update;
 block_reason:=public.asset_financial_reverse_block_reason(e.id);if block_reason is not null then raise exception '%',block_reason;end if;
end if;
if p_new_status='REVERSED' and exists(select 1 from public.liquidity_settlements s where s.financial_event_id=e.id and s.organization_id=e.organization_id and s.status='POSTED') then raise exception 'CASH_REVERSAL_REQUIRES_ATOMIC_PATH';end if;
update public.financial_events set status=p_new_status,updated_at=now(),posted_by=case when p_new_status='ACTUAL' then auth.uid() else posted_by end,posted_at=case when p_new_status='ACTUAL' then now() else posted_at end where id=e.id;insert into public.financial_event_status_history(event_id,organization_id,from_status,to_status,actor_id,note) values(e.id,e.organization_id,e.status,p_new_status,auth.uid(),p_note);return p_new_status;end$function$
;

CREATE OR REPLACE FUNCTION public.apply_asset_lifecycle_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  for st in select state.value from jsonb_array_elements(c.lot_states) as state(value) loop
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
end $function$;

COMMIT;
