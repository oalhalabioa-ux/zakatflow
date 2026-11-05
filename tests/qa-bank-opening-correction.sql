-- Real database, isolated organizations; rollback every fixture.
begin;
do $$
declare u uuid:=gen_random_uuid();o uuid;other uuid:=gen_random_uuid();b uuid;start_date date;s jsonb;after_s jsonb;old_token text;month int;flow_id uuid;flow_s jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@bank-opening.invalid',now());perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.organizations(id,owner_user_id,name) values(other,u,'QA opening foreign scope');
 for month in select * from (values(1),(7)) x(n) loop
  o:=gen_random_uuid();b:=gen_random_uuid();start_date:=make_date(2026,month,1);
  insert into public.organizations(id,owner_user_id,name) values(o,u,'QA bank opening correction '||month);
  insert into public.organization_members(organization_id,user_id,role,status) values(o,u,'OWNER','ACTIVE') on conflict(organization_id,user_id) do update set role='OWNER',status='ACTIVE';
  perform public.save_financial_fiscal_calendar(o,month,1,'3300',0,'Independent fiscal calendar fixture');
  insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata) values(b,o,'QA legacy bank','BANK','SAR',400000,400000,u,'{}');
  insert into public.liquidity_flows(organization_id,account_id,direction,flow_type,title,due_date,amount,currency,base_amount,status,source,created_by) values(o,b,'OUTFLOW','OTHER','QA actual payment','2026-10-15',50000,'SAR',50000,'ACTUAL','MANUAL',u),(o,b,'INFLOW','OTHER','QA forecast ignored','2026-10-15',999999,'SAR',999999,'EXPECTED','MANUAL',u);
  s:=public.financial_cash_opening_detail(o,b,start_date);
  if (s->>'amount')::numeric<>450000 or not(s->>'canEdit')::boolean then raise exception 'Opening reconstruction failed: %',s;end if;
  old_token:=s->>'token';
  after_s:=public.correct_financial_cash_opening(o,b,start_date,460000,1,old_token,'Correct to original bank opening statement');
  if (after_s->>'amount')::numeric<>460000 or (after_s->>'balance')::numeric<>410000 then raise exception 'Correction did not apply only the difference';end if;
  if (select count(*) from public.financial_events where organization_id=o)<>0 or (select count(*) from public.liquidity_settlements where organization_id=o)<>0 or (select count(*) from public.liquidity_flows where organization_id=o)<>2 then raise exception 'Correction created duplicate movements';end if;
  if (select count(*) from public.financial_fiscal_audit where organization_id=o and action='CASH_OPENING_CORRECT')<>1 then raise exception 'Correction not audited once';end if;
  begin perform public.correct_financial_cash_opening(o,b,start_date,460000,1,old_token,'Stale browser retry');raise exception 'Stale retry accepted';exception when raise_exception then if sqlerrm not like '%VERSION_CONFLICT%' then raise;end if;end;
  begin perform public.financial_cash_opening_detail(other,b,start_date);raise exception 'Foreign bank leaked';exception when raise_exception then if sqlerrm not like '%ACCESS_DENIED%' then raise;end if;end;
  if public.financial_cash_opening_detail(o,b,'2026-11-01')->>'issue'<>'FISCAL_CASH_DATE_AFTER_MOVEMENT' then raise exception 'Opening date after actual movement accepted';end if;
  select id into flow_id from public.liquidity_flows where organization_id=o and status='ACTUAL';
  flow_s:=public.financial_cash_flow_source(o,flow_id);
  perform public.describe_financial_cash_flow(o,flow_id,'QA corrected source description','Bank statement reference','Source reviewed',flow_s->>'token','Audited descriptive correction only');
  if not exists(select 1 from public.liquidity_flows where id=flow_id and amount=50000 and title='QA corrected source description' and status='ACTUAL') or (select current_balance from public.liquidity_accounts where id=b)<>410000 then raise exception 'Source description altered money';end if;
  begin perform public.describe_financial_cash_flow(o,flow_id,'Stale source edit','','',flow_s->>'token','Must reject stale edit');raise exception 'Stale source accepted';exception when raise_exception then if sqlerrm not like '%VERSION_CONFLICT%' then raise;end if;end;
  insert into public.financial_year_closures(organization_id,fiscal_start,fiscal_end,next_start,currency,version,status,request_id,source_revision,source_snapshot,trial_balance,next_opening,next_source,reason,created_by) values(o,start_date,(start_date+interval '1 year')::date-1,(start_date+interval '1 year')::date,'SAR',1,'CLOSED',gen_random_uuid(),md5('QA closed'),'{}','[]','[]','[]','Protected year fixture',u);
  flow_s:=public.financial_cash_flow_source(o,flow_id);if (flow_s->>'canEdit')::boolean then raise exception 'Closed source edit offered';end if;
  s:=public.financial_cash_opening_detail(o,b,start_date);
  if (s->>'canEdit')::boolean then raise exception 'Closed-year edit offered';end if;
  begin perform public.correct_financial_cash_opening(o,b,start_date,470000,1,s->>'token','Must not change a closed year');raise exception 'Closed correction accepted';exception when raise_exception then if sqlerrm not like '%CLOSED_SOURCE_CORRECTION_REQUIRED%' then raise;end if;end;
  if (select current_balance from public.liquidity_accounts where id=b)<>410000 then raise exception 'Rejected correction altered balance';end if;
 end loop;
end $$;
select 'PASS January/July calendars, legacy actual-only reconstruction, audited delta, stale retry, source isolation and closed-year correction guard' result;
rollback;
