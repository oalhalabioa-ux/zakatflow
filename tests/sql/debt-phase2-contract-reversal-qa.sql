BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE org uuid:='85acbac0-e8b4-434c-a22b-3ec13b55e1a7';party uuid:='d86a111c-d392-4f09-adc1-13f9e72a1c53';bank uuid;p jsonb;r jsonb;c uuid;e uuid;op uuid;side text;mode text;
BEGIN
bank:=(open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','ORGANIZATION','organization_id',org,'type','BANK','name','QA contract reversal rollback','currency','SAR','opening_balance',1000,'opening_date','2026-10-01','fx_rate',1))->>'id')::uuid;
FOREACH side IN ARRAY ARRAY['PAYABLE','RECEIVABLE']LOOP FOREACH mode IN ARRAY ARRAY['NEW','OPENING']LOOP
p:=jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'kind','LOAN','mode',mode,'side',side,'counterparty_id',party,'entity_id',null,'account_id',bank,'category',case when side='PAYABLE'then 'O_AP_LOAN'else 'O_AR_LOAN'end,'description','QA contract reversal','reference','QA-REV','date','2026-10-15','currency','SAR','exchange_rate',1,'principal',100,'schedule',jsonb_build_array(jsonb_build_object('amount',100,'due_date','2026-11-01')));
r:=create_debt_contract(p);c:=(r->>'id')::uuid;e:=(r->>'eventId')::uuid;PERFORM approve_financial_event(e,'QA approval');PERFORM post_debt_contract(c);
r:=prepare_debt_operation(jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'kind','REVERSE','target_id',e,'date','2026-10-15','reason','QA contract source reversal'));op:=(r->>'id')::uuid;PERFORM approve_financial_event((r->>'eventId')::uuid,'QA reversal approval');PERFORM post_debt_operation(op);PERFORM post_debt_operation(op);
IF(SELECT status FROM financial_events WHERE id=e)<>'REVERSED'OR(SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>1000 OR EXISTS(SELECT 1 FROM financial_counterparty_open_items WHERE event_id=e)OR EXISTS(SELECT 1 FROM liquidity_flows WHERE source_module='DEBT_CONTRACTS'AND source_record_id IN(SELECT id FROM financial_event_obligations WHERE event_id=e))THEN RAISE EXCEPTION 'CONTRACT_REVERSAL_NOT_RECONCILED';END IF;
END LOOP;END LOOP;
PERFORM set_config('qa.contract_reverse.result','{"lending":true,"borrowing":true,"funded_and_opening":true,"cash_reconciled":true,"forecast_removed":true,"replay_safe":true,"rollback":true}',true);
END $test$;
SELECT current_setting('qa.contract_reverse.result')::jsonb result;ROLLBACK;
