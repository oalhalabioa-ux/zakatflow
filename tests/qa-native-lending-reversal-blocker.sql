-- QA only; generated fixture identities, real native commands, rollback.
-- Positive regression: native reversal, immediate deferred capture, original
-- detailed accounts, later-window recognition and idempotent replay.
begin;
set constraints all immediate;
do $$
declare
 u uuid:=gen_random_uuid();org uuid:=gen_random_uuid();bank uuid:=gen_random_uuid();party uuid:=gen_random_uuid();
 c jsonb;p jsonb;r jsonb;cls uuid;ev jsonb;denied boolean:=false;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@reversal-fixture.invalid',now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.organizations(id,owner_user_id,name,base_currency) values(org,u,'Rollback native debt reversal','SAR');
 insert into public.organization_members(organization_id,user_id,role,status) values(org,u,'OWNER','ACTIVE') on conflict do nothing;
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
 values(bank,org,'Fixture bank','BANK','SAR',1000,1000,u,'{"opening_date":"2026-01-01","opening_balance":1000,"opening_fx_rate":1}');
 insert into public.liquidity_counterparties(id,organization_id,name,party_type,created_by) values(party,org,'Fixture lender','SUPPLIER',u);
 perform public.save_financial_chart_account(org,'120001','1200','قرض الاختبار','Fixture loan','DEBIT',true,true,0,'Native reversal test');
 perform public.link_financial_cash_accounts(org);
 c:=public.create_debt_contract(jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'kind','LOAN','mode','NEW','side','RECEIVABLE',
 'counterparty_id',party,'entity_id',null,'account_id',bank,'category','O_AR_LOAN','description','Native reversal fixture','reference','QA',
 'date','2026-02-10','currency','SAR','exchange_rate',1,'principal',300,'schedule',jsonb_build_array(jsonb_build_object('amount',300,'due_date','2026-12-01'))));
 select classification_id into cls from public.financial_event_lines where event_id=(c->>'eventId')::uuid;
 p:=public.save_financial_reporting_policy(org,'2026-01-01',0,jsonb_build_array(jsonb_build_object('eventType','ADJUSTMENT','sourceModule','DEBT_CONTRACTS',
 'classificationId',cls::text||':DEBT_FUNDED_O_AR_LOAN','cashDirection','OUTFLOW','debitAccountId','120001','creditAccountId','1000','cashActivity','INVESTING','detailed',true)),'Native detailed loan policy');
 perform public.approve_financial_reporting_policy((p->>'id')::uuid,(p->>'version')::integer);
 perform public.approve_financial_event((c->>'eventId')::uuid,'Native reversal fixture');
 perform public.post_debt_contract((c->>'id')::uuid);
 if (select current_balance from public.liquidity_accounts where id=bank)<>700 then raise exception 'FIXTURE_FUNDING_FAILED';end if;
 r:=public.prepare_debt_operation(jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'kind','REVERSE','target_id',c->>'eventId','date','2026-03-01','reason','Native reversal regression'));
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.post_debt_operation((r->>'id')::uuid);
 exception when others then
  if sqlerrm<>'DEBT_OPERATION_ACCESS_DENIED' then raise;end if;
  denied:=true;
 end;
 if not denied then raise exception 'REVERSAL_FOREIGN_USER_ALLOWED';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform public.approve_financial_event((r->>'eventId')::uuid,'Native reversal fixture');
 perform public.post_debt_operation((r->>'id')::uuid);
 if (select current_balance from public.liquidity_accounts where id=bank)<>1000
 or (select status from public.financial_events where id=(c->>'eventId')::uuid)<>'REVERSED'
 or (select status from public.financial_events where id=(r->>'eventId')::uuid)<>'ACTUAL'
 or (select execution_state from public.debt_operation_requests where id=(r->>'id')::uuid)<>'EXECUTED'
 then raise exception 'REVERSAL_SOURCE_STATE_INVALID';end if;
 if (select (lines->0)-'lineId' from private.financial_event_posting_resolutions where organization_id=org and event_id=c->>'eventId')
 is distinct from (select (lines->0)-'lineId' from private.financial_event_posting_resolutions where organization_id=org and event_id=r->>'eventId')
 then raise exception 'REVERSAL_ORIGINAL_ACCOUNTS_NOT_PRESERVED';end if;
 select value into ev from jsonb_array_elements(private.financial_reporting_events(org,'2026-03-01','2026-03-31')) where value->>'id'=r->>'eventId';
 if ev is null or (ev->'lines'->0->>'recognitionSign')::int<>-1 or (ev->'lines'->0->>'baseAmount')::numeric<>300
 or (ev->'lines'->0->>'originalLineId') is null then raise exception 'REVERSAL_LATER_WINDOW_INVALID';end if;
 if (public.post_debt_operation((r->>'id')::uuid)->>'replay')::boolean is distinct from true
 or (select current_balance from public.liquidity_accounts where id=bank)<>1000
 then raise exception 'REVERSAL_REPLAY_CHANGED_BANK';end if;
end $$;
select 'PASS native lending reversal, original accounts, later window and replay; rolled back' as result;
rollback;
