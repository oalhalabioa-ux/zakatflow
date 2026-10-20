BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE bank uuid;ar uuid;ap uuid;added_ar uuid;added_ap uuid;other_ar uuid;owner_uid uuid:=auth.uid();req uuid:=gen_random_uuid();p jsonb;r jsonb;err text;base text;n numeric;
BEGIN
 SELECT base_currency INTO base FROM profiles WHERE id=auth.uid();
 bank:=(open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','PERSONAL','organization_id',null,'entity_id',null,'type','BANK','name','QA linked debt rollback bank','currency',base,'opening_balance',10000,'opening_date','2026-10-01','hawl_start_date','2026-01-01','fx_rate',1))->>'id')::uuid;
 ar:=(open_categorized_receivable(jsonb_build_object('request_id',gen_random_uuid(),'scope','PERSONAL','organization_id',null,'entity_id',null,'type','RECEIVABLE','debt_category','P_AR_RENT','name','QA debtor with explicit identity','currency',base,'opening_balance',5000,'opening_date','2026-10-01','hawl_start_date','2026-01-01','fx_rate',1))->>'id')::uuid;
 p:=jsonb_build_object('operation','FUND','command',jsonb_build_object('action','FUND','source_debt_id',ar,'request_id',req,'kind','LOAN','side','RECEIVABLE','party','untrusted replaced name','description','Additional principal for same debtor','reference','QA-LINK-AR','amount',1000,'date','2026-10-20','due_date','2026-11-01','account_id',bank));
 r:=linked_personal_debt_command(p);
 SELECT receivable_id INTO added_ar FROM personal_financings WHERE id=(r->>'id')::uuid;
 IF linked_personal_debt_command(p)->>'id'<>r->>'id' THEN RAISE EXCEPTION 'LINK_REPLAY_FAILED';END IF;
 IF NOT EXISTS(SELECT 1 FROM financial_debt_categories WHERE origin='PERSONAL_RECEIVABLE' AND record_id=added_ar AND category='P_AR_LOAN') THEN RAISE EXCEPTION 'NEW_LOAN_MISCLASSIFIED_AS_SOURCE_RENT';END IF;
 IF(SELECT sum(remaining_value_base) FROM lots WHERE asset_account_id=bank)<>9000 THEN RAISE EXCEPTION 'FUND_CASH_DUPLICATED';END IF;
 IF NOT EXISTS(SELECT 1 FROM personal_debt_links WHERE record_id=added_ar AND party_key=ar::text AND party_name='QA debtor with explicit identity') THEN RAISE EXCEPTION 'EXPLICIT_PARTY_LINK_FAILED';END IF;
 IF(SELECT metadata->>'opening_balance' FROM asset_accounts WHERE id=ar)<>'5000' THEN RAISE EXCEPTION 'OPENING_REWRITTEN';END IF;
 PERFORM transfer_personal_financial_account(jsonb_build_object('action','COLLECT','request_id',gen_random_uuid(),'source_id',ar,'destination_id',bank,'amount',2000,'date','2026-10-20','notes','Partial collection from original opening'));
 IF(SELECT sum(remaining_value_base) FROM lots WHERE asset_account_id IN(ar,added_ar))<>4000 THEN RAISE EXCEPTION 'AR_GROUP_NOT_4000';END IF;
 -- A second opening voucher is noncash and linked to the same party.
 r:=linked_personal_debt_command(jsonb_build_object('operation','RECEIVABLE','command',jsonb_build_object('source_debt_id',ar,'request_id',gen_random_uuid(),'scope','PERSONAL','organization_id',null,'entity_id',null,'type','RECEIVABLE','debt_category','P_AR_RENT','name','ignored','currency',base,'opening_balance',100,'opening_date','2026-10-01','hawl_start_date','2026-01-01','fx_rate',1)));
 IF(SELECT sum(remaining_value_base) FROM lots WHERE asset_account_id=bank)<>11000 THEN RAISE EXCEPTION 'OPENING_MOVED_CASH';END IF;
 ap:=(personal_payable_categorized_command(jsonb_build_object('action','CREATE','category','P_AP_LOAN','request_id',gen_random_uuid(),'party','QA linked creditor','description','Original creditor opening','amount',5000,'date','2026-10-01','due_date','2026-11-01','reference','QA-LINK-AP-OPEN'))->>'id')::uuid;
 r:=linked_personal_debt_command(jsonb_build_object('operation','FUND','command',jsonb_build_object('action','FUND','source_debt_id',ap,'request_id',gen_random_uuid(),'kind','LOAN','side','PAYABLE','party','ignored','description','Additional creditor funding','reference','QA-LINK-AP','amount',1000,'date','2026-10-20','due_date','2026-11-01','account_id',bank)));
 SELECT payable_id INTO added_ap FROM personal_financings WHERE id=(r->>'id')::uuid;
 PERFORM personal_payable_command(jsonb_build_object('action','PAY','request_id',gen_random_uuid(),'payable_id',ap,'account_id',bank,'amount',2000,'date','2026-10-20','notes','Partial original creditor settlement'));
 IF(SELECT sum(amount) FROM personal_payables WHERE id IN(ap,added_ap))-(SELECT sum(amount) FROM personal_payable_payments WHERE payable_id=ap)<>4000 THEN RAISE EXCEPTION 'AP_GROUP_NOT_4000';END IF;
 IF(SELECT sum(remaining_value_base) FROM lots WHERE asset_account_id=bank)<>10000 THEN RAISE EXCEPTION 'AP_CASH_NOT_ONCE';END IF;
 -- Replay with a different same-named source must never reassign an existing link.
 other_ar:=(open_categorized_receivable(jsonb_build_object('request_id',gen_random_uuid(),'scope','PERSONAL','organization_id',null,'entity_id',null,'type','RECEIVABLE','debt_category','P_AR_RENT','name','QA debtor with explicit identity','currency',base,'opening_balance',5,'opening_date','2026-10-01','hawl_start_date','2026-01-01','fx_rate',1))->>'id')::uuid;
 BEGIN PERFORM linked_personal_debt_command(jsonb_set(p,'{command,source_debt_id}',to_jsonb(other_ar)));err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
 IF err<>'PERSONAL_DEBT_LINK_REQUEST_CONFLICT' THEN RAISE EXCEPTION 'CHANGED_LINK_REPLAY_GUARD:%',err;END IF;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 IF EXISTS(SELECT 1 FROM personal_debt_links) THEN RAISE EXCEPTION 'LINK_RLS_LEAK';END IF;
 BEGIN PERFORM linked_personal_debt_command(p);err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
 IF err<>'PERSONAL_DEBT_SOURCE_ACCESS_DENIED' THEN RAISE EXCEPTION 'CROSS_USER_SOURCE_GUARD:%',err;END IF;
 PERFORM set_config('request.jwt.claim.sub',owner_uid::text,true);
 -- Wrong-side / wrong-owner source must fail before any bank movement.
 BEGIN PERFORM linked_personal_debt_command(jsonb_set(p,'{command,source_debt_id}',to_jsonb(gen_random_uuid())));err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
 IF err<>'PERSONAL_DEBT_SOURCE_ACCESS_DENIED' THEN RAISE EXCEPTION 'SOURCE_OWNER_GUARD:%',err;END IF;
 BEGIN PERFORM linked_personal_debt_command(jsonb_set(p,'{command,side}','"PAYABLE"'));err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
 IF err<>'PERSONAL_DEBT_SOURCE_ACCESS_DENIED' THEN RAISE EXCEPTION 'SIDE_GUARD:%',err;END IF;
 IF(SELECT sum(remaining_value_base) FROM lots WHERE asset_account_id=bank)<>10000 THEN RAISE EXCEPTION 'FAILED_REQUEST_MOVED_CASH';END IF;
 PERFORM set_config('qa.personal_link.result',jsonb_build_object('ar_after_extra_funding_and_collection',4000,'ap_after_extra_funding_and_payment',4000,'bank_after_both',10000,'opening_unchanged',true,'cash_once',true,'explicit_identity',true,'rollback',true)::text,true);
END $test$;
SELECT current_setting('qa.personal_link.result')::jsonb result;
ROLLBACK;
