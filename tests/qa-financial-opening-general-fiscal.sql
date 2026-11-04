begin;
create temporary table fiscal_checks(name text primary key,passed boolean not null);
create temporary table fiscal_snapshots(name text,payload jsonb);
do $$
declare owner uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();org uuid;other uuid;bank uuid;asset uuid;late_asset uuid;purchase uuid;revenue uuid;expense uuid;classification uuid;tax uuid;capex uuid;purchase_event uuid;purchase_tx uuid;current_asset uuid;opening_event uuid;late_event uuid;opening_class uuid;first_tx uuid;
 starts date;lastdate date;nextdate date;month integer;context jsonb;s jsonb;w jsonb;entries jsonb;rr jsonb;policy jsonb;rules jsonb;close jsonb;snap jsonb;trial jsonb;req uuid;source_revision text;res jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(owner,'fiscal-'||owner||'@example.invalid',now()),(outsider,'fiscal-'||outsider||'@example.invalid',now());
 for month in select * from unnest(array[1,4]) loop
  if month=4 then other:=owner;owner:=outsider;outsider:=other;end if;
  capex:=gen_random_uuid();purchase_event:=gen_random_uuid();purchase_tx:=gen_random_uuid();current_asset:=gen_random_uuid();
  org:=gen_random_uuid();bank:=gen_random_uuid();asset:=gen_random_uuid();late_asset:=gen_random_uuid();purchase:=gen_random_uuid();revenue:=gen_random_uuid();expense:=gen_random_uuid();classification:=gen_random_uuid();tax:=gen_random_uuid();
  starts:=make_date(2024,month,1);lastdate:=(starts+interval '1 year'-interval '1 day')::date;nextdate:=lastdate+1;
  perform set_config('request.jwt.claim.sub',owner::text,true);
  insert into public.organizations(id,owner_user_id,name) values(org,owner,'Independent fiscal fixture '||month);
  insert into public.organization_members(organization_id,user_id,role,status) values(org,owner,'OWNER','ACTIVE') on conflict(organization_id,user_id) do update set role='OWNER',status='ACTIVE';
  perform public.save_financial_fiscal_calendar(org,month,1,'3300',0,'Configure independent fiscal year');
  context:=public.financial_fiscal_context(org,starts+100);
  if context->'period'->>'start'<>starts::text or context->'period'->>'end'<>lastdate::text then raise exception 'period resolver %',context;end if;
  insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
   values(bank,org,'Opening bank','BANK','SAR',510,510,owner,jsonb_build_object('opening_date',case when month=1 then starts+400 else starts end,'opening_balance',500,'opening_fx_rate',1));
  insert into public.asset_accounts(id,user_id,organization_id,ownership_scope,asset_type,name,currency,metadata) values(asset,owner,org,'ORGANIZATION','OTHER','First-day opening','SAR','{"acquisition_mode":"OPENING_BALANCE"}'),(late_asset,owner,org,'ORGANIZATION','OTHER','Late recorded opening','SAR','{"acquisition_mode":"OPENING_BALANCE"}');
  insert into public.transactions(user_id,organization_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value,gross_value,metadata)
   values(owner,org,asset,'OPENING_BALANCE',starts,1,'SAR','SAR',100,100,'{}'),(owner,org,late_asset,'OPENING_BALANCE',starts+60,1,'SAR','SAR',40,40,'{}');
  select id into purchase from public.transactions where asset_account_id=late_asset;
  select id into first_tx from public.transactions where asset_account_id=asset;
  opening_event:=gen_random_uuid();late_event:=gen_random_uuid();opening_class:=gen_random_uuid();
  insert into public.financial_classifications(id,organization_id,code,name,classification_type,created_by) values(opening_class,org,'FY-OPENING','Imported opening identity','CAPEX',owner);
  insert into public.financial_events(id,organization_id,event_type,source_module,source_event_key,event_date,status,base_currency,created_by)
   values(opening_event,org,'ADJUSTMENT','FISCAL_IMPORT','opening',starts,'DRAFT','SAR',owner),(late_event,org,'ADJUSTMENT','FISCAL_IMPORT','late-opening',starts+60,'DRAFT','SAR',owner);
  insert into public.financial_event_lines(event_id,organization_id,line_number,classification_id,amount,currency,exchange_rate,base_amount,cash_direction)
   values(opening_event,org,1,opening_class,100,'SAR',1,100,'NON_CASH'),(late_event,org,1,opening_class,40,'SAR',1,40,'NON_CASH');
  update public.financial_events set status='ACTUAL',posted_by=owner,posted_at=now() where id in(opening_event,late_event);
  if month=1 then update public.transactions set metadata=jsonb_build_object('financial_event_id',opening_event) where id=first_tx;
  else update public.financial_events set source_record_id=first_tx where id=opening_event;end if;
  insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id) values(late_event,org,'OTHER','transactions',purchase);

  perform public.assign_financial_opening_source(org,'transactions',purchase,starts,starts,case when month=4 then '1600' else '1500' end,null,'Imported later with explicit fiscal effective date');
  perform public.assign_financial_opening_source(org,'transactions',purchase,starts,starts,case when month=4 then '1600' else '1500' end,null,'Idempotent import retry');
  if (select count(*) from public.financial_opening_source_assignments where organization_id=org and source_id=purchase)<>1 then raise exception 'assignment duplicated';end if;
  if month=1 then perform public.assign_financial_opening_source(org,'liquidity_accounts',bank,starts,starts,'1000',500,'Declared bank opening at start, distinct from current bank');end if;
  s:=public.financial_opening_workspace(org,starts);
  if (select count(*) from jsonb_array_elements(s->'source'->'rows') r cross join lateral jsonb_array_elements(r->'vouchers') v where v->>'canonicalId' like 'transactions:%')<>2 then raise exception 'opening source count %',s;end if;
  entries:='{}';
  for rr in select * from jsonb_array_elements(s->'source'->'rows') loop
   if jsonb_array_length(rr->'vouchers')=0 then entries:=entries||jsonb_build_object(rr->>'id',jsonb_build_object('amount','0','side',rr->>'normal'));end if;
  end loop;
  entries:=jsonb_set(entries,'{equity:3100}', '{"amount":"639","side":"CREDIT"}');
  w:=public.save_financial_opening(org,starts,0,s->'source'->>'revision',entries,'Unbalanced draft remains savable');
  if w->>'status'<>'DRAFT' then raise exception 'draft not saved';end if;
  begin perform public.approve_financial_opening((w->>'id')::uuid,1);raise exception 'unbalanced accepted';exception when others then if sqlerrm<>'OPENING_UNBALANCED' then raise;end if;end;
  entries:=jsonb_set(entries,'{equity:3100,amount}','"640"');
  w:=public.save_financial_opening(org,starts,1,s->'source'->>'revision',entries,'Balanced opening trial without per-row counter entries');
  w:=public.approve_financial_opening((w->>'id')::uuid,2);
  if (select sum((x->>'debit')::numeric) from jsonb_array_elements(w->'approved_opening') x)<>640 then raise exception 'opening amount';end if;
  insert into public.financial_classifications(id,organization_id,code,name,classification_type,created_by) values(classification,org,'FY-REVENUE','Annual revenue','REVENUE',owner),(tax,org,'FY-EXPENSE','Annual expense','OPEX',owner),(capex,org,'FY-PPE','Current asset purchase','CAPEX',owner);
  insert into public.financial_events(id,organization_id,event_type,source_module,source_event_key,event_date,status,base_currency,created_by)
   values(revenue,org,'REVENUE','FISCAL_QA','revenue',starts+90,'DRAFT','SAR',owner),(expense,org,'EXPENSE','FISCAL_QA','expense',starts+100,'DRAFT','SAR',owner),(purchase_event,org,'ASSET_PURCHASE','FISCAL_QA','purchase',starts+120,'DRAFT','SAR',owner);
  insert into public.financial_event_lines(event_id,organization_id,line_number,classification_id,amount,currency,exchange_rate,base_amount,cash_direction)
   values(revenue,org,1,classification,100,'SAR',1,100,'INFLOW'),(expense,org,1,tax,30,'SAR',1,30,'OUTFLOW'),(purchase_event,org,1,capex,60,'SAR',1,60,'OUTFLOW');
  update public.financial_events set status='ACTUAL',posted_by=owner,posted_at=now() where id in(revenue,expense,purchase_event);
  insert into public.liquidity_settlements(organization_id,account_id,direction,settlement_date,amount,currency,exchange_rate,base_currency,base_amount,source_module,source_event_key,financial_event_id,status,payload_fingerprint,created_by,posted_by)
   values(org,bank,'INFLOW',starts+90,100,'SAR',1,'SAR',100,'FISCAL_QA','cash-revenue',revenue,'POSTED','fixture',owner,owner),(org,bank,'OUTFLOW',starts+100,30,'SAR',1,'SAR',30,'FISCAL_QA','cash-expense',expense,'POSTED','fixture',owner,owner),
   (org,bank,'OUTFLOW',starts+120,60,'SAR',1,'SAR',60,'FISCAL_QA','cash-purchase',purchase_event,'POSTED','fixture',owner,owner);
  insert into public.asset_accounts(id,user_id,organization_id,ownership_scope,asset_type,name,currency) values(current_asset,owner,org,'ORGANIZATION','OTHER','Current-year purchased asset','SAR');
  insert into public.transactions(id,user_id,organization_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value,gross_value,metadata)
   values(purchase_tx,owner,org,current_asset,'PURCHASE',starts+120,1,'SAR','SAR',60,60,jsonb_build_object('financial_event_id',purchase_event));
  update public.financial_events set source_record_id=purchase_tx where id=purchase_event;
  rules:=jsonb_build_array(jsonb_build_object('eventType','REVENUE','sourceModule','FISCAL_QA','classificationId',classification||':BASE','cashDirection','INFLOW','debitAccountId','1000','creditAccountId','4100','cashActivity','OPERATING'),jsonb_build_object('eventType','EXPENSE','sourceModule','FISCAL_QA','classificationId',tax||':BASE','cashDirection','OUTFLOW','debitAccountId','6100','creditAccountId','1000','cashActivity','OPERATING'),jsonb_build_object('eventType','ASSET_PURCHASE','sourceModule','FISCAL_QA','classificationId',capex||':BASE','cashDirection','OUTFLOW','debitAccountId','1500','creditAccountId','1000','cashActivity','INVESTING'));
  if exists(select 1 from jsonb_array_elements(public.financial_opening_candidates(org,starts)) candidate where candidate->>'sourceId'=purchase_tx::text) then raise exception 'current purchase offered as an opening source';end if;
  policy:=public.save_financial_reporting_policy(org,starts,0,rules,'Annual current operations posting rules');policy:=public.approve_financial_reporting_policy((policy->>'id')::uuid,1);
  snap:=public.financial_statement_live_snapshot(org,starts,lastdate);
  if jsonb_array_length(snap->'events')<>3 then raise exception 'opening entered current journals %',snap->'events';end if;
  trial:=private.financial_fiscal_trial(snap,'3300');
  if trial->>'profit'<>'70.0000' then raise exception 'profit mismatch %',trial;end if;
  if (select x->>'closing' from jsonb_array_elements(trial->'trialBalance') x where x->>'accountId'='1000')<>'510.0000' then raise exception 'cash closing';end if;

  update public.financial_events set status='DRAFT' where id=expense;
  begin perform public.close_financial_year(org,starts,gen_random_uuid(),'Reject pending operations');raise exception 'pending close accepted';exception when others then if sqlerrm<>'FISCAL_PENDING_OPERATIONS' then raise;end if;end;
  update public.financial_events set status='ACTUAL' where id=expense;
  update public.transactions set base_value=61,gross_value=61 where id=purchase_tx;
  begin perform public.close_financial_year(org,starts,gen_random_uuid(),'Reject ledger and asset register mismatch');raise exception 'unreconciled register closed';exception when others then if sqlerrm<>'FISCAL_SUBLEDGER_UNRECONCILED' then raise;end if;end;
  update public.transactions set base_value=60,gross_value=60 where id=purchase_tx;
  s:=public.financial_opening_workspace(org,nextdate);
  w:=public.save_financial_opening(org,nextdate,0,s->'source'->>'revision','{}','Prepare a successor draft before closing the preceding year');
  begin perform public.approve_financial_opening((w->>'id')::uuid,1);raise exception 'successor approved before close';exception when others then if sqlerrm<>'FISCAL_PREVIOUS_YEAR_NOT_CLOSED' then raise;end if;end;
  req:=gen_random_uuid();close:=public.close_financial_year(org,starts,req,'Close full fiscal year after source reconciliation');
  insert into fiscal_snapshots values('year-'||month,jsonb_build_object('source',snap,'trial',trial,'closure',close));
  if public.close_financial_year(org,starts,req,'Retry closure')->>'id'<>close->>'id' then raise exception 'duplicate close';end if;
  if (select count(*) from public.financial_year_closures where organization_id=org and status='CLOSED')<>1 then raise exception 'closing duplicated';end if;
  s:=public.financial_opening_workspace(org,nextdate);
  if exists(select 1 from jsonb_array_elements(s->'source'->'rows') r where r->>'tab' is distinct from private.financial_opening_tab(r->>'accountCode')) then raise exception 'rollover tab mismatch';end if;
  if (select sum((v->>'debit')::numeric-(v->>'credit')::numeric) from jsonb_array_elements(s->'source'->'rows') r cross join lateral jsonb_array_elements(r->'vouchers') v)<>0 then raise exception 'next trial mismatch';end if;
  if (select sum((v->>'credit')::numeric-(v->>'debit')::numeric) from jsonb_array_elements(s->'source'->'rows') r cross join lateral jsonb_array_elements(r->'vouchers') v where r->>'accountCode'='3300')<>70 then raise exception 'retained earnings mismatch';end if;
  update public.asset_accounts set metadata=metadata||'{"investment_status":"ACTIVE"}' where id=asset;
  insert into public.asset_accounts(user_id,organization_id,ownership_scope,asset_type,name,currency) values(owner,org,'ORGANIZATION','OTHER','New master after a closed year','SAR') returning id into first_tx;
  update public.asset_accounts set name='Edited new master after close' where id=first_tx;
  delete from public.asset_accounts where id=first_tx;
  begin update public.transactions set base_value=101 where asset_account_id=asset;raise exception 'closed mutation accepted';exception when others then if sqlerrm<>'FISCAL_PERIOD_CLOSED' then raise;end if;end;
  insert into public.organization_members(organization_id,user_id,role,status) values(org,outsider,'VIEWER','ACTIVE');
  insert into public.organization_member_permission_overrides(organization_id,user_id,permission,effect,created_by) values(org,outsider,'financial_core.view','ALLOW',owner),(org,outsider,'financial_core.create','DENY',owner),(org,outsider,'financial_core.approve','DENY',owner),(org,outsider,'financial_core.post','DENY',owner);
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  execute 'set local role authenticated';
  if public.financial_fiscal_context(org,starts)->>'canClose'<>'false' then raise exception 'viewer close control';end if;
  begin perform public.close_financial_year(org,starts,gen_random_uuid(),'Viewer close attempt');raise exception 'viewer closed';exception when others then if sqlerrm<>'FISCAL_CLOSE_DENIED' then raise;end if;end;
  begin perform public.save_financial_fiscal_calendar(org,month,1,'3300',1,'Viewer cannot change calendar');raise exception 'viewer calendar saved';exception when others then if sqlerrm<>'FISCAL_WRITE_DENIED' then raise;end if;end;
  execute 'set local role postgres';
  delete from public.organization_members where organization_id=org and user_id=outsider;
  execute 'set local role authenticated';
  if exists(select 1 from public.financial_year_closures where organization_id=org) or exists(select 1 from public.financial_fiscal_calendars where organization_id=org) or exists(select 1 from public.financial_opening_source_assignments where organization_id=org) or exists(select 1 from public.financial_fiscal_audit where organization_id=org) then raise exception 'foreign fiscal RLS leak';end if;
  begin perform public.financial_fiscal_context(org,starts);raise exception 'foreign context';exception when others then if sqlerrm<>'FISCAL_ACCESS_DENIED' then raise;end if;end;
  begin perform public.close_financial_year(org,starts,gen_random_uuid(),'Foreign attempt');raise exception 'foreign close';exception when others then if sqlerrm<>'FISCAL_CLOSE_DENIED' then raise;end if;end;
  execute 'set local role postgres';
  perform set_config('request.jwt.claim.sub',owner::text,true);
  perform public.reopen_financial_year(org,(close->>'id')::uuid,1,'Documented correction before adopting next opening');
  update public.financial_event_lines set amount=31,base_amount=31 where event_id=expense;
  update public.liquidity_settlements set amount=31,base_amount=31 where financial_event_id=expense;
  update public.liquidity_accounts set current_balance=509,current_balance_base=509 where id=bank;
  close:=public.close_financial_year(org,starts,gen_random_uuid(),'Reclose revised expense');
  if (close->>'version')::int<>2 then raise exception 'closing correction not versioned';end if;
  if (select r->>'credit' from jsonb_array_elements(close->'next_opening') r where r->>'accountId'='3300')<>'69.0000' then raise exception 'corrected retained';end if;
  s:=public.financial_opening_workspace(org,nextdate);
  w:=public.save_financial_opening(org,nextdate,coalesce((s->'workspace'->>'version')::int,0),s->'source'->>'revision','{}','Adopt the exact closing trial as next opening');
  w:=public.approve_financial_opening((w->>'id')::uuid,(w->>'version')::int);
  if exists(select 1 from jsonb_array_elements(close->'next_opening') expected where (expected->>'debit')::numeric-(expected->>'credit')::numeric is distinct from (select sum((actual->>'debit')::numeric-(actual->>'credit')::numeric) from jsonb_array_elements(w->'approved_opening') actual where actual->>'accountCode'=expected->>'accountId')) then raise exception 'successor changed account balances';end if;
  if not exists(select 1 from jsonb_array_elements(s->'source'->'rows') r where r->>'id'='cash:'||bank and r->'vouchers'->0->>'debit'='509.0000') or not exists(select 1 from jsonb_array_elements(s->'source'->'rows') r where r->>'id'='asset:'||current_asset) then raise exception 'bank or asset identity lost in rollover';end if;
  begin perform public.reopen_financial_year(org,(close->>'id')::uuid,2,'Reject silent prior-year revision after successor approval');raise exception 'successor protection bypassed';exception when others then if sqlerrm<>'FISCAL_SUCCESSOR_REQUIRES_CORRECTION' then raise;end if;end;
  if (select count(*) from public.financial_fiscal_audit where organization_id=org and action='YEAR_CLOSE')<>2 or (select count(*) from public.financial_fiscal_audit where organization_id=org and action='YEAR_REOPEN')<>1 then raise exception 'audit versions missing';end if;
  policy:=public.save_financial_reporting_policy(org,nextdate,0,'[]','No new operations in the next financial year');policy:=public.approve_financial_reporting_policy((policy->>'id')::uuid,1);
  res:=public.close_financial_year(org,nextdate,gen_random_uuid(),'Close successor without duplicating prior balances');
  if res->'next_opening'<>close->'next_opening' then raise exception 'second year changed unchanged closing balances';end if;
  insert into fiscal_checks values('January/April independent period '||month||' with first-day, late opening, bank, operations, close, retry, correction, access isolation',true);
 end loop;
 org:=gen_random_uuid();perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.organizations(id,owner_user_id,name) values(org,owner,'Independent leap calendar fixture');
 insert into public.organization_members(organization_id,user_id,role,status) values(org,owner,'OWNER','ACTIVE') on conflict(organization_id,user_id) do update set role='OWNER',status='ACTIVE';
 if public.financial_fiscal_context(org,'2025-03-01')->'period'<>'null'::jsonb then raise exception 'calendar guessed for new organization';end if;
 perform public.save_financial_fiscal_calendar(org,2,29,'3300',0,'Explicit leap-day fiscal anchor');
 context:=public.financial_fiscal_context(org,'2024-02-29');
 if context->'period'->>'start'<>'2024-02-29' or context->'period'->>'end'<>'2025-02-27' then raise exception 'leap fiscal period mismatch';end if;
 context:=public.financial_fiscal_context(org,'2025-03-01');
 if context->'period'->>'start'<>'2025-02-28' or context->'period'->>'end'<>'2026-02-27' then raise exception 'nonleap fiscal anchor mismatch';end if;
 bank:=gen_random_uuid();insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata) values(bank,org,'Independent opening overdraft','BANK','SAR',-10,-10,owner,'{"opening_date":"2024-02-29","opening_balance":-10,"opening_fx_rate":1}');
 perform public.assign_financial_opening_source(org,'liquidity_accounts',bank,'2024-02-29','2024-02-29','1000',-10,'Explicit signed opening overdraft');
 s:=public.financial_opening_workspace(org,'2024-02-29');
 if not exists(select 1 from jsonb_array_elements(s->'source'->'rows') r where r->>'id'='cash:'||bank and r->'vouchers'->0->>'credit'='10.0000') then raise exception 'signed bank opening not preserved';end if;
 starts:=(private.financial_fiscal_period(org,(current_date+interval '2 years')::date)->>'start')::date;
 s:=public.financial_opening_workspace(org,starts);w:=public.save_financial_opening(org,starts,0,s->'source'->>'revision','{}','Prepare a future-year draft without approving future balances');
 begin perform public.approve_financial_opening((w->>'id')::uuid,1);raise exception 'future opening approved early';exception when others then if sqlerrm<>'FISCAL_OPENING_NOT_STARTED' then raise;end if;end;
  starts:=(private.financial_fiscal_period(org,(current_date+interval '6 years')::date)->>'start')::date;
  begin perform public.financial_opening_workspace(org,starts);raise exception 'out-of-horizon opening unexpectedly readable';exception when others then if sqlerrm<>'OPENING_PERIOD_INVALID' then raise;end if;end;
 insert into fiscal_checks values('Explicit new-organization calendar without a January default, leap and nonleap fiscal anchors',true);
end $$;
select jsonb_build_object('checks',(select jsonb_agg(to_jsonb(t) order by name) from fiscal_checks t),'snapshots',(select jsonb_agg(to_jsonb(s)) from fiscal_snapshots s));
rollback;
