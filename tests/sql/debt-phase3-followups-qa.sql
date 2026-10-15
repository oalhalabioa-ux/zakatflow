BEGIN;SET LOCAL statement_timeout='15s';SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
DO $test$
DECLARE org uuid:='85acbac0-e8b4-434c-a22b-3ec13b55e1a7';party uuid:='d86a111c-d392-4f09-adc1-13f9e72a1c53';p jsonb;r jsonb;e uuid;o uuid;id uuid;cash numeric;err text;
BEGIN
 p:=jsonb_build_object('organization_id',org,'request_id',gen_random_uuid(),'kind','OPENING','mode','OPENING','side','RECEIVABLE','counterparty_id',party,'entity_id',null,'account_id',null,'category','O_AR_CUSTOMER','description','QA collection followup','reference','QA-COL','date','2026-10-15','currency','SAR','exchange_rate',1,'principal',100,'schedule',jsonb_build_array(jsonb_build_object('amount',100,'due_date','2026-11-01')));
 r:=create_debt_contract(p);e:=(r->>'eventId')::uuid;perform approve_financial_event(e,'QA approval');perform post_debt_contract((r->>'id')::uuid);select x.id into o from financial_event_obligations x where x.event_id=e;
 select coalesce(sum(current_balance),0)into cash from liquidity_accounts where organization_id=org;
 p:=jsonb_build_object('request_id',gen_random_uuid(),'organization_id',org,'debt_id',o,'target_type','CORE','status','PROMISED','action_date','2026-10-15','next_date','2026-10-20','promise_date','2026-10-25','promise_amount',50,'assignee_id',auth.uid(),'note','QA promised collection');id:=record_debt_followup(p);
 if record_debt_followup(p)<>id then raise exception 'FOLLOWUP_REPLAY_DUPLICATED';end if;
 if(select count(*)from debt_collection_followups where debt_id=o)<>1 or(select outstanding_base_amount from financial_event_obligation_balances where obligation_id=o)<>100 or(select coalesce(sum(current_balance),0)from liquidity_accounts where organization_id=org)<>cash then raise exception 'FOLLOWUP_CHANGED_FINANCIALS';end if;
 begin perform record_debt_followup(p||jsonb_build_object('note','Changed payload'));err:='NOT_BLOCKED';exception when others then err:=SQLERRM;end;if err<>'FOLLOWUP_REQUEST_CONFLICT'then raise exception 'FOLLOWUP_CONFLICT_UNGUARDED:%',err;end if;
 begin update debt_collection_followups set note='Tampered'where debt_id=o;err:='NOT_BLOCKED';exception when others then err:=SQLERRM;end;if err='NOT_BLOCKED'then raise exception 'FOLLOWUP_HISTORY_MUTABLE';end if;
 perform set_config('request.jwt.claim.sub','2c566cdb-89b2-477c-af16-01f33ae03a8e',true);
 if exists(select 1 from debt_collection_followups where debt_id=o)then raise exception 'FOLLOWUP_CROSS_USER_LEAK';end if;
 begin perform record_debt_followup(p||jsonb_build_object('request_id',gen_random_uuid()));err:='NOT_BLOCKED';exception when others then err:=SQLERRM;end;if err<>'FOLLOWUP_ACCESS_DENIED'then raise exception 'FOLLOWUP_CROSS_USER_WRITE:%',err;end if;
 perform set_config('qa.phase3_followup',jsonb_build_object('append_only',true,'replay_safe',true,'cross_user_blocked',true,'cash_unchanged',true,'balance_unchanged',true,'rollback',true)::text,true);
END $test$;SELECT current_setting('qa.phase3_followup')::jsonb result;ROLLBACK;
