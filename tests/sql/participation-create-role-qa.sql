BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ce535387-cff4-494e-ad96-d942854f4b9e',true);
DO $test$
DECLARE org uuid:='85acbac0-e8b4-434c-a22b-3ec13b55e1a7';cid uuid;err text;
BEGIN
 IF NOT financial_core_can(org,'financial_core.create')OR financial_core_can(org,'financial_core.post')THEN RAISE EXCEPTION 'CREATE_ONLY_ROLE_FIXTURE_CHANGED';END IF;
 cid:=(create_participation_contract(jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'counterparty_id','d86a111c-d392-4f09-adc1-13f9e72a1c53','entity_id',null,'reference','QA-CREATE-ROLE','description','QA create-only cancellation guard','project','QA cancellation fixture','capital',1000,'currency','SAR','exchange_rate',1,'start_date','2026-01-01','maturity_date',null,'investor_profit_pct',30,'investor_loss_pct',100,'capital_treatment','FINANCING','accounting_basis','QA contractual variable liability treatment','exit_terms','QA exit after reconciliation and approved return','loss_terms','QA allocated investor losses within capital','variable_return',true))->>'id')::uuid;
 BEGIN PERFORM finish_participation_contract(cid,'CLOSE','QA close must require the independent posting permission');err:='NOT_BLOCKED';EXCEPTION WHEN OTHERS THEN err:=SQLERRM;END;
 IF err<>'PARTICIPATION_ACCESS_DENIED'THEN RAISE EXCEPTION 'CLOSE_PERMISSION_NOT_ENFORCED:%',err;END IF;
 PERFORM finish_participation_contract(cid,'CANCEL','QA creator may cancel an unposted contract without money');
 IF NOT EXISTS(SELECT 1 FROM participation_contracts WHERE id=cid AND state='CANCELLED')THEN RAISE EXCEPTION 'UNPOSTED_CANCELLATION_FAILED';END IF;
 PERFORM set_config('qa.participation_create_role.result','{"create_only_cancel":true,"post_required_for_close":true,"rollback":true}',true);
END $test$;
SELECT current_setting('qa.participation_create_role.result')::jsonb result;
ROLLBACK;
