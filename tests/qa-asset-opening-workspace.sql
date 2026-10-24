BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE a jsonb;b jsonb;inspection jsonb;aid uuid;revision timestamptz;tx uuid;failure text;changes jsonb;payload jsonb;result jsonb;assessment uuid;lot uuid;
BEGIN
 payload:='{"asset_type":"OTHER","name":"QA opening edit rollback","currency":"SAR","unit":"unit","is_zakatable":false,"ownership_scope":"ORGANIZATION","organization_id":"85acbac0-e8b4-434c-a22b-3ec13b55e1a7","entity_id":"d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe","cost_center_id":null,"asset_class_code":"PPE","asset_type_code":"IT_EQUIPMENT","metadata":{"acquisition_mode":"OPENING_BALANCE","quantity":1,"purchase_value":100,"purchase_date":"2026-10-01","vat_amount":0,"recoverable_percent":100,"fx_rate":1}}'::jsonb;
 a:=public.create_asset_with_acquisition(payload,gen_random_uuid());aid:=(a->>'id')::uuid;
 inspection:=public.manage_asset_opening(aid,'INSPECT');
 IF NOT (inspection->>'can_edit')::boolean THEN RAISE EXCEPTION 'OPENING_NOT_EDITABLE:%',inspection;END IF;
 revision:=(inspection->'asset'->>'updated_at')::timestamptz;
 changes:='{"name":"QA amended opening","date":"2026-10-02","amount":250,"quantity":2,"purpose":"QA purpose","fx_rate":1}'::jsonb;
 BEGIN PERFORM public.manage_asset_opening(aid,'UPDATE',revision-interval '1 microsecond',changes);failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'ASSET_EDIT_CONFLICT' THEN RAISE EXCEPTION 'STALE_REVISION_NOT_BLOCKED:%',failure;END IF;
 PERFORM set_config('request.jwt.claim.sub','8ec4c7f9-83b4-4307-9d5e-de7590fa121b',true);
 BEGIN PERFORM public.manage_asset_opening(aid,'UPDATE',revision,changes);failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure NOT IN('ASSET_OPENING_EDIT_DENIED','ASSET_OPENING_ACCESS_DENIED') THEN RAISE EXCEPTION 'VIEWER_NOT_BLOCKED:%',failure;END IF;
 PERFORM set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
 BEGIN PERFORM public.manage_asset_opening(aid,'UPDATE',revision,changes||'{"archived":true}');failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'ASSET_OPENING_CHANGE_FIELDS_INVALID' THEN RAISE EXCEPTION 'FIELD_WHITELIST_NOT_ENFORCED:%',failure;END IF;
 result:=public.manage_asset_opening(aid,'UPDATE',revision,changes);
 IF (SELECT name FROM public.asset_accounts WHERE id=aid)<>'QA amended opening' OR (SELECT transaction_date FROM public.transactions WHERE asset_account_id=aid)<>'2026-10-02'::date OR (SELECT quantity FROM public.transactions WHERE asset_account_id=aid)<>2 OR (SELECT base_value FROM public.transactions WHERE asset_account_id=aid)<>250 OR (SELECT remaining_quantity FROM public.lots WHERE asset_account_id=aid)<>2 OR (SELECT remaining_value_base FROM public.lots WHERE asset_account_id=aid)<>250 OR (SELECT acquisition_date FROM public.lots WHERE asset_account_id=aid)<>'2026-10-02'::date THEN RAISE EXCEPTION 'OPENING_AMENDMENT_NOT_ATOMIC';END IF;
 IF current_setting('app.asset_opening_edit',true)<>'' THEN RAISE EXCEPTION 'GUARD_CONTEXT_LEAKED';END IF;
 revision:=(result->'asset'->>'updated_at')::timestamptz;
 -- Direct financial edits remain locked even after the command has returned.
 BEGIN UPDATE public.asset_accounts SET metadata=metadata||'{"purchase_date":"2026-09-01"}' WHERE id=aid;failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'ASSET_FINANCIAL_FIELDS_LOCKED' THEN RAISE EXCEPTION 'DIRECT_EDIT_GUARD_FAILED:%',failure;END IF;
 result:=public.manage_asset_opening(aid,'ARCHIVE',revision);
 IF NOT (result->>'archived')::boolean OR (SELECT metadata->>'archived' FROM public.asset_accounts WHERE id=aid)<>'true' OR (SELECT remaining_value_base FROM public.lots WHERE asset_account_id=aid)<>0 OR (SELECT metadata->>'asset_deleted' FROM public.transactions WHERE asset_account_id=aid)<>'true' THEN RAISE EXCEPTION 'OPENING_ARCHIVE_FAILED';END IF;
 BEGIN PERFORM public.manage_asset_opening(aid,'ARCHIVE',(result->'asset'->>'updated_at')::timestamptz);failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'ASSET_OPENING_ARCHIVED' THEN RAISE EXCEPTION 'ARCHIVE_REPLAY_NOT_BLOCKED:%',failure;END IF;
 -- Personal openings remain editable until a saved assessment references their lot.
 b:=public.create_asset_with_acquisition((payload-'organization_id'-'entity_id'-'cost_center_id')||'{"ownership_scope":"PERSONAL"}',gen_random_uuid());aid:=(b->>'id')::uuid;
 inspection:=public.manage_asset_opening(aid,'INSPECT');
 IF NOT (inspection->>'can_edit')::boolean THEN RAISE EXCEPTION 'PERSONAL_OPENING_NOT_EDITABLE';END IF;
 PERFORM public.manage_asset_opening(aid,'UPDATE',(inspection->'asset'->>'updated_at')::timestamptz,changes);
 SELECT id INTO lot FROM public.lots WHERE asset_account_id=aid;
 INSERT INTO public.zakat_assessments(user_id,assessment_date,valuation_date,method_id,nisab_standard,nisab_quantity,nisab_value_base,zakat_rate,currency)
 VALUES(auth.uid(),'2026-10-03','2026-10-03',(SELECT id FROM public.zakat_methods LIMIT 1),'GOLD',85,25500,0.025,'SAR') RETURNING id INTO assessment;
 INSERT INTO public.zakat_assessment_lines(assessment_id,lot_id,quantity,eligibility_status,explanation) VALUES(assessment,lot,2,'ELIGIBLE','QA rollback snapshot guard');
 inspection:=public.manage_asset_opening(aid,'INSPECT');
 IF inspection->>'block_reason'<>'ASSET_OPENING_ZAKAT_LINK' THEN RAISE EXCEPTION 'SAVED_SNAPSHOT_NOT_PROTECTED:%',inspection;END IF;
 BEGIN PERFORM public.manage_asset_opening(aid,'ARCHIVE',(inspection->'asset'->>'updated_at')::timestamptz);failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'ASSET_OPENING_ZAKAT_LINK' THEN RAISE EXCEPTION 'SAVED_SNAPSHOT_DELETE_NOT_BLOCKED:%',failure;END IF;
 -- A later movement closes edit/delete eligibility.
 b:=public.create_asset_with_acquisition(payload,gen_random_uuid());aid:=(b->>'id')::uuid;
 INSERT INTO public.transactions(user_id,asset_account_id,organization_id,entity_id,transaction_type,transaction_date,quantity,unit_price,currency,gross_value,base_currency,base_value,created_by)
 VALUES(auth.uid(),aid,'85acbac0-e8b4-434c-a22b-3ec13b55e1a7','d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe','ADD','2026-10-03',1,10,'SAR',10,'SAR',10,auth.uid());
 inspection:=public.manage_asset_opening(aid,'INSPECT');
 IF (inspection->>'can_edit')::boolean OR inspection->>'block_reason'<>'ASSET_OPENING_LINKED' THEN RAISE EXCEPTION 'DOWNSTREAM_MOVEMENT_NOT_BLOCKED';END IF;
 BEGIN PERFORM public.manage_asset_opening(aid,'ARCHIVE',(inspection->'asset'->>'updated_at')::timestamptz);failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'ASSET_OPENING_LINKED' THEN RAISE EXCEPTION 'LINKED_DELETE_NOT_BLOCKED:%',failure;END IF;
 PERFORM set_config('qa.opening.result','{"atomic_edit":true,"date_and_amount_synced":true,"viewer_denied":true,"revision_guard":true,"field_whitelist":true,"direct_edits_locked":true,"archive_zeroes_active_balance":true,"archive_replay_guard":true,"downstream_guard":true,"personal_opening_edit":true,"saved_snapshot_guard":true,"rollback":true}',true);
END $test$;
SELECT current_setting('qa.opening.result')::jsonb AS test_result;
ROLLBACK;
