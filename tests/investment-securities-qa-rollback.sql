BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE t jsonb;c jsonb;o jsonb;bank uuid;cid uuid;aid uuid;op uuid;instrument text;failure text;beforecount integer;
BEGIN
 INSERT INTO public.liquidity_accounts(organization_id,entity_id,name,account_type,currency,current_balance,current_balance_base)VALUES('85acbac0-e8b4-434c-a22b-3ec13b55e1a7','d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe','QA USD investment rollback','BANK','USD',1000,3750)RETURNING id INTO bank;
 FOREACH instrument IN ARRAY ARRAY['BOND','SUKUK']LOOP
 t:=jsonb_build_object('name','QA FX security','instrument',instrument,'ownership_scope','ORGANIZATION','organization_id','85acbac0-e8b4-434c-a22b-3ec13b55e1a7','entity_id','d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe','cost_center_id',null,'party_name','QA issuer','currency','USD','principal',98,'face_value',100,'fees',1,'annual_rate',5,'start_date','2026-01-01','maturity_date','2026-04-01','interest_basis','ACT_360','zakat_basis','HIJRI_TABULAR','zakat_rate',2.5,'zakat_base',98,'zakat_treatment','COVERED','inflation_rate',3,'fx_rate',3.75,'funding_account_id',bank,'reference','QA-ROLLBACK','notes','Synthetic rollback only');
 c:=public.investment_command('SAVE',null,t,gen_random_uuid());cid:=(c->>'id')::uuid;aid:=(c->>'asset_account_id')::uuid;
 o:=public.investment_command('PREPARE',cid,jsonb_build_object('kind','FUND','date','2026-01-01','account_id',bank,'amount',99,'fx_rate',3.75,'notes','Discount plus fee funding'),gen_random_uuid());op:=(o->>'id')::uuid;
 PERFORM public.investment_command('APPROVE',op);PERFORM public.investment_command('POST',op);
 IF(SELECT sum(remaining_value_base)FROM public.lots WHERE asset_account_id=aid)<>371.25 OR NOT EXISTS(SELECT 1 FROM public.transactions WHERE asset_account_id=aid AND transaction_type='PURCHASE')THEN RAISE EXCEPTION 'SECURITY_FX_BOOK_COST_FAILED';END IF;
 BEGIN UPDATE public.liquidity_flows SET amount=999 WHERE source_module='INVESTMENTS'AND source_record_id=cid;failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure='NOT_BLOCKED'THEN RAISE EXCEPTION 'INVESTMENT_FORECAST_TAMPER_ALLOWED';END IF;
 o:=public.investment_command('PREPARE',cid,jsonb_build_object('kind','INCOME','date','2026-04-01','account_id',bank,'amount',1.25,'fx_rate',3.8,'notes','Cancelled before collection'),gen_random_uuid());op:=(o->>'id')::uuid;
 PERFORM public.investment_command('CANCEL_OPERATION',op);
 IF(SELECT count(*)FROM public.liquidity_flows WHERE source_module='INVESTMENTS'AND source_record_id=cid)<>2 THEN RAISE EXCEPTION 'CANCELLED_FORECAST_NOT_RESTORED';END IF;
 o:=public.investment_command('PREPARE',cid,jsonb_build_object('kind','REDEEM','date','2026-04-01','account_id',bank,'amount',100,'fx_rate',3.8,'notes','FX principal returned'),gen_random_uuid());op:=(o->>'id')::uuid;
 PERFORM public.investment_command('APPROVE',op);PERFORM public.investment_command('POST',op);
 IF NOT EXISTS(SELECT 1 FROM public.transactions WHERE asset_account_id=aid AND transaction_type='TRANSFER_OUT'AND (metadata->>'realized_gain_base')::numeric=8.75)OR(SELECT sum(remaining_value_base)FROM public.lots WHERE asset_account_id=aid)<>0 THEN RAISE EXCEPTION 'SECURITY_REDEMPTION_FX_GAIN_FAILED';END IF;
 END LOOP;
 t:=t||jsonb_build_object('name','QA insufficient bank','principal',2000,'face_value',2000,'fees',0);
 c:=public.investment_command('SAVE',null,t,gen_random_uuid());cid:=(c->>'id')::uuid;aid:=(c->>'asset_account_id')::uuid;
 o:=public.investment_command('PREPARE',cid,jsonb_build_object('kind','FUND','date','2026-01-01','account_id',bank,'amount',2000,'fx_rate',3.75,'notes','Insufficient funds assertion'),gen_random_uuid());op:=(o->>'id')::uuid;
 PERFORM public.investment_command('APPROVE',op);
 BEGIN PERFORM public.investment_command('POST',op);failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure<>'INVESTMENT_INSUFFICIENT_FUNDS'OR EXISTS(SELECT 1 FROM public.lots WHERE asset_account_id=aid)THEN RAISE EXCEPTION 'INSUFFICIENT_FUNDS_ATOMICITY_FAILED:%',failure;END IF;
 SELECT count(*)INTO beforecount FROM public.investment_contracts;
 PERFORM public.investment_command('CANCEL_OPERATION',op);
 BEGIN PERFORM public.investment_command('REPLACE',cid,t||jsonb_build_object('principal',-1),gen_random_uuid());failure:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN failure:=SQLERRM;END;
 IF failure='NOT_BLOCKED'OR(SELECT status FROM public.investment_contracts WHERE id=cid)<>'DRAFT'OR(SELECT count(*)FROM public.investment_contracts)<>beforecount THEN RAISE EXCEPTION 'FAILED_REPLACE_NOT_ATOMIC';END IF;
 PERFORM set_config('qa.investment.result','bonds_sukuk_fx_fees_gain_cancel_forecast_insufficient_funds_atomic_replace_pass',true);
END $test$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT current_setting('qa.investment.result')AS test_result;
ROLLBACK;
