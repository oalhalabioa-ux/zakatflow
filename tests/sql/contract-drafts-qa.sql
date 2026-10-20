BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE org uuid:='85acbac0-e8b4-434c-a22b-3ec13b55e1a7';party uuid:='d86a111c-d392-4f09-adc1-13f9e72a1c53';bank uuid;cid uuid;mid uuid;rec uuid;cash uuid;profit uuid;ret uuid;loss uuid;flow uuid;cp jsonb;p jsonb;r jsonb;err text;v numeric;cl uuid;pay uuid;allocs jsonb:='[]';payout record;remaining numeric;terms jsonb;
BEGIN
 bank:=(open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','ORGANIZATION','organization_id',org,'type','BANK','name','QA participation rollback bank','currency','SAR','opening_balance',1000,'opening_date','2026-01-01','fx_rate',1))->>'id')::uuid;
 cp:=jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'counterparty_id',party,'entity_id',null,'reference','QA-PARTICIPATION','description','QA actual profit participation','project','QA investor pool','capital',1000,'currency','SAR','exchange_rate',1,'start_date','2026-01-01','maturity_date','2027-01-01','investor_profit_pct',30,'investor_loss_pct',100,'capital_treatment','FINANCING','accounting_basis','Contractual variable redeemable participation liability','exit_terms','Capital returned on approved withdrawal after reconciled results','loss_terms','Investor bears allocated losses up to remaining capital','variable_return',true);
 cid:=(create_participation_contract(cp)->>'id')::uuid;
 IF(create_participation_contract(cp)->>'id')::uuid<>cid THEN RAISE EXCEPTION 'PARTICIPATION_CREATE_REPLAY';END IF;

 p:=jsonb_set(cp,'{request_id}',to_jsonb(gen_random_uuid()));p:=jsonb_set(p,'{capital}','1500');
 r:=manage_contract_draft('PARTICIPATION',cid,'EDIT',p,'QA edit an empty draft without financial effects');
 IF(r->>'id')::uuid=cid OR(SELECT deleted_at FROM participation_contracts WHERE id=cid)is null THEN RAISE EXCEPTION 'PARTICIPATION_REPLACE_FAILED';END IF;
 cid:=(r->>'id')::uuid;
 IF(SELECT capital FROM participation_contracts WHERE id=cid)<>1500 THEN RAISE EXCEPTION 'PARTICIPATION_NEW_TERMS_FAILED';END IF;
 PERFORM manage_contract_draft('PARTICIPATION',cid,'DELETE','{}','QA delete the replacement draft');
 PERFORM manage_contract_draft('PARTICIPATION',cid,'DELETE','{}','QA repeat draft deletion idempotently');
 p:=jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'kind','LOAN','mode','NEW','side','RECEIVABLE','counterparty_id',party,'entity_id',null,'account_id',bank,'category','O_AR_LOAN','description','QA qard draft edit','reference','QA-QARD-EDIT','date','2026-01-01','currency','SAR','exchange_rate',1,'principal',300,'schedule',jsonb_build_array(jsonb_build_object('amount',100,'due_date','2026-02-01'),jsonb_build_object('amount',200,'due_date','2026-03-01')));
 r:=create_qard_contract(p);cid:=(r->>'id')::uuid;
 p:=jsonb_set(p,'{request_id}',to_jsonb(gen_random_uuid()));p:=jsonb_set(p,'{reference}','"QA-QARD-EDITED"');
 r:=manage_contract_draft('DEBT',cid,'EDIT',p,'QA edit qard draft while preserving installments');
 IF(SELECT deleted_at FROM debt_contracts WHERE id=cid)is null THEN RAISE EXCEPTION 'QARD_OLD_DRAFT_NOT_REMOVED';END IF;
 cid:=(r->>'id')::uuid;SELECT financial_event_id INTO rec FROM debt_contracts WHERE id=cid;
 IF(SELECT schedule->1->>'amount'FROM debt_contracts WHERE id=cid)<>'200' THEN RAISE EXCEPTION 'QARD_SCHEDULE_CHANGED';END IF;
 BEGIN PERFORM manage_contract_draft('DEBT',cid,null,'{}','QA null action must never delete');err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;IF err<>'CONTRACT_DRAFT_INPUT_INVALID'THEN RAISE EXCEPTION 'NULL_ACTION_GUARD:%',err;END IF;
 PERFORM approve_financial_event(rec,'QA approve qard before deletion attempt');
 BEGIN PERFORM manage_contract_draft('DEBT',cid,'DELETE','{}','QA approved contract must not be deleted');err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
 IF err<>'CONTRACT_DRAFT_ONLY_UNAPPROVED'THEN RAISE EXCEPTION 'APPROVED_DELETION_GUARD:%',err;END IF;
 IF(SELECT current_balance FROM liquidity_accounts WHERE id=bank)<>1000 THEN RAISE EXCEPTION 'DRAFT_EDIT_MOVED_BANK';END IF;
 terms:=jsonb_build_object('principal',300,'annualRate',12,'method','DECLINING','repayment','EQUAL_PRINCIPAL','count',2,'frequencyMonths',1,'startDate','2026-01-01','firstDueDate','2026-02-01','yearDays',360);
 p:=jsonb_build_object('contract',jsonb_set(p,'{request_id}',to_jsonb(gen_random_uuid())),'terms',terms);
 r:=create_financed_contract(p);cid:=(r->>'id')::uuid;
 p:=jsonb_set(p,'{contract,request_id}',to_jsonb(gen_random_uuid()));p:=jsonb_set(p,'{terms,annualRate}','10');
 r:=manage_contract_draft('DEBT',cid,'EDIT',p,'QA edit financing rate before approval');cid:=(r->>'id')::uuid;
 IF(SELECT t.terms->>'annualRate' FROM financing_contract_terms t WHERE t.id=cid)<>'10' THEN RAISE EXCEPTION 'FINANCE_EDIT_TERMS_FAILED';END IF;
 PERFORM manage_contract_draft('DEBT',cid,'DELETE','{}','QA remove financing draft without forecasts or bank movements');
 IF EXISTS(SELECT 1 FROM liquidity_flows WHERE source_record_id=cid)THEN RAISE EXCEPTION 'DELETED_FINANCE_LEFT_FORECAST';END IF;
 PERFORM set_config('qa.draft.result','{"edit":true,"delete_replay":true,"approval_guard":true,"installments_preserved":true,"cash_unchanged":true}',true);
END $test$;
SELECT current_setting('qa.draft.result')::jsonb result;
ROLLBACK;

