BEGIN;
CREATE OR REPLACE FUNCTION public.guard_asset_acquisition_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare k text;
begin
 if current_user='postgres' and auth.uid() is not null and old.ownership_scope='ORGANIZATION' and new.organization_id=old.organization_id and public.has_organization_permission(old.organization_id,'assets.edit') and exists(select 1 from public.transactions t join public.financial_events e on e.id=nullif(t.metadata->>'financial_event_id','')::uuid and e.organization_id=t.organization_id where t.asset_account_id=old.id and t.transaction_type='PURCHASE' and e.source_module='ASSETS_INTEGRATION' and e.status in('DRAFT','PLANNED','COMMITTED') and not exists(select 1 from public.financial_event_approvals p where p.event_id=e.id and p.decision='APPROVED')) then return new;end if;
 if exists(select 1 from public.transactions where asset_account_id=old.id)
    or exists(select 1 from public.lots where asset_account_id=old.id) then
  if row(new.user_id,new.asset_type,new.currency,new.unit,new.ownership_scope,new.organization_id,new.entity_id,new.cost_center_id,new.asset_class_code,new.asset_type_code)
    is distinct from row(old.user_id,old.asset_type,old.currency,old.unit,old.ownership_scope,old.organization_id,old.entity_id,old.cost_center_id,old.asset_class_code,old.asset_type_code) then
   raise exception 'ASSET_FINANCIAL_FIELDS_LOCKED';
  end if;
  foreach k in array array['quantity','purchase_value','opening_value','purchase_price','karat','purity','fx_rate','vat_amount','vat_rate','recoverable_percent'] loop
   if coalesce(nullif(new.metadata->>k,'')::numeric,0) is distinct from coalesce(nullif(old.metadata->>k,'')::numeric,0) then
    raise exception 'ASSET_FINANCIAL_FIELDS_LOCKED';
   end if;
  end loop;
  foreach k in array array['vat_input_mode','purchase_date','acquisition_mode','funding_account_id','acquisition_base_currency','counterparty_id','invoice_reference','due_date'] loop
   if new.metadata->>k is distinct from old.metadata->>k then raise exception 'ASSET_FINANCIAL_FIELDS_LOCKED';end if;
  end loop;
 end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION private.amend_asset_purchase_draft(p_asset_id uuid,p_changes jsonb,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public','private','extensions' AS $$
DECLARE a public.asset_accounts%rowtype;t public.transactions%rowtype;e public.financial_events%rowtype;m jsonb;net numeric;vat numeric;rate numeric;recover numeric;qty numeric;fx numeric;cost numeric;dt date;due date;party uuid;ref text;cid uuid;taxid uuid;payload jsonb;norm jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED';END IF;
 SELECT * INTO a FROM public.asset_accounts WHERE id=p_asset_id;
 SELECT * INTO t FROM public.transactions WHERE asset_account_id=a.id AND transaction_type='PURCHASE' ORDER BY created_at LIMIT 1;
 SELECT * INTO e FROM public.financial_events WHERE id=nullif(t.metadata->>'financial_event_id','')::uuid AND organization_id=a.organization_id FOR UPDATE;
 SELECT * INTO a FROM public.asset_accounts WHERE id=p_asset_id FOR UPDATE;
 SELECT * INTO t FROM public.transactions WHERE id=t.id FOR UPDATE;
 IF a.id IS NULL OR a.ownership_scope<>'ORGANIZATION' OR e.id IS NULL OR e.source_module<>'ASSETS_INTEGRATION' OR e.source_record_id<>t.id THEN RAISE EXCEPTION 'ASSET_PURCHASE_DRAFT_REQUIRED';END IF;
 IF NOT public.has_organization_permission(a.organization_id,'assets.edit') OR NOT public.financial_core_can(a.organization_id,'financial_core.create') THEN RAISE EXCEPTION 'ASSET_PURCHASE_EDIT_DENIED';END IF;
 IF p_expected_updated_at IS NULL OR a.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'ASSET_EDIT_CONFLICT';END IF;
 IF e.status NOT IN('DRAFT','PLANNED','COMMITTED') OR EXISTS(SELECT 1 FROM public.financial_event_approvals WHERE event_id=e.id AND decision='APPROVED') OR EXISTS(SELECT 1 FROM public.financial_event_obligation_allocations x JOIN public.financial_event_obligations o ON o.id=x.obligation_id WHERE o.event_id=e.id) OR EXISTS(SELECT 1 FROM public.asset_lifecycle_commands WHERE asset_account_id=a.id) OR EXISTS(SELECT 1 FROM public.vat_documents WHERE asset_transaction_id=t.id) THEN RAISE EXCEPTION 'ASSET_FINANCIAL_FIELDS_LOCKED';END IF;
 IF (SELECT count(*) FROM public.transactions WHERE asset_account_id=a.id)<>1 OR EXISTS(SELECT 1 FROM public.transaction_allocations x JOIN public.lots l ON l.id=x.lot_id WHERE l.asset_account_id=a.id) THEN RAISE EXCEPTION 'ASSET_HAS_DOWNSTREAM_MOVEMENTS';END IF;
 IF jsonb_typeof(p_changes)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN('purchase_value','quantity','fx_rate','vat_input_mode','vat_rate','vat_amount','recoverable_percent','purchase_date','due_date','counterparty_id','invoice_reference')) THEN RAISE EXCEPTION 'ASSET_PURCHASE_CHANGE_FIELDS_INVALID';END IF;
 m:=a.metadata||p_changes;
 net:=(m->>'purchase_value')::numeric;qty:=(m->>'quantity')::numeric;fx:=(m->>'fx_rate')::numeric;recover:=(m->>'recoverable_percent')::numeric;dt:=(m->>'purchase_date')::date;due:=(m->>'due_date')::date;party:=(m->>'counterparty_id')::uuid;ref:=trim(m->>'invoice_reference');
 IF coalesce(m->>'vat_input_mode','') NOT IN('AMOUNT','PERCENT') THEN RAISE EXCEPTION 'ASSET_VAT_MODE_INVALID';END IF;
 IF m->>'vat_input_mode'='PERCENT' THEN rate:=(m->>'vat_rate')::numeric;IF rate<0 OR rate>100 THEN RAISE EXCEPTION 'ASSET_VAT_RATE_INVALID';END IF;vat:=round(net*rate/100,2);ELSE vat:=(m->>'vat_amount')::numeric;END IF;
 IF net::text IN('NaN','Infinity','-Infinity') OR qty::text IN('NaN','Infinity','-Infinity') OR fx::text IN('NaN','Infinity','-Infinity') OR vat::text IN('NaN','Infinity','-Infinity') OR recover::text IN('NaN','Infinity','-Infinity') OR net IS NULL OR net<=0 OR qty IS NULL OR qty<=0 OR fx IS NULL OR fx<=0 OR vat IS NULL OR vat<0 OR recover IS NULL OR recover<0 OR recover>100 OR dt IS NULL OR due IS NULL OR due<dt OR ref IS NULL OR ref='' THEN RAISE EXCEPTION 'ASSET_PURCHASE_VALUES_INVALID';END IF;
 IF a.currency=e.base_currency AND fx<>1 THEN RAISE EXCEPTION 'ASSET_PURCHASE_FX_INVALID';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.liquidity_counterparties WHERE id=party AND organization_id=a.organization_id AND party_type IN('SUPPLIER','BOTH') AND active) THEN RAISE EXCEPTION 'ASSET_SUPPLIER_SCOPE_MISMATCH';END IF;
 cost:=net+vat*(1-recover/100);
 SELECT l.classification_id INTO cid FROM public.financial_event_lines l JOIN public.financial_classifications c ON c.id=l.classification_id WHERE l.event_id=e.id AND c.classification_type<>'TAX' ORDER BY l.line_number LIMIT 1;
 SELECT id INTO taxid FROM public.financial_classifications WHERE organization_id=a.organization_id AND classification_type='TAX' AND active ORDER BY is_system DESC LIMIT 1;
 IF cid IS NULL OR (vat*recover>0 AND taxid IS NULL) THEN RAISE EXCEPTION 'ASSET_FINANCIAL_CLASSIFICATION_REQUIRED';END IF;
 IF (a.metadata->>'market_value')::numeric=(a.metadata->>'purchase_value')::numeric THEN m:=m||jsonb_build_object('market_value',net);END IF;
 IF (a.metadata->>'estimated_value')::numeric=(a.metadata->>'purchase_value')::numeric THEN m:=m||jsonb_build_object('estimated_value',net);END IF;
 m:=m||jsonb_build_object('vat_amount',vat,'acquisition_cost_base',cost*fx,'purchase_price',net/qty);
 UPDATE public.financial_events SET counterparty_id=party,event_date=dt,due_date=due,description='Asset purchase / '||a.name,updated_at=now() WHERE id=e.id;
 UPDATE public.financial_event_lines SET amount=cost,base_amount=cost*fx,exchange_rate=fx WHERE event_id=e.id AND classification_id=cid;
 IF vat*recover>0 THEN
  UPDATE public.financial_event_lines SET amount=vat*recover/100,base_amount=vat*recover/100*fx,exchange_rate=fx WHERE event_id=e.id AND classification_id=taxid;
  IF NOT FOUND THEN INSERT INTO public.financial_event_lines(event_id,organization_id,line_number,description,classification_id,cost_center_id,amount,currency,exchange_rate,base_amount,cash_direction,vat_treatment) VALUES(e.id,a.organization_id,2,'Recoverable VAT / '||a.name,taxid,a.cost_center_id,vat*recover/100,a.currency,fx,vat*recover/100*fx,'NON_CASH','OUT_OF_SCOPE');END IF;
 ELSE DELETE FROM public.financial_event_lines WHERE event_id=e.id AND classification_id=taxid;END IF;
 UPDATE public.financial_event_obligations SET settleable_amount=net+vat,settleable_base_amount=(net+vat)*fx,exchange_rate=fx WHERE event_id=e.id;
 UPDATE public.asset_accounts SET metadata=m,updated_at=now() WHERE id=a.id RETURNING * INTO a;
 UPDATE public.transactions SET quantity=qty,unit_price=net/qty,gross_value=net,base_value=net*fx,transaction_date=dt,reference=ref,metadata=metadata||m WHERE id=t.id;
 UPDATE public.lots SET original_quantity=qty,remaining_quantity=qty,original_value_base=cost*fx,remaining_value_base=cost*fx,acquisition_date=dt WHERE source_transaction_id=t.id;
 UPDATE public.liquidity_flows f SET amount=net+vat,base_amount=(net+vat)*fx,due_date=due,counterparty_id=party,counterparty=(SELECT name FROM public.liquidity_counterparties WHERE id=party),reference=ref,updated_at=now() FROM public.financial_event_links l WHERE l.event_id=e.id AND l.link_type='CASH_FLOW' AND l.target_module='liquidity_flows' AND l.target_record_id=f.id AND f.organization_id=a.organization_id AND f.settled_amount=0;
 SELECT canonical_payload INTO payload FROM public.financial_event_command_registry WHERE financial_event_id=e.id AND command_type='EVENT_CREATE';
 payload:=payload||jsonb_build_object('counterparty_id',party,'event_date',dt,'due_date',due);
 payload:=jsonb_set(payload,'{lines}',(SELECT jsonb_agg(to_jsonb(l)-'id'-'event_id'-'organization_id'-'created_at' ORDER BY l.line_number) FROM public.financial_event_lines l WHERE l.event_id=e.id));
 payload:=jsonb_set(payload,'{obligations}',(SELECT jsonb_agg(to_jsonb(o)-'id'-'event_id'-'organization_id'-'created_by'-'created_at') FROM public.financial_event_obligations o WHERE o.event_id=e.id));
 norm:=private.canonical_financial_json(payload);
 UPDATE public.financial_event_command_registry SET canonical_payload=norm,payload_fingerprint=encode(extensions.digest(convert_to(norm::text,'UTF8'),'sha256'),'hex') WHERE financial_event_id=e.id AND command_type='EVENT_CREATE';
 UPDATE public.transactions SET metadata=metadata||jsonb_build_object('financial_core_intent',payload) WHERE id=t.id;
 INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,new_data) VALUES(auth.uid(),'asset_account',a.id,'AMEND_PURCHASE_DRAFT',jsonb_build_object('event_id',e.id,'net',net,'vat',vat,'gross',net+vat));
 RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION private.amend_asset_purchase_draft(uuid,jsonb,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.amend_asset_purchase_draft(uuid,jsonb,timestamptz) TO authenticated;
CREATE OR REPLACE FUNCTION public.amend_asset_purchase_draft(p_asset_id uuid,p_changes jsonb,p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.amend_asset_purchase_draft(p_asset_id,p_changes,p_expected_updated_at); $$;
REVOKE ALL ON FUNCTION public.amend_asset_purchase_draft(uuid,jsonb,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.amend_asset_purchase_draft(uuid,jsonb,timestamptz) TO authenticated;
CREATE OR REPLACE FUNCTION private.archive_asset_purchase_draft(p_asset_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public' AS $$
DECLARE a public.asset_accounts%rowtype; eid uuid; e public.financial_events%rowtype;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED';END IF;
 SELECT * INTO a FROM public.asset_accounts WHERE id=p_asset_id;
 SELECT nullif(t.metadata->>'financial_event_id','')::uuid INTO eid FROM public.transactions t WHERE t.asset_account_id=a.id AND t.transaction_type='PURCHASE' ORDER BY t.created_at LIMIT 1;
 SELECT * INTO e FROM public.financial_events WHERE id=eid AND organization_id=a.organization_id FOR UPDATE;
 SELECT * INTO a FROM public.asset_accounts WHERE id=p_asset_id FOR UPDATE;
 IF a.id IS NULL OR e.id IS NULL OR a.ownership_scope<>'ORGANIZATION' OR e.source_module<>'ASSETS_INTEGRATION' OR NOT public.has_organization_permission(a.organization_id,'assets.edit') OR NOT public.financial_core_can(a.organization_id,'financial_core.create') THEN RAISE EXCEPTION 'ASSET_PURCHASE_DELETE_DENIED';END IF;
 IF e.status NOT IN('DRAFT','PLANNED','COMMITTED','CANCELLED') OR EXISTS(SELECT 1 FROM public.financial_event_approvals WHERE event_id=e.id AND decision='APPROVED') OR EXISTS(SELECT 1 FROM public.vat_documents WHERE asset_transaction_id=e.source_record_id) OR EXISTS(SELECT 1 FROM public.asset_lifecycle_commands WHERE asset_account_id=a.id) THEN RAISE EXCEPTION 'ASSET_PROTECTED';END IF;
 IF e.status<>'CANCELLED' THEN PERFORM public.transition_financial_event(e.id,'CANCELLED','Archive unposted asset purchase');END IF;
 UPDATE public.asset_accounts SET metadata=metadata||jsonb_build_object('archived',true,'archived_by',auth.uid(),'archived_at',now()),updated_at=now() WHERE id=a.id;
 INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,new_data) VALUES(auth.uid(),'asset_account',a.id,'ARCHIVE_PURCHASE_DRAFT',jsonb_build_object('event_id',e.id));
 RETURN jsonb_build_object('id',a.id,'archived',true,'financial_event_status','CANCELLED');
END $$;
REVOKE ALL ON FUNCTION private.archive_asset_purchase_draft(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.archive_asset_purchase_draft(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.archive_asset_purchase_draft(p_asset_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.archive_asset_purchase_draft(p_asset_id); $$;
REVOKE ALL ON FUNCTION public.archive_asset_purchase_draft(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.archive_asset_purchase_draft(uuid) TO authenticated;
COMMIT;

