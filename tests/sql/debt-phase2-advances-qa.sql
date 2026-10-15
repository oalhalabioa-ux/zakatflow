-- Synthetic QA fixtures only. Every row and balance change is rolled back.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE org uuid:='85acbac0-e8b4-434c-a22b-3ec13b55e1a7'; party uuid:='d86a111c-d392-4f09-adc1-13f9e72a1c53'; entity uuid:='d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe';
 bank uuid; cid uuid; p jsonb; e uuid; adv uuid; root uuid; ob uuid; flow uuid; app uuid; n numeric; side text; direction text; target text; err text; results jsonb:='[]'; op jsonb;opid uuid;opevent uuid;refundEvent uuid;
BEGIN
 bank:=(public.open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','ORGANIZATION','organization_id',org,'type','BANK','name','QA advance rollback bank','currency','SAR','opening_balance',1000,'opening_date','2026-10-01','fx_rate',1))->>'id')::uuid;
 PERFORM public.ensure_advance_classifications(org);
 FOREACH side IN ARRAY ARRAY['SUPPLIER_ADVANCE','CUSTOMER_ADVANCE'] LOOP
  direction:=case when side='SUPPLIER_ADVANCE' then 'OUTFLOW' else 'INFLOW' end;target:=case when side='SUPPLIER_ADVANCE' then 'PAYABLE' else 'RECEIVABLE' end;
  SELECT id INTO cid FROM financial_classifications WHERE organization_id=org AND classification_type=case when side='SUPPLIER_ADVANCE' then 'ASSET' else 'LIABILITY' end AND active LIMIT 1;
  p:=jsonb_build_object('organization_id',org,'entity_id',entity,'counterparty_id',party,'event_type','SETTLEMENT','source_module','ADVANCE_WORKSPACE','source_event_key','advance:'||gen_random_uuid(),'event_date','2026-10-14','due_date',null,'base_currency','SAR','description','QA advance rollback','lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',cid,'description','QA advance','amount',100,'currency','SAR','exchange_rate',1,'base_amount',100,'cash_direction',direction,'vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations',jsonb_build_array(jsonb_build_object('obligation_key','advance','obligation_type',side,'settleable_amount',100,'currency','SAR','exchange_rate',1,'base_currency','SAR','settleable_base_amount',100)),'links',jsonb_build_array(jsonb_build_object('link_type','OTHER','target_module','liquidity_accounts','target_record_id',bank,'metadata',jsonb_build_object('purpose','ADVANCE_REQUEST','kind','RECORD','account_id',bank,'reference','QA-ADV'))));
  e:=create_financial_event_command(p);IF create_financial_event_command(p)<>e THEN RAISE EXCEPTION 'ADVANCE_DUPLICATE_REQUEST';END IF;
  SELECT current_balance INTO n FROM liquidity_accounts WHERE id=bank;
  PERFORM transition_financial_event(e,'PLANNED','QA');PERFORM transition_financial_event(e,'COMMITTED','QA');
  BEGIN PERFORM post_advance_request(e);err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
  IF err<>'VALID_APPROVAL_REQUIRED' THEN RAISE EXCEPTION 'ADVANCE_APPROVAL_GUARD:%',err;END IF;
  IF(SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>n THEN RAISE EXCEPTION 'PENDING_MOVED_CASH';END IF;
  BEGIN UPDATE financial_event_links SET metadata=metadata||'{"account_id":"11111111-1111-4111-8111-111111111111"}' WHERE event_id=e AND link_type='OTHER';err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
  IF err NOT IN('ADVANCE_COMMITTED_REQUEST_IMMUTABLE','NOT_BLOCKED') OR (SELECT metadata->>'account_id' FROM financial_event_links WHERE event_id=e AND link_type='OTHER')<>bank::text THEN RAISE EXCEPTION 'ADVANCE_REQUEST_EDIT_GUARD:%',err;END IF;
  PERFORM set_config('request.jwt.claim.sub','8ec4c7f9-83b4-4307-9d5e-de7590fa121b',true);
  BEGIN PERFORM post_advance_request(e);err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
  IF err<>'ADVANCE_POST_DENIED' THEN RAISE EXCEPTION 'ADVANCE_PERMISSION_GUARD:%',err;END IF;
  PERFORM set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
  PERFORM approve_financial_event(e,'QA');PERFORM post_advance_request(e);PERFORM post_advance_request(e);
  IF(SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>n+(case when direction='OUTFLOW' then -100 else 100 end) THEN RAISE EXCEPTION 'ADVANCE_CASH_DUPLICATED';END IF;
  SELECT id INTO adv FROM financial_event_obligations WHERE event_id=e;
  IF(SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=adv)<>100 THEN RAISE EXCEPTION 'ADVANCE_NOT_OPEN';END IF;
  op:=prepare_debt_operation(jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'kind','REFUND','target_id',adv,'amount',30,'account_id',bank,'date','2026-10-15','reason','QA advance refund'));
  opid:=(op->>'id')::uuid;opevent:=(op->>'eventId')::uuid;refundEvent:=opevent;
  PERFORM approve_financial_event(opevent,'QA refund approval');PERFORM post_debt_operation(opid);PERFORM post_debt_operation(opid);
  IF(SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=adv)<>70 THEN RAISE EXCEPTION 'REFUND_BALANCE_WRONG';END IF;
  op:=prepare_debt_operation(jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'kind','REVERSE','target_id',refundEvent,'date','2026-10-15','reason','QA refund reversal'));
  opid:=(op->>'id')::uuid;opevent:=(op->>'eventId')::uuid;
  PERFORM approve_financial_event(opevent,'QA refund reverse approval');PERFORM post_debt_operation(opid);PERFORM post_debt_operation(opid);
  IF(SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=adv)<>100 THEN RAISE EXCEPTION 'REFUND_REVERSAL_BALANCE_WRONG';END IF;
  -- Recognize a separate 150 invoice with an expected cash flow.
  SELECT id INTO cid FROM financial_classifications WHERE organization_id=org AND classification_type=case when side='SUPPLIER_ADVANCE' then 'OPEX' else 'REVENUE' end AND active LIMIT 1;
  p:=jsonb_set(p,'{source_module}','"QA_ADVANCE_TEST"');p:=jsonb_set(p,'{source_event_key}',to_jsonb('qa-invoice:'||gen_random_uuid()));p:=jsonb_set(p,'{event_type}',to_jsonb(case when side='SUPPLIER_ADVANCE' then 'EXPENSE' else 'REVENUE' end));
  p:=jsonb_set(p,'{lines,0,classification_id}',to_jsonb(cid));p:=jsonb_set(p,'{lines,0,amount}','150');p:=jsonb_set(p,'{lines,0,base_amount}','150');p:=jsonb_set(p,'{lines,0,cash_direction}','"NON_CASH"');p:=jsonb_set(p,'{obligations,0,obligation_type}',to_jsonb(target));p:=jsonb_set(p,'{obligations,0,settleable_amount}','150');p:=jsonb_set(p,'{obligations,0,settleable_base_amount}','150');p:=jsonb_set(p,'{links}','[]');
  root:=create_financial_event_command(p);PERFORM transition_financial_event(root,'PLANNED','QA');PERFORM transition_financial_event(root,'COMMITTED','QA');PERFORM approve_financial_event(root,'QA');PERFORM transition_financial_event(root,'ACTUAL','QA');
  SELECT id INTO ob FROM financial_event_obligations WHERE event_id=root;
  INSERT INTO liquidity_flows(organization_id,entity_id,direction,title,counterparty_id,due_date,amount,currency,base_amount,status) VALUES(org,entity,direction,'QA invoice flow',party,'2026-10-14',150,'SAR',150,'EXPECTED') RETURNING id INTO flow;
  INSERT INTO financial_event_links(organization_id,event_id,link_type,target_module,target_record_id)VALUES(org,root,'CASH_FLOW','liquidity_flows',flow);
  SELECT id INTO cid FROM financial_classifications WHERE organization_id=org AND classification_type=target AND active LIMIT 1;
  p:=jsonb_set(p,'{source_module}','"ADVANCE_WORKSPACE"');p:=jsonb_set(p,'{event_type}','"ADJUSTMENT"');p:=jsonb_set(p,'{lines,0,classification_id}',to_jsonb(cid));p:=jsonb_set(p,'{obligations}','[]');
  FOREACH n IN ARRAY ARRAY[60::numeric,50::numeric,40::numeric] LOOP
   p:=jsonb_set(p,'{source_event_key}',to_jsonb('advance:'||gen_random_uuid()));p:=jsonb_set(p,'{lines,0,amount}',to_jsonb(n));p:=jsonb_set(p,'{lines,0,base_amount}',to_jsonb(n));
   p:=jsonb_set(p,'{links}',jsonb_build_array(jsonb_build_object('link_type','OTHER','target_module','financial_event_obligations','target_record_id',adv,'metadata',jsonb_build_object('purpose','ADVANCE_REQUEST','kind','APPLY','advance_id',adv,'obligation_id',ob,'flow_id',flow))));
   app:=create_financial_event_command(p);PERFORM transition_financial_event(app,'PLANNED','QA');PERFORM transition_financial_event(app,'COMMITTED','QA');PERFORM approve_financial_event(app,'QA');
   BEGIN PERFORM transition_financial_event(app,'ACTUAL','QA bypass');err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
   IF err<>'ADVANCE_USE_ATOMIC_POST' THEN RAISE EXCEPTION 'ADVANCE_DIRECT_POST_GUARD:%',err;END IF;
   IF n=50 THEN
    BEGIN PERFORM post_advance_request(app);err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
    IF err<>'ADVANCE_EXCEEDS_BALANCE' THEN RAISE EXCEPTION 'ADVANCE_OVERUSE_GUARD:%',err;END IF;
   ELSE
    PERFORM post_advance_request(app);PERFORM post_advance_request(app);
    IF n=60 AND(SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=adv)<>40 THEN RAISE EXCEPTION 'ADVANCE_PARTIAL_WRONG';END IF;
   END IF;
  END LOOP;
  IF(SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=adv)<>0 OR(SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=ob)<>50 OR(SELECT settled_amount FROM liquidity_flows WHERE id=flow)<>100 THEN RAISE EXCEPTION 'ADVANCE_RECONCILIATION_FAILED';END IF;
  IF(SELECT count(*) FROM liquidity_settlements WHERE financial_event_id IN(SELECT id FROM financial_events WHERE source_module='ADVANCE_WORKSPACE' AND id=app))<>0 THEN RAISE EXCEPTION 'APPLICATION_CREATED_CASH';END IF;
  IF(SELECT sum(base_amount) FROM financial_event_lines WHERE event_id=root)<>150 THEN RAISE EXCEPTION 'INVOICE_RECOGNITION_CHANGED';END IF;
  SELECT current_balance INTO n FROM liquidity_accounts WHERE id=bank;
  op:=prepare_debt_operation(jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'kind','REVERSE','target_id',app,'date','2026-10-15','reason','QA noncash application reversal'));
  opid:=(op->>'id')::uuid;opevent:=(op->>'eventId')::uuid;
  PERFORM approve_financial_event(opevent,'QA application reverse approval');PERFORM post_debt_operation(opid);PERFORM post_debt_operation(opid);
  IF(SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=adv)<>40 OR(SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=ob)<>90 OR(SELECT settled_amount FROM liquidity_flows WHERE id=flow)<>60 OR(SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>n THEN RAISE EXCEPTION 'NONCASH_APPLICATION_REVERSAL_WRONG';END IF;
  results:=results||jsonb_build_array(jsonb_build_object('side',side,'advance_remaining',0,'invoice_remaining',50,'applied',100,'cash_once',true));
 END LOOP;
 IF(SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>1000 THEN RAISE EXCEPTION 'APPLICATION_MOVED_BANK';END IF;
 PERFORM set_config('qa.advance.result',results::text,true);
END $test$;
SELECT current_setting('qa.advance.result')::jsonb result;
ROLLBACK;
