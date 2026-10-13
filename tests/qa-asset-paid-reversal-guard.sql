BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE a jsonb; aid uuid; tx uuid; event uuid; ob uuid; flow uuid; bank uuid:='dd7cce04-d75c-4880-ac03-77f0f82d6a3a'; base_balance numeric; n numeric; p jsonb; payment uuid; first_payment uuid; amount numeric; r jsonb; request uuid:=gen_random_uuid(); replay_error text; excess_error text; reversal uuid; original_settlement uuid; guard_error text; results jsonb:='{}';
BEGIN
 SELECT current_balance INTO base_balance FROM liquidity_accounts WHERE id=bank;
 a:=create_asset_with_acquisition('{"asset_type":"OTHER","name":"QA parity asset 20261012 rollback","currency":"SAR","unit":"unit","is_zakatable":false,"ownership_scope":"ORGANIZATION","organization_id":"85acbac0-e8b4-434c-a22b-3ec13b55e1a7","entity_id":"d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe","cost_center_id":null,"asset_class_code":"PPE","asset_type_code":"IT_EQUIPMENT","metadata":{"acquisition_mode":"PURCHASE","quantity":1,"purchase_value":100,"purchase_date":"2026-10-12","vat_amount":15,"recoverable_percent":100,"fx_rate":1,"counterparty_id":"d86a111c-d392-4f09-adc1-13f9e72a1c53","invoice_reference":"QA-PARITY-ASSET-ROLLBACK","due_date":"2026-11-12"}}'::jsonb,request);
 aid:=(a->>'id')::uuid;tx:=(a->>'acquisition_transaction_id')::uuid;event:=(a->>'financial_event_id')::uuid;
 IF aid IS NULL OR tx IS NULL OR event IS NULL THEN RAISE EXCEPTION 'ASSET_RESULT_IDS_MISSING';END IF;
 IF (SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>base_balance THEN RAISE EXCEPTION 'RECOGNITION_MOVED_CASH';END IF;
 IF (SELECT count(*) FROM financial_events WHERE source_module='ASSETS_INTEGRATION' AND source_record_id=tx)<>1 THEN RAISE EXCEPTION 'ASSET_DUPLICATE_EVENT';END IF;
 a:=create_asset_with_acquisition('{"asset_type":"OTHER","name":"QA parity asset 20261012 rollback","currency":"SAR","unit":"unit","is_zakatable":false,"ownership_scope":"ORGANIZATION","organization_id":"85acbac0-e8b4-434c-a22b-3ec13b55e1a7","entity_id":"d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe","cost_center_id":null,"asset_class_code":"PPE","asset_type_code":"IT_EQUIPMENT","metadata":{"acquisition_mode":"PURCHASE","quantity":1,"purchase_value":100,"purchase_date":"2026-10-12","vat_amount":15,"recoverable_percent":100,"fx_rate":1,"counterparty_id":"d86a111c-d392-4f09-adc1-13f9e72a1c53","invoice_reference":"QA-PARITY-ASSET-ROLLBACK","due_date":"2026-11-12"}}'::jsonb,request);
 IF (a->>'id')::uuid<>aid THEN RAISE EXCEPTION 'ASSET_IDEMPOTENCY_FAILED';END IF;
 PERFORM transition_financial_event(event,'PLANNED','QA parity rollback');
 PERFORM transition_financial_event(event,'COMMITTED','QA parity rollback');
 PERFORM approve_financial_event(event,'QA parity rollback');
 PERFORM transition_financial_event(event,'ACTUAL','QA parity rollback');
 SELECT id INTO ob FROM financial_event_obligations WHERE event_id=event;
 SELECT target_record_id INTO flow FROM financial_event_links WHERE event_id=event AND link_type='CASH_FLOW';
 IF (SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=ob)<>115 THEN RAISE EXCEPTION 'ASSET_DUE_NOT_115';END IF;
 IF (SELECT sum(l.base_amount) FROM financial_event_lines l JOIN financial_classifications c ON c.id=l.classification_id WHERE l.event_id=event AND c.classification_type='CAPEX')<>100 THEN RAISE EXCEPTION 'ASSET_CAPEX_NOT_100';END IF;
 IF (SELECT sum(l.base_amount) FROM financial_event_lines l JOIN financial_classifications c ON c.id=l.classification_id WHERE l.event_id=event AND c.classification_type='TAX')<>15 THEN RAISE EXCEPTION 'ASSET_TAX_NOT_15';END IF;
 IF flow IS NULL OR (SELECT f.amount FROM liquidity_flows f WHERE f.id=flow)<>115 THEN RAISE EXCEPTION 'ASSET_FORECAST_NOT_115';END IF;
 FOREACH amount IN ARRAY ARRAY[50::numeric,100::numeric,65::numeric] LOOP
  p:=jsonb_build_object('organization_id','85acbac0-e8b4-434c-a22b-3ec13b55e1a7','entity_id','d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe','counterparty_id','d86a111c-d392-4f09-adc1-13f9e72a1c53','event_type','SETTLEMENT','source_module','OPERATIONAL_CONSOLE','source_event_key','qa-parity-payment-'||request||'-'||amount,'event_date','2026-10-12','due_date','2026-10-12','base_currency','SAR','description','QA parity rollback payment','lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id','72251a98-0db8-49e1-9786-8e7f5742253f','description','QA payment','amount',amount,'currency','SAR','exchange_rate',1,'base_amount',amount,'cash_direction','OUTFLOW','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations','[]'::jsonb,'links',jsonb_build_array(jsonb_build_object('link_type','SETTLEMENT_OF','related_event_id',event)));
  payment:=create_financial_event_command(p);
  IF create_financial_event_command(p)<>payment THEN RAISE EXCEPTION 'PAYMENT_CREATION_IDEMPOTENCY_FAILED';END IF;
  PERFORM transition_financial_event(payment,'PLANNED','QA');
  PERFORM transition_financial_event(payment,'COMMITTED','QA');
  PERFORM approve_financial_event(payment,'QA');
  IF amount=100 THEN
   BEGIN
    PERFORM post_financial_settlement(payment,bank,'OUTFLOW','2026-10-12',100,'SAR',1,100,jsonb_build_array(jsonb_build_object('obligation_id',ob,'flow_id',flow,'amount',100,'base_amount',100,'flow_amount',100,'flow_currency','SAR','flow_exchange_rate',1)));
    excess_error:='NOT_BLOCKED';
   EXCEPTION WHEN OTHERS THEN excess_error:=SQLERRM;END;
   IF excess_error NOT IN ('FINANCIAL_CORE_OVER_SETTLEMENT','SETTLEMENT_EXCEEDS_FLOW_OUTSTANDING') THEN RAISE EXCEPTION 'OVERPAYMENT_GUARD_FAILED:%',excess_error;END IF;
   CONTINUE;
  END IF;
  r:=post_financial_settlement(payment,bank,'OUTFLOW','2026-10-12',amount,'SAR',1,amount,jsonb_build_array(jsonb_build_object('obligation_id',ob,'flow_id',flow,'amount',amount,'base_amount',amount,'flow_amount',amount,'flow_currency','SAR','flow_exchange_rate',1)));
  IF amount=50 THEN
   first_payment:=payment;
   IF (SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=ob)<>65 THEN RAISE EXCEPTION 'PARTIAL_PAYMENT_BALANCE_NOT_65';END IF;
  END IF;
 END LOOP;
 IF (SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=ob)<>0 THEN RAISE EXCEPTION 'FULL_PAYMENT_BALANCE_NOT_ZERO';END IF;
 IF (SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>base_balance-115 THEN RAISE EXCEPTION 'BANK_MOVEMENT_NOT_115';END IF;
 IF (SELECT settled_amount FROM liquidity_flows WHERE id=flow)<>115 THEN RAISE EXCEPTION 'FORECAST_SETTLED_NOT_115';END IF;
 BEGIN PERFORM reverse_asset_financial_event(event,'QA paid purchase reverse');guard_error:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN guard_error:=SQLERRM;END;
 IF guard_error<>'ASSET_REVERSE_HAS_SETTLEMENTS' THEN RAISE EXCEPTION 'PAID_PURCHASE_REVERSE_NOT_BLOCKED:%',guard_error;END IF;
 BEGIN PERFORM transition_financial_event(event,'REVERSED','QA direct paid reverse');guard_error:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN guard_error:=SQLERRM;END;
 IF guard_error<>'ASSET_REVERSE_HAS_SETTLEMENTS' THEN RAISE EXCEPTION 'DIRECT_PAID_PURCHASE_REVERSE_NOT_BLOCKED:%',guard_error;END IF;
 BEGIN
  PERFORM post_financial_settlement(payment,bank,'OUTFLOW','2026-10-12',65,'SAR',1,65,jsonb_build_array(jsonb_build_object('obligation_id',ob,'flow_id',flow,'amount',65,'base_amount',65,'flow_amount',65,'flow_currency','SAR','flow_exchange_rate',1)));
  replay_error:='none';
 EXCEPTION WHEN OTHERS THEN replay_error:=SQLERRM; END;
 IF (SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>base_balance-115 THEN RAISE EXCEPTION 'REPLAY_DUPLICATED_CASH';END IF;

 BEGIN PERFORM transition_financial_event(first_payment,'REVERSED','QA reversal rollback');guard_error:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN guard_error:=SQLERRM;END;
 IF guard_error<>'CASH_REVERSAL_REQUIRES_ATOMIC_PATH' THEN RAISE EXCEPTION 'DIRECT_REVERSAL_GUARD_FAILED:%',guard_error;END IF;
 p:=jsonb_set(p,'{event_type}','"REVERSAL"'::jsonb);p:=jsonb_set(p,'{source_event_key}',to_jsonb('qa-atomic-reversal-'||request));p:=jsonb_set(p,'{lines,0,amount}','50'::jsonb);p:=jsonb_set(p,'{lines,0,base_amount}','50'::jsonb);p:=jsonb_set(p,'{lines,0,cash_direction}','"INFLOW"'::jsonb);p:=jsonb_set(p,'{links}',jsonb_build_array(jsonb_build_object('link_type','REVERSAL_OF','related_event_id',first_payment)));
 reversal:=create_financial_event_command(p);PERFORM transition_financial_event(reversal,'PLANNED','QA');PERFORM transition_financial_event(reversal,'COMMITTED','QA');PERFORM approve_financial_event(reversal,'QA');
 SELECT id INTO original_settlement FROM liquidity_settlements WHERE financial_event_id=first_payment;
 r:=reverse_financial_settlement(original_settlement,reversal,'QA atomic rollback reversal');
 IF (SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>base_balance-65 OR (SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=ob)<>50 OR (SELECT settled_amount FROM liquidity_flows WHERE id=flow)<>65 THEN RAISE EXCEPTION 'ATOMIC_REVERSAL_RECONCILIATION_FAILED';END IF;
 r:=reverse_financial_settlement(original_settlement,reversal,'QA atomic rollback reversal');IF NOT (r->>'idempotent_replay')::boolean THEN RAISE EXCEPTION 'REVERSAL_REPLAY_FAILED';END IF;
 IF (SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>base_balance-65 THEN RAISE EXCEPTION 'REVERSAL_REPLAY_DUPLICATED_CASH';END IF;
 BEGIN PERFORM reverse_financial_settlement(original_settlement,reversal,'QA changed reason');guard_error:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN guard_error:=SQLERRM;END;
 IF guard_error NOT LIKE 'IDEMPOTENCY_CONFLICT%' THEN RAISE EXCEPTION 'REVERSAL_CHANGED_PAYLOAD_GUARD_FAILED:%',guard_error;END IF;
 PERFORM set_config('qa.parity.result',jsonb_build_object('payment_status',(select status from financial_events where id=first_payment),'outstanding_after_reversal',(select outstanding_base_amount from financial_event_obligation_balances where obligation_id=ob),'bank_change_after_reversal',(select current_balance from liquidity_accounts where id=bank)-base_balance,'ledger_status',(select status from liquidity_settlements where financial_event_id=first_payment),'forecast_settled_after_reversal',(select settled_amount from liquidity_flows where id=flow),'rollback',true)::text,true);
END $test$;
SELECT current_setting('qa.parity.result')::jsonb AS test_result;
ROLLBACK;