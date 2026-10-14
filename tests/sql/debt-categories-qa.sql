BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE ar uuid;ap uuid;core uuid;ob uuid;cls uuid;base text;bank uuid;before_assets bigint;events_before bigint;p jsonb;err text;n numeric;
BEGIN
 SELECT base_currency INTO base FROM profiles WHERE id=auth.uid();SELECT count(*) INTO events_before FROM financial_events;
 bank:=(open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','PERSONAL','type','BANK','name','QA category rollback cash','currency',base,'opening_balance',500,'opening_date','2026-10-01','hawl_start_date','2026-01-01','fx_rate',1))->>'id')::uuid;
 p:=jsonb_build_object('request_id',gen_random_uuid(),'scope','PERSONAL','type','RECEIVABLE','name','QA category borrower','currency',base,'opening_balance',100,'opening_date','2026-10-14','hawl_start_date','2026-01-01','fx_rate',1,'debt_category','P_AR_RENT');
 ar:=(open_categorized_receivable(p)->>'id')::uuid;
 IF(SELECT category FROM financial_debt_categories WHERE origin='PERSONAL_RECEIVABLE' AND record_id=ar)<>'P_AR_RENT' THEN RAISE EXCEPTION 'AR_CREATE_CATEGORY_MISSING';END IF;
 PERFORM assign_debt_category('PERSONAL_RECEIVABLE',ar,'P_AR_LOAN');
 BEGIN PERFORM assign_debt_category('PERSONAL_RECEIVABLE',ar,'P_AP_LOAN');err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
 IF err<>'DEBT_CATEGORY_SIDE_MISMATCH' THEN RAISE EXCEPTION 'CATEGORY_SIDE_GUARD:%',err;END IF;
 SELECT count(*) INTO before_assets FROM asset_accounts WHERE user_id=auth.uid();
 BEGIN PERFORM open_categorized_receivable(jsonb_set(jsonb_set(p,'{request_id}',to_jsonb(gen_random_uuid())),'{debt_category}','"P_AP_OTHER"'));err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
 IF err<>'DEBT_CATEGORY_SIDE_MISMATCH' OR(SELECT count(*) FROM asset_accounts WHERE user_id=auth.uid())<>before_assets THEN RAISE EXCEPTION 'CATEGORY_ATOMIC_OPEN_FAILED:%',err;END IF;
 p:=jsonb_build_object('action','CREATE','request_id',gen_random_uuid(),'party','QA category creditor','description','Existing classified liability','amount',200,'date','2026-10-14','due_date','2028-01-01','reference','QA-CAT','category','P_AP_INSTALLMENT');
 ap:=(personal_payable_categorized_command(p)->>'id')::uuid;
 IF(SELECT category FROM financial_debt_categories WHERE origin='PERSONAL_PAYABLE' AND record_id=ap)<>'P_AP_INSTALLMENT' THEN RAISE EXCEPTION 'AP_CREATE_CATEGORY_MISSING';END IF;
 PERFORM assign_debt_category('PERSONAL_PAYABLE',ap,'P_AP_LOAN');
 IF(SELECT amount FROM personal_payables WHERE id=ap)<>200 OR EXISTS(SELECT 1 FROM personal_payable_payments WHERE payable_id=ap) OR(SELECT sum(remaining_value_base) FROM lots WHERE asset_account_id=bank)<>500 OR(SELECT sum(remaining_value_base) FROM lots WHERE asset_account_id=ar)<>100 OR(SELECT count(*) FROM financial_events)<>events_before THEN RAISE EXCEPTION 'CATEGORY_CHANGED_FINANCIAL_VALUES';END IF;
 -- Corporate classification changes only the metadata attached to a real posted obligation.
 SELECT id INTO cls FROM financial_classifications WHERE organization_id='85acbac0-e8b4-434c-a22b-3ec13b55e1a7' AND classification_type='OPEX' AND active LIMIT 1;
 core:=create_financial_event_command(jsonb_build_object('organization_id','85acbac0-e8b4-434c-a22b-3ec13b55e1a7','entity_id',null,'counterparty_id','d86a111c-d392-4f09-adc1-13f9e72a1c53','event_type','EXPENSE','source_module','QA_CATEGORY','source_event_key','qa-category:'||gen_random_uuid(),'event_date','2026-10-14','due_date','2026-11-01','base_currency','SAR','description','QA category metadata only','lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',cls,'description','QA expense','amount',100,'currency','SAR','exchange_rate',1,'base_amount',100,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0)),'obligations',jsonb_build_array(jsonb_build_object('obligation_key','payable','obligation_type','PAYABLE','settleable_amount',100,'currency','SAR','exchange_rate',1,'base_currency','SAR','settleable_base_amount',100)),'links','[]'::jsonb));
 PERFORM transition_financial_event(core,'PLANNED','QA');PERFORM transition_financial_event(core,'COMMITTED','QA');PERFORM approve_financial_event(core,'QA');PERFORM transition_financial_event(core,'ACTUAL','QA');
 SELECT id INTO ob FROM financial_event_obligations WHERE event_id=core;
 PERFORM assign_debt_category('CORE',ob,'O_AP_RELATED');
 IF(SELECT outstanding_base_amount FROM financial_event_obligation_balances WHERE obligation_id=ob)<>100 OR(SELECT sum(base_amount) FROM financial_event_lines WHERE event_id=core)<>100 THEN RAISE EXCEPTION 'CATEGORY_CHANGED_CORE_OBLIGATION';END IF;
 PERFORM set_config('request.jwt.claim.sub','8ec4c7f9-83b4-4307-9d5e-de7590fa121b',true);
 IF EXISTS(SELECT 1 FROM financial_debt_categories WHERE record_id IN(ar,ap)) THEN RAISE EXCEPTION 'CATEGORY_RLS_FAILED';END IF;
 BEGIN PERFORM assign_debt_category('PERSONAL_PAYABLE',ap,'P_AP_OTHER');err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
 IF err<>'DEBT_CATEGORY_ACCESS_DENIED' THEN RAISE EXCEPTION 'CATEGORY_OWNER_GUARD:%',err;END IF;
 BEGIN PERFORM assign_debt_category('CORE',ob,'O_AP_OTHER');err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
 IF err<>'DEBT_CATEGORY_ACCESS_DENIED' THEN RAISE EXCEPTION 'CATEGORY_COMPANY_PERMISSION_GUARD:%',err;END IF;
 PERFORM set_config('qa.debt_category.result',jsonb_build_object('personal_ar_category',true,'personal_ap_category',true,'corporate_category',true,'financial_values_unchanged',true,'wrong_side_blocked',true,'cross_user_blocked',true,'atomic_invalid_create',true,'rollback',true)::text,true);
END $test$;
SELECT current_setting('qa.debt_category.result')::jsonb result;
ROLLBACK;
