BEGIN;
INSERT INTO public.financial_classifications(organization_id,code,name,classification_type,created_by) SELECT '85acbac0-e8b4-434c-a22b-3ec13b55e1a7','QA_PARITY_RECEIVABLE','QA receivable rollback','RECEIVABLE','f10bd630-6e35-4513-a9b3-4908d1b00c3c' WHERE NOT EXISTS (SELECT 1 FROM public.financial_classifications WHERE organization_id='85acbac0-e8b4-434c-a22b-3ec13b55e1a7' AND classification_type='RECEIVABLE' AND active);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE receipt_class uuid; a jsonb; aid uuid; tx uuid; event uuid; ob uuid; flow uuid; bank uuid:='dd7cce04-d75c-4880-ac03-77f0f82d6a3a'; base_balance numeric; n numeric; p jsonb; payment uuid; first_payment uuid; amount numeric; r jsonb; request uuid:=gen_random_uuid(); replay_error text; excess_error text; results jsonb:='{}';
BEGIN
 SELECT current_balance INTO base_balance FROM liquidity_accounts WHERE id=bank;

 SELECT id INTO receipt_class FROM financial_classifications WHERE organization_id='85acbac0-e8b4-434c-a22b-3ec13b55e1a7' AND classification_type='RECEIVABLE' AND active LIMIT 1;
 IF receipt_class IS NULL THEN INSERT INTO financial_classifications(organization_id,code,name,classification_type,created_by) VALUES('85acbac0-e8b4-434c-a22b-3ec13b55e1a7','QA_PARITY_RECEIVABLE','QA receivable rollback','RECEIVABLE',auth.uid()) RETURNING id INTO receipt_class;END IF;
 INSERT INTO vat_documents(organization_id,user_id,created_by,document_type,document_kind,document_number,transaction_date,due_date,counterparty_contact_id,counterparty_name,supply_type,net_amount,tax_rate,tax_amount,recoverable_percent,gross_amount,currency,source_currency,exchange_rate,source_net_amount,source_tax_amount,source_gross_amount,line_items)
 VALUES('85acbac0-e8b4-434c-a22b-3ec13b55e1a7',auth.uid(),auth.uid(),'SALES','INVOICE','QA-SALES-'||request,'2026-10-12','2026-11-12','ba3bde89-854a-48f6-b8aa-615b29a58054','QA customer','STANDARD',100,15,15,100,115,'SAR','SAR',1,100,15,115,'[]') RETURNING id INTO aid;
 p:=jsonb_build_object('organization_id','85acbac0-e8b4-434c-a22b-3ec13b55e1a7','entity_id','d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe','counterparty_id','c6a4c1e8-23b5-490f-830a-2fc34f43c2f4','event_type','REVENUE','source_module','OPERATIONAL_CONSOLE','source_record_id',aid,'source_event_key','vat_documents:'||aid,'event_date','2026-10-12','due_date','2026-11-12','base_currency','SAR','description','Sales invoice QA rollback','lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id','5cc4dd9c-21d4-40a6-a8c2-b04c5c4796ef','amount',100,'currency','SAR','exchange_rate',1,'base_amount',100,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0),jsonb_build_object('line_number',2,'classification_id','bebfe759-5797-4755-b9d1-2c399424f136','amount',15,'currency','SAR','exchange_rate',1,'base_amount',15,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations',jsonb_build_array(jsonb_build_object('obligation_key','invoice-gross','obligation_type','RECEIVABLE','settleable_amount',115,'currency','SAR','exchange_rate',1,'base_currency','SAR','settleable_base_amount',115)),'links',jsonb_build_array(jsonb_build_object('link_type','SOURCE','target_module','vat_documents','target_record_id',aid,'metadata',jsonb_build_object('document_type','SALES'))));
 event:=create_financial_event_command(p);
 IF create_financial_event_command(p)<>event THEN RAISE EXCEPTION 'SALES_CREATION_IDEMPOTENCY_FAILED';END IF;
 PERFORM transition_financial_event(event,'PLANNED','QA');PERFORM transition_financial_event(event,'COMMITTED','QA');PERFORM approve_financial_event(event,'QA');PERFORM transition_financial_event(event,'ACTUAL','QA');
 SELECT id INTO ob FROM financial_event_obligations WHERE event_id=event;
 INSERT INTO liquidity_flows(organization_id,direction,flow_type,title,counterparty,counterparty_id,due_date,amount,currency,base_amount,status,source,reference,source_module,source_record_id,source_event_key)
 VALUES('85acbac0-e8b4-434c-a22b-3ec13b55e1a7','INFLOW','OPERATING','QA sales rollback','QA customer','c6a4c1e8-23b5-490f-830a-2fc34f43c2f4','2026-11-12',115,'SAR',115,'EXPECTED','INVOICE','QA','VAT_INTEGRATION',aid,'vat_documents:'||aid||':cash-forecast') RETURNING id INTO flow;
 INSERT INTO financial_event_links(organization_id,event_id,link_type,target_module,target_record_id,metadata) VALUES('85acbac0-e8b4-434c-a22b-3ec13b55e1a7',event,'CASH_FLOW','liquidity_flows',flow,'{"purpose":"INVOICE_DUE_FORECAST"}');
 IF (SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=ob)<>115 THEN RAISE EXCEPTION 'SALES_DUE_NOT_115';END IF;
 IF (SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>base_balance THEN RAISE EXCEPTION 'SALES_RECOGNITION_MOVED_CASH';END IF;
 FOREACH amount IN ARRAY ARRAY[50::numeric,100::numeric,65::numeric] LOOP
  p:=jsonb_build_object('organization_id','85acbac0-e8b4-434c-a22b-3ec13b55e1a7','entity_id','d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe','counterparty_id','c6a4c1e8-23b5-490f-830a-2fc34f43c2f4','event_type','SETTLEMENT','source_module','OPERATIONAL_CONSOLE','source_event_key','qa-parity-payment-'||request||'-'||amount,'event_date','2026-10-12','due_date','2026-10-12','base_currency','SAR','description','QA parity rollback payment','lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',receipt_class,'description','QA payment','amount',amount,'currency','SAR','exchange_rate',1,'base_amount',amount,'cash_direction','INFLOW','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations','[]'::jsonb,'links',jsonb_build_array(jsonb_build_object('link_type','SETTLEMENT_OF','related_event_id',event)));
  payment:=create_financial_event_command(p);
  IF create_financial_event_command(p)<>payment THEN RAISE EXCEPTION 'PAYMENT_CREATION_IDEMPOTENCY_FAILED';END IF;
  PERFORM transition_financial_event(payment,'PLANNED','QA');
  PERFORM transition_financial_event(payment,'COMMITTED','QA');
  PERFORM approve_financial_event(payment,'QA');
  IF amount=100 THEN
   BEGIN
    PERFORM post_financial_settlement(payment,bank,'INFLOW','2026-10-12',100,'SAR',1,100,jsonb_build_array(jsonb_build_object('obligation_id',ob,'flow_id',flow,'amount',100,'base_amount',100,'flow_amount',100,'flow_currency','SAR','flow_exchange_rate',1)));
    excess_error:='NOT_BLOCKED';
   EXCEPTION WHEN OTHERS THEN excess_error:=SQLERRM;END;
   IF excess_error NOT IN ('FINANCIAL_CORE_OVER_SETTLEMENT','SETTLEMENT_EXCEEDS_FLOW_OUTSTANDING') THEN RAISE EXCEPTION 'OVERPAYMENT_GUARD_FAILED:%',excess_error;END IF;
   CONTINUE;
  END IF;
  r:=post_financial_settlement(payment,bank,'INFLOW','2026-10-12',amount,'SAR',1,amount,jsonb_build_array(jsonb_build_object('obligation_id',ob,'flow_id',flow,'amount',amount,'base_amount',amount,'flow_amount',amount,'flow_currency','SAR','flow_exchange_rate',1)));
  IF amount=50 THEN
   first_payment:=payment;
   IF (SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=ob)<>65 THEN RAISE EXCEPTION 'PARTIAL_PAYMENT_BALANCE_NOT_65';END IF;
  END IF;
 END LOOP;
 IF (SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=ob)<>0 THEN RAISE EXCEPTION 'FULL_PAYMENT_BALANCE_NOT_ZERO';END IF;
 IF (SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>base_balance+115 THEN RAISE EXCEPTION 'BANK_MOVEMENT_NOT_115';END IF;
 IF (SELECT settled_amount FROM liquidity_flows WHERE id=flow)<>115 THEN RAISE EXCEPTION 'FORECAST_SETTLED_NOT_115';END IF;
 BEGIN
  PERFORM post_financial_settlement(payment,bank,'INFLOW','2026-10-12',65,'SAR',1,65,jsonb_build_array(jsonb_build_object('obligation_id',ob,'flow_id',flow,'amount',65,'base_amount',65,'flow_amount',65,'flow_currency','SAR','flow_exchange_rate',1)));
  replay_error:='none';
 EXCEPTION WHEN OTHERS THEN replay_error:=SQLERRM; END;
 IF (SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>base_balance+115 THEN RAISE EXCEPTION 'REPLAY_DUPLICATED_CASH';END IF;
 IF (SELECT sum(l.base_amount) FROM financial_event_lines l JOIN financial_classifications c ON c.id=l.classification_id WHERE l.event_id=event AND c.classification_type='REVENUE')<>100 THEN RAISE EXCEPTION 'SALES_REVENUE_CHANGED_BY_COLLECTION';END IF;
 results:=jsonb_build_object('sales_create_and_retry','PASS','revenue',100,'output_VAT',15,'receivable',115,'partial_remaining',65,'full_remaining',0,'cash_change',115,'repeat_settlement_result',replay_error,'duplicate_cash','NONE','overpayment_guard',excess_error,'rollback',true);
 PERFORM set_config('qa.parity.result',results::text,true);
END $test$;
SELECT current_setting('qa.parity.result')::jsonb AS test_result;
ROLLBACK;