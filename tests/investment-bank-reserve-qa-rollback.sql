BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE terms jsonb;c jsonb;o jsonb;firstop uuid;bank uuid:='dd7cce04-d75c-4880-ac03-77f0f82d6a3a';balance numeric;failure text;req uuid:=gen_random_uuid();cid uuid;aid uuid;income uuid;
BEGIN
 INSERT INTO public.liquidity_accounts(organization_id,entity_id,name,account_type,currency,current_balance,current_balance_base)VALUES('85acbac0-e8b4-434c-a22b-3ec13b55e1a7','d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe','QA investment rollback bank','BANK','SAR',1000,1000)RETURNING id INTO bank;
 SELECT current_balance INTO balance FROM public.liquidity_accounts WHERE id=bank;
 terms:=jsonb_build_object('name','QA investment rollback','instrument','DEPOSIT','ownership_scope','ORGANIZATION','organization_id','85acbac0-e8b4-434c-a22b-3ec13b55e1a7','entity_id','d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe','cost_center_id',null,'party_name','QA bank','currency','SAR','principal',100,'face_value',100,'fees',0,'annual_rate',6,'start_date','2026-01-01','maturity_date','2026-04-01','interest_basis','ACT_365','zakat_basis','HIJRI_354','zakat_rate',2.5,'zakat_base',100,'zakat_treatment','INVESTOR','inflation_rate',3,'fx_rate',1,'funding_account_id',bank,'reference','QA-ROLLBACK','notes','Rollback investment');
 c:=public.investment_command('SAVE',null,terms,req);cid:=(c->>'id')::uuid;aid:=(c->>'asset_account_id')::uuid;
 IF public.investment_command('SAVE',null,terms,req)->>'id'<>cid::text THEN RAISE EXCEPTION 'SAVE_REPLAY_FAILED';END IF;
 IF EXISTS(SELECT 1 FROM public.lots WHERE asset_account_id=aid)OR(SELECT current_balance FROM public.liquidity_accounts WHERE id=bank)<>balance THEN RAISE EXCEPTION 'DRAFT_CHANGED_BALANCES';END IF;
 PERFORM set_config('request.jwt.claim.sub','8ec4c7f9-83b4-4307-9d5e-de7590fa121b',true);
 BEGIN PERFORM public.investment_command('CANCEL',cid);failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure='NOT_BLOCKED'THEN RAISE EXCEPTION 'VIEWER_CHANGED_CONTRACT';END IF;
 PERFORM set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
 req:=gen_random_uuid();o:=public.investment_command('PREPARE',cid,jsonb_build_object('kind','FUND','date','2026-01-01','account_id',bank,'amount',100,'fx_rate',1,'notes','QA funding'),req);firstop:=(o->>'id')::uuid;
 IF public.investment_command('PREPARE',cid,jsonb_build_object('kind','FUND','date','2026-01-01','account_id',bank,'amount',100,'fx_rate',1,'notes','QA funding'),req)->>'id'<>firstop::text THEN RAISE EXCEPTION 'OP_REPLAY_FAILED';END IF;
 BEGIN PERFORM public.investment_command('POST',firstop);failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'INVESTMENT_APPROVAL_REQUIRED'THEN RAISE EXCEPTION 'UNAPPROVED_CASH_NOT_BLOCKED:%',failure;END IF;
 PERFORM public.investment_command('APPROVE',firstop);
 UPDATE public.liquidity_accounts SET restricted_balance=950 WHERE id=bank;
 BEGIN PERFORM public.investment_command('POST',firstop);failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'INVESTMENT_INSUFFICIENT_FUNDS'OR(SELECT current_balance FROM public.liquidity_accounts WHERE id=bank)<>balance OR EXISTS(SELECT 1 FROM public.lots WHERE asset_account_id=aid)THEN RAISE EXCEPTION 'BANK_RESERVE_NOT_PROTECTED:%',failure;END IF;
 PERFORM set_config('qa.investment.result','restricted_bank_balance_and_failed_post_atomicity_pass',true);
END $test$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT current_setting('qa.investment.result')AS test_result;
ROLLBACK;
