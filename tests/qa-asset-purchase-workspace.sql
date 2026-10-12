BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE a jsonb; aid uuid; tx uuid; event uuid; ob uuid; flow uuid; bank uuid:='dd7cce04-d75c-4880-ac03-77f0f82d6a3a'; base_balance numeric; n numeric; p jsonb; payment uuid; first_payment uuid; amount numeric; r jsonb; request uuid:=gen_random_uuid(); replay_error text; excess_error text; changes jsonb; old_revision timestamptz; failure text; results jsonb:='{}';
BEGIN
 SELECT current_balance INTO base_balance FROM liquidity_accounts WHERE id=bank;
 a:=create_asset_with_acquisition('{"asset_type":"OTHER","name":"QA parity asset 20261012 rollback","currency":"SAR","unit":"unit","is_zakatable":false,"ownership_scope":"ORGANIZATION","organization_id":"85acbac0-e8b4-434c-a22b-3ec13b55e1a7","entity_id":"d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe","cost_center_id":null,"asset_class_code":"PPE","asset_type_code":"IT_EQUIPMENT","metadata":{"acquisition_mode":"PURCHASE","quantity":1,"purchase_value":100,"purchase_date":"2026-10-12","vat_amount":15,"recoverable_percent":100,"fx_rate":1,"counterparty_id":"d86a111c-d392-4f09-adc1-13f9e72a1c53","invoice_reference":"QA-PARITY-ASSET-ROLLBACK","due_date":"2026-11-12"}}'::jsonb,request);
 aid:=(a->>'id')::uuid;tx:=(a->>'acquisition_transaction_id')::uuid;event:=(a->>'financial_event_id')::uuid;
 IF aid IS NULL OR tx IS NULL OR event IS NULL THEN RAISE EXCEPTION 'ASSET_RESULT_IDS_MISSING';END IF;
 IF (SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>base_balance THEN RAISE EXCEPTION 'RECOGNITION_MOVED_CASH';END IF;
 IF (SELECT count(*) FROM financial_events WHERE source_module='ASSETS_INTEGRATION' AND source_record_id=tx)<>1 THEN RAISE EXCEPTION 'ASSET_DUPLICATE_EVENT';END IF;
 a:=create_asset_with_acquisition('{"asset_type":"OTHER","name":"QA parity asset 20261012 rollback","currency":"SAR","unit":"unit","is_zakatable":false,"ownership_scope":"ORGANIZATION","organization_id":"85acbac0-e8b4-434c-a22b-3ec13b55e1a7","entity_id":"d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe","cost_center_id":null,"asset_class_code":"PPE","asset_type_code":"IT_EQUIPMENT","metadata":{"acquisition_mode":"PURCHASE","quantity":1,"purchase_value":100,"purchase_date":"2026-10-12","vat_amount":15,"recoverable_percent":100,"fx_rate":1,"counterparty_id":"d86a111c-d392-4f09-adc1-13f9e72a1c53","invoice_reference":"QA-PARITY-ASSET-ROLLBACK","due_date":"2026-11-12"}}'::jsonb,request);
 IF (a->>'id')::uuid<>aid THEN RAISE EXCEPTION 'ASSET_IDEMPOTENCY_FAILED';END IF;

 SELECT updated_at INTO old_revision FROM asset_accounts WHERE id=aid;
 changes:=jsonb_build_object('purchase_value',200,'quantity',2,'fx_rate',1,'vat_input_mode','PERCENT','vat_rate',15,'vat_amount',15,'recoverable_percent',100,'purchase_date','2026-10-12','due_date','2026-11-12','counterparty_id','d86a111c-d392-4f09-adc1-13f9e72a1c53','invoice_reference','QA-AMENDED');
 PERFORM set_config('request.jwt.claim.sub','8ec4c7f9-83b4-4307-9d5e-de7590fa121b',true);
 BEGIN PERFORM amend_asset_purchase_draft(aid,changes,old_revision);failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'ASSET_PURCHASE_EDIT_DENIED' THEN RAISE EXCEPTION 'VIEWER_EDIT_NOT_BLOCKED:%',failure;END IF;
 PERFORM set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
 BEGIN PERFORM amend_asset_purchase_draft(aid,changes,old_revision-interval '1 microsecond');failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'ASSET_EDIT_CONFLICT' THEN RAISE EXCEPTION 'REVISION_GUARD_FAILED:%',failure;END IF;
 BEGIN PERFORM amend_asset_purchase_draft(aid,changes||'{"archived":true}',old_revision);failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'ASSET_PURCHASE_CHANGE_FIELDS_INVALID' THEN RAISE EXCEPTION 'FIELD_WHITELIST_FAILED:%',failure;END IF;
 a:=amend_asset_purchase_draft(aid,changes,old_revision);
 IF (a->'metadata'->>'vat_amount')::numeric<>30 OR (SELECT settleable_amount FROM financial_event_obligations WHERE event_id=event)<>230 OR (SELECT sum(base_amount) FROM financial_event_lines WHERE event_id=event)<>230 OR (SELECT remaining_value_base FROM lots WHERE asset_account_id=aid)<>200 THEN RAISE EXCEPTION 'DRAFT_AMENDMENT_RECONCILIATION_FAILED';END IF;
 PERFORM archive_asset_purchase_draft(aid);
 IF (SELECT status FROM financial_events WHERE id=event)<>'CANCELLED' OR (SELECT sum(remaining_value_base) FROM lots WHERE asset_account_id=aid)<>0 THEN RAISE EXCEPTION 'ARCHIVE_FAILED';END IF;
 IF (SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>base_balance THEN RAISE EXCEPTION 'DRAFT_OPERATIONS_MOVED_BANK';END IF;
 INSERT INTO financial_classifications(organization_id,code,name,classification_type,created_by) VALUES('85acbac0-e8b4-434c-a22b-3ec13b55e1a7','QA_TEST_'||request,'QA Classification','PAYABLE',auth.uid());
 PERFORM set_config('qa.parity.result',jsonb_build_object('draft_tax',30,'draft_total',230,'draft_cost',200,'viewer_edit_blocked',true,'revision_conflict_blocked',true,'unapproved_archive',true,'owner_classification_insert',true,'bank_unchanged',true,'rollback',true)::text,true);
END $test$;
SELECT current_setting('qa.parity.result')::jsonb AS test_result;ROLLBACK;
