-- Disposable QA database only. All fixture records roll back.
begin;
do $$
declare owner uuid:=gen_random_uuid();org uuid:=gen_random_uuid();bank uuid:=gen_random_uuid();
 source jsonb;draft jsonb;approved jsonb;entries jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(owner,owner||'@equity-opening.invalid',now());
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.organizations(id,owner_user_id,name) values(org,owner,'Isolated equity opening test');
 insert into public.organization_members(organization_id,user_id,role,status) values(org,owner,'OWNER','ACTIVE');
 perform public.save_financial_chart_account(org,'310001','3100','رأس مال شريك 1','Partner 1 capital','CREDIT',true,true,0,'Partner 1');
 perform public.save_financial_chart_account(org,'310002','3100','رأس مال شريك 2','Partner 2 capital','CREDIT',true,true,0,'Partner 2');
 perform public.save_financial_chart_account(org,'320001','3200','احتياطي نظامي','Statutory reserve','CREDIT',true,true,0,'Reserve');
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
 values(bank,org,'Initial bank','BANK','SAR',250,250,owner,'{"opening_date":"2023-12-31","opening_balance":250,"opening_fx_rate":1}');
 source:=public.financial_opening_workspace(org,'2024-01-01');
 if not exists(select 1 from jsonb_array_elements(source->'chart') a where a->>'code'='320001' and a->>'reportingCode'='3200')
  then raise exception 'Statutory reserve missing from opening account choices';end if;

 entries:=jsonb_build_object(
  'equity:3100',jsonb_build_object('amount','100','side','CREDIT','accountCode','310001'),
  'equity-child:310002',jsonb_build_object('amount','50','side','CREDIT'),
  'equity:3200',jsonb_build_object('amount','100','side','CREDIT','accountCode','320001'),
  'equity:3300',jsonb_build_object('amount','0','side','CREDIT'));

 -- A source-backed partner amount cannot be entered twice as a second child row.
 begin
  perform public.save_financial_opening(org,'2024-01-01',0,source->'source'->>'revision',
   entries||jsonb_build_object('equity-child:310001',jsonb_build_object('amount','100','side','CREDIT')),'Duplicate partner rejection');
  raise exception 'Duplicate partner opening was accepted';
 exception when others then if sqlerrm<>'OPENING_ENTRY_INVALID' then raise;end if;end;

 draft:=public.save_financial_opening(org,'2024-01-01',0,source->'source'->>'revision',entries,'Independent partners and linked reserve');
 if draft->>'status'<>'DRAFT' or draft->'entries'->'equity:3100'->>'amount'<>'100'
  or draft->'entries'->'equity-child:310002'->>'amount'<>'50'
  or draft->'entries'->'equity:3200'->>'accountCode'<>'320001'
  then raise exception 'Equity draft did not preserve independent amounts and reserve link';end if;

 -- A saved second partner prevents silent deactivation of the detail account.
 begin
  perform public.save_financial_chart_account(org,'310002','3100','رأس مال شريك 2','Partner 2 capital','CREDIT',true,false,1,'Disallow orphaning draft');
  raise exception 'Referenced child account could be deactivated';
 exception when others then if sqlerrm<>'CHART_REFERENCED_BY_OPENING' then raise;end if;end;

 approved:=public.approve_financial_opening((draft->>'id')::uuid,(draft->>'version')::integer);
 if approved->>'status'<>'APPROVED' then raise exception 'Valid additional equity row was not approved';end if;
 if (select count(*) from jsonb_array_elements(approved->'approved_opening') a
  where a->>'accountCode' in('310001','310002','320001'))<>3 then raise exception 'Equity leaf amounts repeated or disappeared';end if;
 if (select sum((a->>'debit')::numeric-(a->>'credit')::numeric) from jsonb_array_elements(approved->'approved_opening') a)<>0
  then raise exception 'Independent equity lines failed balance test';end if;
 if (select (a->>'credit')::numeric from jsonb_array_elements(approved->'approved_opening') a where a->>'accountCode'='320001')<>100
  then raise exception 'Linked reserve amount changed or doubled';end if;
end $$;
select 'PASS reserve leaf selection, two partner rows, retained draft, duplicate rejection, posting and chart guard';
rollback;
