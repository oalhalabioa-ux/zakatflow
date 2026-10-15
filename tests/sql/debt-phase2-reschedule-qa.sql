BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE org uuid:='85acbac0-e8b4-434c-a22b-3ec13b55e1a7';party uuid:='d86a111c-d392-4f09-adc1-13f9e72a1c53';bank uuid;p jsonb;r jsonb;c uuid;e uuid;ob uuid;fid uuid;cls uuid;pay uuid;op uuid;stale uuid;err text;
BEGIN
bank:=(open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','ORGANIZATION','organization_id',org,'type','BANK','name','QA schedule rollback','currency','SAR','opening_balance',1000,'opening_date','2026-10-01','fx_rate',1))->>'id')::uuid;
p:=jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'kind','LOAN','mode','NEW','side','PAYABLE','counterparty_id',party,'entity_id',null,'account_id',bank,'category','O_AP_LOAN','description','QA reschedule rollback','reference','QA-RE','date','2026-10-15','currency','SAR','exchange_rate',1,'principal',100,'schedule',jsonb_build_array(jsonb_build_object('amount',100,'due_date','2026-11-01')));
r:=create_debt_contract(p);c:=(r->>'id')::uuid;e:=(r->>'eventId')::uuid;PERFORM approve_financial_event(e,'QA approval');PERFORM post_debt_contract(c);SELECT id INTO ob FROM financial_event_obligations WHERE event_id=e;fid:=ensure_debt_flow(ob);
SELECT id INTO cls FROM financial_classifications WHERE organization_id=org AND classification_type='PAYABLE'AND active LIMIT 1;
pay:=create_financial_event_command(jsonb_build_object('organization_id',org,'entity_id',null,'counterparty_id',party,'event_type','SETTLEMENT','source_module','OPERATIONAL_CONSOLE','source_event_key','qa-partial:'||gen_random_uuid(),'event_date','2026-10-15','due_date',null,'base_currency','SAR','description','QA partial repayment','lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',cls,'description','principal only','amount',30,'currency','SAR','exchange_rate',1,'base_amount',30,'cash_direction','OUTFLOW','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations','[]'::jsonb,'links','[]'::jsonb));
PERFORM transition_financial_event(pay,'PLANNED','QA');PERFORM transition_financial_event(pay,'COMMITTED','QA');PERFORM approve_financial_event(pay,'QA');PERFORM post_financial_settlement(pay,bank,'OUTFLOW','2026-10-15',30,'SAR',1,30,jsonb_build_array(jsonb_build_object('obligation_id',ob,'flow_id',fid,'amount',30,'base_amount',30,'flow_amount',30,'flow_currency','SAR','flow_exchange_rate',1)));
p:=jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'kind','RESCHEDULE','target_id',c,'date','2026-10-15','reason','QA partial paid rescheduling','dates',jsonb_build_array(jsonb_build_object('obligation_id',ob,'due_date','2027-02-01')));
r:=prepare_debt_operation(p);op:=(r->>'id')::uuid;e:=(r->>'eventId')::uuid;
IF(prepare_debt_operation(p)->>'id')::uuid<>op THEN RAISE EXCEPTION 'RESCHEDULE_REPLAY_DUPLICATED';END IF;
p:=jsonb_set(p,'{request_id}',to_jsonb(gen_random_uuid()));r:=prepare_debt_operation(p);stale:=(r->>'id')::uuid;PERFORM approve_financial_event((r->>'eventId')::uuid,'QA stale approval');
BEGIN PERFORM post_debt_operation(op);err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
IF err<>'VALID_APPROVAL_REQUIRED'THEN RAISE EXCEPTION 'RESCHEDULE_APPROVAL_FAILED:%',err;END IF;
PERFORM approve_financial_event(e,'QA approval');PERFORM post_debt_operation(op);PERFORM post_debt_operation(op);
IF(SELECT due_date FROM financial_counterparty_open_items WHERE obligation_id=ob)<>'2027-02-01'::date OR(SELECT due_date FROM liquidity_flows WHERE id=fid)<>'2027-02-01'::date OR(SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=ob)<>70 OR(SELECT settled_amount FROM liquidity_flows WHERE id=fid)<>30 OR(SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>1070 THEN RAISE EXCEPTION 'RESCHEDULE_NOT_RECONCILED';END IF;
BEGIN PERFORM post_debt_operation(stale);err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
IF err<>'DEBT_SCHEDULE_CHANGED'THEN RAISE EXCEPTION 'STALE_RESCHEDULE_NOT_BLOCKED:%',err;END IF;
PERFORM set_config('qa.reschedule.result','{"partial_payment_preserved":true,"cash_unchanged":true,"dates_reflected":true,"approval_required":true,"stale_blocked":true,"replay_safe":true,"rollback":true}',true);
END $test$;
SELECT current_setting('qa.reschedule.result')::jsonb result;ROLLBACK;
