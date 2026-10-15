BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE bank uuid;p jsonb;r jsonb;fid uuid;f public.personal_financings%rowtype;k text;s text;n numeric;err text;
BEGIN
 bank:=(open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','PERSONAL','type','BANK','name','QA personal funding rollback','currency','SAR','opening_balance',1000,'opening_date','2026-10-01','fx_rate',1))->>'id')::uuid;
 FOREACH k IN ARRAY ARRAY['LOAN','ADVANCE']LOOP FOREACH s IN ARRAY ARRAY['RECEIVABLE','PAYABLE']LOOP
  p:=jsonb_build_object('action','FUND','request_id',gen_random_uuid(),'kind',k,'side',s,'party','QA synthetic party','description','QA personal funded principal','reference','QA-FUND','amount',100,'date','2026-10-15','due_date','2026-11-15','account_id',bank);
  r:=personal_financing_command(p);fid:=(r->>'id')::uuid;IF(personal_financing_command(p)->>'id')::uuid<>fid THEN RAISE EXCEPTION 'PERSONAL_FUNDING_REPLAY_DUPLICATED';END IF;
  SELECT * INTO f FROM personal_financings WHERE id=fid;
  SELECT sum(remaining_value_base)INTO n FROM lots WHERE asset_account_id=bank;
  IF n<>1000+(case when s='RECEIVABLE'then -100 else 100 end) THEN RAISE EXCEPTION 'PERSONAL_BANK_NOT_RECONCILED:%',n;END IF;
  BEGIN PERFORM reverse_transaction(auth.uid(),f.cash_transaction_id);err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
  IF err<>'PERSONAL_FINANCING_USE_SOURCE'THEN RAISE EXCEPTION 'GENERIC_PARTIAL_REVERSAL_NOT_BLOCKED:%',err;END IF;
  PERFORM personal_financing_command(jsonb_build_object('action','REVERSE','id',fid,'reason','QA reversal rollback'));
  PERFORM personal_financing_command(jsonb_build_object('action','REVERSE','id',fid,'reason','QA reversal rollback'));
  SELECT sum(remaining_value_base)INTO n FROM lots WHERE asset_account_id=bank;
  IF n<>1000 THEN RAISE EXCEPTION 'PERSONAL_REVERSE_BANK_WRONG:%',n;END IF;
 END LOOP;END LOOP;
 PERFORM set_config('qa.personal_funding.result','{"loan_lending":true,"loan_borrowing":true,"advance_paid":true,"advance_received":true,"replay_safe":true,"source_reversal":true,"cash_reconciled":true,"rollback":true}',true);
END $test$;
SELECT current_setting('qa.personal_funding.result')::jsonb result;
ROLLBACK;
