-- Opening edits are one atomic command: asset, source voucher and lot move together.
DO $guard$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.guard_asset_acquisition_edit()'::regprocedure) INTO definition;
 IF position('app.asset_opening_edit' IN definition)=0 THEN
  definition:=replace(definition,E'begin\n',E'begin\n if current_user=\'postgres\' and auth.uid() is not null and current_setting(\'app.asset_opening_edit\',true)=old.id::text and coalesce(old.metadata->>\'acquisition_mode\',\'OPENING_BALANCE\')=\'OPENING_BALANCE\' then return new;end if;\n');
  EXECUTE definition;
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION private.manage_asset_opening(p_asset_id uuid,p_action text,p_expected_updated_at timestamptz DEFAULT NULL,p_changes jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.asset_accounts%rowtype;t public.transactions%rowtype;l public.lots%rowtype;
 reason text;editable boolean;v_name text;v_date date;v_amount numeric;v_qty numeric;fx numeric;expected_fx numeric;v_purpose text;m jsonb;previous_context text;can_edit boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED';END IF;
 IF p_action NOT IN('INSPECT','UPDATE','ARCHIVE') OR p_action IS NULL THEN RAISE EXCEPTION 'ASSET_OPENING_ACTION_INVALID';END IF;
 -- Use the same lock as personal snapshot creation before locking the asset/lot.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('zakat-snapshot:'||auth.uid()::text,0));
 SELECT * INTO a FROM public.asset_accounts WHERE id=p_asset_id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION 'ASSET_NOT_FOUND';END IF;
 IF (a.ownership_scope='PERSONAL' AND a.user_id IS DISTINCT FROM auth.uid()) OR
    (a.ownership_scope='ORGANIZATION' AND NOT public.has_organization_permission(a.organization_id,'assets.view')) THEN RAISE EXCEPTION 'ASSET_OPENING_ACCESS_DENIED';END IF;
 can_edit:=CASE WHEN a.ownership_scope='PERSONAL' THEN a.user_id=auth.uid() ELSE public.has_organization_permission(a.organization_id,'assets.edit') END;
 PERFORM 1 FROM public.transactions WHERE asset_account_id=a.id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.lots WHERE asset_account_id=a.id ORDER BY id FOR UPDATE;
 SELECT * INTO t FROM public.transactions WHERE asset_account_id=a.id ORDER BY created_at,id LIMIT 1;
 SELECT * INTO l FROM public.lots WHERE asset_account_id=a.id ORDER BY created_at,id LIMIT 1;
 reason:=CASE
  WHEN NOT can_edit THEN 'ASSET_OPENING_EDIT_DENIED'
  WHEN a.metadata->>'archived'='true' THEN 'ASSET_OPENING_ARCHIVED'
  WHEN a.asset_type IN('CASH','BANK','RECEIVABLE') OR a.metadata ?| ARRAY['investment_id','register_source','financing_contract_id'] THEN 'ASSET_OPENING_OTHER_WORKSPACE'
  WHEN coalesce(a.metadata->>'acquisition_mode','OPENING_BALANCE')<>'OPENING_BALANCE' OR t.transaction_type<>'OPENING_BALANCE' OR t.id IS NULL OR l.id IS NULL THEN 'ASSET_OPENING_REQUIRED'
  WHEN t.reversal_of_transaction_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.transactions reversed WHERE reversed.reversal_of_transaction_id=t.id) OR t.transfer_id IS NOT NULL OR t.metadata->>'asset_deleted'='true' THEN 'ASSET_OPENING_LINKED'
  WHEN (SELECT count(*) FROM public.transactions WHERE asset_account_id=a.id)<>1 OR (SELECT count(*) FROM public.lots WHERE asset_account_id=a.id)<>1 OR l.source_transaction_id IS DISTINCT FROM t.id OR l.remaining_quantity IS DISTINCT FROM l.original_quantity OR l.remaining_value_base IS DISTINCT FROM l.original_value_base THEN 'ASSET_OPENING_LINKED'
  WHEN EXISTS(SELECT 1 FROM public.financial_events e WHERE e.source_record_id IN(a.id,t.id)) OR nullif(t.metadata->>'financial_event_id','') IS NOT NULL OR EXISTS(SELECT 1 FROM public.financial_event_links WHERE target_record_id IN(a.id,t.id,l.id)) THEN 'ASSET_OPENING_FINANCIAL_LINK'
  WHEN EXISTS(SELECT 1 FROM public.transaction_allocations WHERE transaction_id=t.id OR lot_id=l.id) OR EXISTS(SELECT 1 FROM public.transfers WHERE source_asset_account_id=a.id OR destination_asset_account_id=a.id) OR EXISTS(SELECT 1 FROM public.asset_lifecycle_commands WHERE asset_account_id=a.id) OR EXISTS(SELECT 1 FROM public.vat_documents WHERE asset_transaction_id=t.id) THEN 'ASSET_OPENING_LINKED'
  WHEN EXISTS(SELECT 1 FROM public.zakat_assessment_lines WHERE lot_id=l.id) OR EXISTS(SELECT 1 FROM public.zakat_payment_allocations WHERE asset_account_id=a.id OR lot_id=l.id) THEN 'ASSET_OPENING_ZAKAT_LINK'
  ELSE NULL END;
 editable:=reason IS NULL;
 IF p_action='INSPECT' THEN RETURN jsonb_build_object('asset',to_jsonb(a),'can_edit',editable,'can_archive',editable,'block_reason',reason);END IF;
 IF NOT editable THEN RAISE EXCEPTION '%',reason;END IF;
 IF p_expected_updated_at IS NULL OR a.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'ASSET_EDIT_CONFLICT';END IF;
 previous_context:=pg_catalog.current_setting('app.asset_opening_edit',true);
 IF p_action='UPDATE' THEN
  IF jsonb_typeof(p_changes)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN('name','date','amount','quantity','purpose','fx_rate','fx_rate_id','fx_rate_date','fx_rate_source')) THEN RAISE EXCEPTION 'ASSET_OPENING_CHANGE_FIELDS_INVALID';END IF;
  v_name:=btrim(p_changes->>'name');v_date:=(p_changes->>'date')::date;v_amount:=(p_changes->>'amount')::numeric;v_qty:=(p_changes->>'quantity')::numeric;fx:=(p_changes->>'fx_rate')::numeric;v_purpose:=coalesce(p_changes->>'purpose','');
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 200 OR v_date IS NULL OR v_amount IS NULL OR v_amount<=0 OR v_qty IS NULL OR v_qty<=0 OR fx IS NULL OR fx<=0 OR v_amount::text IN('NaN','Infinity','-Infinity') OR v_qty::text IN('NaN','Infinity','-Infinity') OR fx::text IN('NaN','Infinity','-Infinity') OR length(v_purpose)>2000 THEN RAISE EXCEPTION 'ASSET_OPENING_VALUES_INVALID';END IF;
  IF a.currency=t.base_currency AND fx<>1 THEN RAISE EXCEPTION 'ASSET_OPENING_FX_INVALID';END IF;
  IF a.currency<>t.base_currency THEN
   SELECT CASE WHEN f.from_currency=a.currency THEN f.rate ELSE 1/f.rate END INTO expected_fx FROM public.fx_rates f
    WHERE (f.organization_id IS NULL OR f.organization_id=a.organization_id) AND f.valuation_date<=v_date AND f.rate>0
      AND ((f.from_currency=a.currency AND f.to_currency=t.base_currency) OR (f.to_currency=a.currency AND f.from_currency=t.base_currency))
    ORDER BY (f.organization_id IS NOT NULL) DESC,f.valuation_date DESC,f.id DESC LIMIT 1;
   IF expected_fx IS NULL OR abs(expected_fx-fx)>0.00000001 THEN RAISE EXCEPTION 'ASSET_SAVED_FX_RATE_MISSING';END IF;
  END IF;
  m:=a.metadata||jsonb_build_object('quantity',v_qty,'purchase_value',v_amount,'opening_value',v_amount,'purchase_price',v_amount/v_qty,'purchase_date',v_date,'purpose',v_purpose,'acquisition_cost_base',v_amount*fx,'fx_rate',fx,'fx_rate_id',p_changes->'fx_rate_id','fx_rate_date',p_changes->'fx_rate_date','fx_rate_source',p_changes->'fx_rate_source');
  IF a.metadata->>'market_value' IS NULL OR (a.metadata->>'market_value')::numeric=coalesce((a.metadata->>'purchase_value')::numeric,(a.metadata->>'opening_value')::numeric) THEN m:=m||jsonb_build_object('market_value',v_amount,'estimated_value',v_amount);END IF;
  IF a.metadata->>'market_price_source'='ACQUISITION_COST' THEN m:=m||jsonb_build_object('market_price',v_amount/v_qty,'market_price_per_unit',v_amount/v_qty,'market_valuation_date',v_date);END IF;
  PERFORM pg_catalog.set_config('app.asset_opening_edit',a.id::text,true);
  UPDATE public.asset_accounts SET name=v_name,metadata=m,updated_at=clock_timestamp() WHERE id=a.id;
  UPDATE public.transactions SET transaction_date=v_date,quantity=v_qty,unit_price=v_amount/v_qty,gross_value=v_amount,base_value=v_amount*fx,metadata=metadata||m WHERE id=t.id;
  UPDATE public.lots SET acquisition_date=v_date,original_quantity=v_qty,remaining_quantity=v_qty,original_value_base=v_amount*fx,remaining_value_base=v_amount*fx,
   hawl_start_date=CASE WHEN hawl_start_date=t.transaction_date THEN v_date ELSE hawl_start_date END,
   origin_hawl_start_date=CASE WHEN origin_hawl_start_date=t.transaction_date THEN v_date ELSE origin_hawl_start_date END,
   nisab_reached_date=CASE WHEN nisab_reached_date=t.transaction_date THEN v_date ELSE nisab_reached_date END,
   zakatable_pool_entered_date=CASE WHEN zakatable_pool_entered_date=t.transaction_date THEN v_date ELSE zakatable_pool_entered_date END,
   hawl_due_date=CASE WHEN hawl_start_date=t.transaction_date THEN NULL ELSE hawl_due_date END WHERE id=l.id;
 ELSE
  UPDATE public.lots SET remaining_quantity=0,remaining_value_base=0,status='CLOSED',metadata=metadata||jsonb_build_object('opening_archived',true) WHERE id=l.id;
  UPDATE public.transactions SET metadata=metadata||jsonb_build_object('asset_deleted',true,'deleted_at',clock_timestamp(),'deleted_by',auth.uid()) WHERE id=t.id;
  UPDATE public.asset_accounts SET metadata=metadata||jsonb_build_object('archived',true,'archived_at',clock_timestamp(),'archived_by',auth.uid()),updated_at=clock_timestamp() WHERE id=a.id;
 END IF;
 PERFORM pg_catalog.set_config('app.asset_opening_edit',coalesce(previous_context,''),true);
 INSERT INTO public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data) VALUES(auth.uid(),'asset_account',a.id,CASE WHEN p_action='UPDATE' THEN 'AMEND_OPENING_BALANCE' ELSE 'ARCHIVE_OPENING_BALANCE' END,to_jsonb(a),jsonb_build_object('transaction_id',t.id,'changes',p_changes-'fx_rate_id'));
 SELECT * INTO a FROM public.asset_accounts WHERE id=p_asset_id;
 RETURN jsonb_build_object('asset',to_jsonb(a),'archived',p_action='ARCHIVE','can_edit',p_action='UPDATE','can_archive',p_action='UPDATE','block_reason',NULL);
END $$;
REVOKE ALL ON FUNCTION private.manage_asset_opening(uuid,text,timestamptz,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.manage_asset_opening(uuid,text,timestamptz,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.manage_asset_opening(p_asset_id uuid,p_action text,p_expected_updated_at timestamptz DEFAULT NULL,p_changes jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.manage_asset_opening(p_asset_id,p_action,p_expected_updated_at,p_changes); $$;
REVOKE ALL ON FUNCTION public.manage_asset_opening(uuid,text,timestamptz,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_asset_opening(uuid,text,timestamptz,jsonb) TO authenticated;
