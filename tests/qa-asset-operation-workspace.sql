BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE a jsonb; aid uuid; tx uuid; event uuid; ob uuid; flow uuid; bank uuid:='dd7cce04-d75c-4880-ac03-77f0f82d6a3a'; base_balance numeric; n numeric; p jsonb; payment uuid; first_payment uuid; amount numeric; r jsonb; request uuid:=gen_random_uuid(); replay_error text; excess_error text; changes jsonb; old_revision timestamptz; failure text; c jsonb; newer jsonb; retry jsonb; lifecycle uuid; change_key uuid:=gen_random_uuid(); original_notes text; results jsonb:='{}';
BEGIN
 SELECT current_balance INTO base_balance FROM liquidity_accounts WHERE id=bank;
 a:=create_asset_with_acquisition('{"asset_type":"OTHER","name":"QA parity asset 20261012 rollback","currency":"SAR","unit":"unit","is_zakatable":false,"ownership_scope":"ORGANIZATION","organization_id":"85acbac0-e8b4-434c-a22b-3ec13b55e1a7","entity_id":"d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe","cost_center_id":null,"asset_class_code":"PPE","asset_type_code":"IT_EQUIPMENT","metadata":{"acquisition_mode":"PURCHASE","quantity":1,"purchase_value":100,"purchase_date":"2026-10-12","vat_amount":15,"recoverable_percent":100,"fx_rate":1,"counterparty_id":"d86a111c-d392-4f09-adc1-13f9e72a1c53","invoice_reference":"QA-PARITY-ASSET-ROLLBACK","due_date":"2026-11-12"}}'::jsonb,request);
 aid:=(a->>'id')::uuid;tx:=(a->>'acquisition_transaction_id')::uuid;event:=(a->>'financial_event_id')::uuid;
 IF aid IS NULL OR tx IS NULL OR event IS NULL THEN RAISE EXCEPTION 'ASSET_RESULT_IDS_MISSING';END IF;
 IF (SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>base_balance THEN RAISE EXCEPTION 'RECOGNITION_MOVED_CASH';END IF;
 IF (SELECT count(*) FROM financial_events WHERE source_module='ASSETS_INTEGRATION' AND source_record_id=tx)<>1 THEN RAISE EXCEPTION 'ASSET_DUPLICATE_EVENT';END IF;
 a:=create_asset_with_acquisition('{"asset_type":"OTHER","name":"QA parity asset 20261012 rollback","currency":"SAR","unit":"unit","is_zakatable":false,"ownership_scope":"ORGANIZATION","organization_id":"85acbac0-e8b4-434c-a22b-3ec13b55e1a7","entity_id":"d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe","cost_center_id":null,"asset_class_code":"PPE","asset_type_code":"IT_EQUIPMENT","metadata":{"acquisition_mode":"PURCHASE","quantity":1,"purchase_value":100,"purchase_date":"2026-10-12","vat_amount":15,"recoverable_percent":100,"fx_rate":1,"counterparty_id":"d86a111c-d392-4f09-adc1-13f9e72a1c53","invoice_reference":"QA-PARITY-ASSET-ROLLBACK","due_date":"2026-11-12"}}'::jsonb,request);
 IF (a->>'id')::uuid<>aid THEN RAISE EXCEPTION 'ASSET_IDEMPOTENCY_FAILED';END IF;


 SELECT notes INTO original_notes FROM transactions WHERE id=tx;
 PERFORM amend_asset_transaction_notes(tx,'QA revised description',coalesce(original_notes,''));
 BEGIN PERFORM amend_asset_transaction_notes(tx,'QA stale update',coalesce(original_notes,''));failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'TRANSACTION_EDIT_CONFLICT' OR (SELECT notes FROM transactions WHERE id=tx)<>'QA revised description' THEN RAISE EXCEPTION 'NOTES_REVISION_GUARD_FAILED:%',failure;END IF;
 PERFORM transition_financial_event(event,'PLANNED','QA');PERFORM transition_financial_event(event,'COMMITTED','QA');PERFORM approve_financial_event(event,'QA');PERFORM transition_financial_event(event,'ACTUAL','QA');
 IF asset_financial_reverse_block_reason(event) IS NOT NULL THEN RAISE EXCEPTION 'UNPAID_ASSET_REVERSE_INELIGIBLE';END IF;
 c:=prepare_asset_lifecycle(aid,jsonb_build_object('operation','DEPRECIATION','date','2026-10-13','quantity',0,'amount',10,'vat_amount',0,'counterparty_id',null,'due_date',null),gen_random_uuid());
 lifecycle:=(c->>'financial_event_id')::uuid;
 newer:=replace_asset_lifecycle_draft(lifecycle,jsonb_build_object('operation','DEPRECIATION','date','2026-10-13','quantity',0,'amount',20,'vat_amount',0,'counterparty_id',null,'due_date',null),change_key);
 IF (SELECT status FROM financial_events WHERE id=lifecycle)<>'CANCELLED' OR (newer->>'amount')::numeric<>20 THEN RAISE EXCEPTION 'LIFECYCLE_REPLACEMENT_FAILED';END IF;
 retry:=replace_asset_lifecycle_draft(lifecycle,jsonb_build_object('operation','DEPRECIATION','date','2026-10-13','quantity',0,'amount',20,'vat_amount',0,'counterparty_id',null,'due_date',null),change_key);
 IF retry->>'financial_event_id'<>newer->>'financial_event_id' THEN RAISE EXCEPTION 'LIFECYCLE_REPLACE_REPLAY_FAILED';END IF;
 lifecycle:=(newer->>'financial_event_id')::uuid;
 BEGIN PERFORM replace_asset_lifecycle_draft(lifecycle,jsonb_build_object('operation','DEPRECIATION','date','2026-10-13','quantity',0,'amount',200,'vat_amount',0,'counterparty_id',null,'due_date',null),gen_random_uuid());failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'ASSET_DEPRECIATION_INVALID' OR (SELECT status FROM financial_events WHERE id=lifecycle)<>'DRAFT' THEN RAISE EXCEPTION 'FAILED_EDIT_DID_NOT_PRESERVE_ORIGINAL:%',failure;END IF;
 PERFORM transition_financial_event(lifecycle,'PLANNED','QA');PERFORM transition_financial_event(lifecycle,'COMMITTED','QA');PERFORM approve_financial_event(lifecycle,'QA');
 BEGIN PERFORM replace_asset_lifecycle_draft(lifecycle,jsonb_build_object('operation','DEPRECIATION','date','2026-10-13','quantity',0,'amount',25,'vat_amount',0,'counterparty_id',null,'due_date',null),gen_random_uuid());failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'ASSET_APPROVED_DRAFT_LOCKED' THEN RAISE EXCEPTION 'APPROVED_DRAFT_MUTATED:%',failure;END IF;
 PERFORM transition_financial_event(lifecycle,'ACTUAL','QA');
 IF (SELECT remaining_value_base FROM lots WHERE asset_account_id=aid)<>80 THEN RAISE EXCEPTION 'DEPRECIATION_NOT_APPLIED';END IF;
 PERFORM set_config('request.jwt.claim.sub','8ec4c7f9-83b4-4307-9d5e-de7590fa121b',true);
 BEGIN PERFORM reverse_asset_financial_event(lifecycle,'QA unauthorized reversal');failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure='NOT_BLOCKED' THEN RAISE EXCEPTION 'VIEWER_REVERSE_NOT_BLOCKED';END IF;
 PERFORM set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
 PERFORM reverse_asset_financial_event(lifecycle,'QA reverse depreciation rollback');
 IF (SELECT remaining_value_base FROM lots WHERE asset_account_id=aid)<>100 THEN RAISE EXCEPTION 'DEPRECIATION_REVERSAL_NOT_RECONCILED';END IF;
 PERFORM reverse_asset_financial_event(event,'QA reverse unpaid purchase rollback');
 IF (SELECT sum(remaining_value_base) FROM lots WHERE asset_account_id=aid)<>0 OR (SELECT status FROM financial_events WHERE id=event)<>'REVERSED' THEN RAISE EXCEPTION 'PURCHASE_REVERSE_NOT_RECONCILED';END IF;
 IF (SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>base_balance THEN RAISE EXCEPTION 'NON_CASH_OPERATION_MOVED_BANK';END IF;
 IF has_function_privilege('anon','public.reverse_asset_financial_event(uuid,text)','EXECUTE') OR has_function_privilege('anon','public.replace_asset_lifecycle_draft(uuid,jsonb,uuid)','EXECUTE') OR has_function_privilege('anon','public.amend_asset_transaction_notes(uuid,text,text)','EXECUTE') THEN RAISE EXCEPTION 'ANON_FINANCIAL_COMMAND_EXPOSED';END IF;
 PERFORM set_config('qa.parity.result',jsonb_build_object('notes_revision_guard',true,'replace_draft',true,'replacement_replay',true,'failed_replacement_atomic',true,'approved_edit_blocked',true,'viewer_reverse_blocked',true,'depreciation_reversal',true,'unpaid_purchase_reversal',true,'bank_unchanged',true,'rollback',true)::text,true);
END $test$;SELECT current_setting('qa.parity.result')::jsonb test_result;ROLLBACK;
