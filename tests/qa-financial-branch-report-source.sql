-- Disposable Supabase only. No data or approvals survive the rollback.
begin;
do $$
declare owner uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); bank uuid:=gen_random_uuid();
 branch uuid:=gen_random_uuid(); event_a uuid:=gen_random_uuid();event_b uuid:=gen_random_uuid();classification uuid:=gen_random_uuid(); dim jsonb; entries jsonb; dist jsonb; source jsonb; saved jsonb;opening jsonb;policy jsonb;snapshot jsonb;trial jsonb;chart jsonb;first_cash jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values
 (owner,owner||'@opening-leaf.invalid',now()),
 (other_owner,other_owner||'@opening-leaf.invalid',now());
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.organizations(id,owner_user_id,name) values(org,owner,'Opening custom leaf fixture A');
 insert into public.organization_members(organization_id,user_id,role,status) values(org,owner,'OWNER','ACTIVE');
 perform set_config('request.jwt.claim.sub',other_owner::text,true);
 insert into public.organizations(id,owner_user_id,name) values(other_org,other_owner,'Opening custom leaf fixture B');
 insert into public.organization_members(organization_id,user_id,role,status) values(other_org,other_owner,'OWNER','ACTIVE');
 perform public.save_financial_chart_account(other_org,'100099','1000','بنك مؤسسة أخرى','Foreign bank','DEBIT',true,true,0,'Independent organization');
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform public.save_financial_chart_account(org,'100001','1000','بنك التجربة','Test bank leaf','DEBIT',true,true,0,'Opening cash account');
 perform public.save_financial_chart_account(org,'310001','3100','رأس المال الفرعي','Capital leaf','CREDIT',true,true,0,'Opening capital account');
 perform public.save_financial_chart_account(org,'100002','1000','بنك غير نشط','Inactive bank','DEBIT',true,false,0,'Inactive fixture');
 perform public.save_financial_chart_account(org,'100003','1000','بنك تجميعي','Bank summary','DEBIT',false,true,0,'Summary fixture');
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
 values(bank,org,'Opening source bank','BANK','SAR',100,100,owner,'{"opening_date":"2023-12-31","opening_balance":100,"opening_fx_rate":1}');

 source:=public.financial_opening_workspace(org,'2024-01-01');
 chart:=source->'chart';
 if not exists(select 1 from jsonb_array_elements(chart) a where a->>'code'='100001' and a->>'reportingCode'='1000') then raise exception 'Opening UI missing the cash leaf';end if;
 if exists(select 1 from jsonb_array_elements(chart) a where a->>'code' in('100002','100003','100099')) then raise exception 'Opening UI offers inactive, summary or foreign leaf';end if;

 -- The existing source row stays singular. The selected posting account is a
 -- stored mapping of the entire row, not a new or re-dated source voucher.
 if (select jsonb_array_length(r->'vouchers') from jsonb_array_elements(source->'source'->'rows') r where r->>'id'='cash:'||bank)<>1 then raise exception 'Fixture bank source missing or repeated';end if;
 first_cash:=(select r from jsonb_array_elements(source->'source'->'rows') r where r->>'id'='cash:'||bank);
 if first_cash->>'accountCode'<>'1000' then raise exception 'Original source control account changed';end if;

 -- A foreign account, an inactive account, an aggregate, or a leaf belonging
 -- to the wrong control can never be attached to the opening source row.
 foreach chart in array array['{"accountCode":"100099"}'::jsonb,'{"accountCode":"100002"}'::jsonb,
   '{"accountCode":"100003"}'::jsonb,'{"accountCode":"310001"}'::jsonb] loop
  begin
   perform public.save_financial_opening(org,'2024-01-01',0,source->'source'->>'revision',
    jsonb_build_object('cash:'||bank,jsonb_build_object('amount','','side','DEBIT','accountCode',chart->>'accountCode')),'Invalid leaf attempt');
   raise exception 'Invalid opening leaf accepted: %',chart->>'accountCode';
  exception when others then
   if sqlerrm<>'OPENING_ENTRY_INVALID' then raise;end if;
  end;
 end loop;

 saved:=public.save_financial_opening(org,'2024-01-01',0,source->'source'->>'revision',
  jsonb_build_object('cash:'||bank,jsonb_build_object('amount','','side','DEBIT','accountCode','100001'),
   'equity:3100',jsonb_build_object('amount','100','side','CREDIT','accountCode','310001'),
   'equity:3200',jsonb_build_object('amount','0','side','CREDIT'),
   'equity:3300',jsonb_build_object('amount','0','side','CREDIT')),'Source maps to org leaf without reclassification');
 if saved->>'status'<>'DRAFT' then raise exception 'Opening cannot be saved as a draft';end if;

 begin
  perform public.save_financial_chart_account(org,'100001','1000','بنك التجربة','Test bank leaf','DEBIT',true,false,1,'Disable referenced draft account');
  raise exception 'Referenced draft account could be disabled';
 exception when others then if sqlerrm<>'CHART_REFERENCED_BY_OPENING' then raise;end if;
 end;

 opening:=public.approve_financial_opening((saved->>'id')::uuid,(saved->>'version')::integer);
 if opening->>'status'<>'APPROVED' then raise exception 'Valid leaf opening not approved';end if;
 if (select count(*) from jsonb_array_elements(opening->'approved_opening') a where a->>'accountCode'='100001')<>1 then raise exception 'Cash leaf opening repeated or lost';end if;
 if (select sum((a->>'debit')::numeric-(a->>'credit')::numeric) from jsonb_array_elements(opening->'approved_opening') a)<>0 then raise exception 'Leaf opening debit/credit unbalanced';end if;

 policy:=public.save_financial_reporting_policy(org,'2024-01-01',0,'[]','Empty policy no source events');
 perform public.approve_financial_reporting_policy((policy->>'id')::uuid,(policy->>'version')::integer);
 snapshot:=public.financial_statement_live_snapshot(org,'2024-01-01','2024-12-31');
 if (select count(*) from jsonb_array_elements(snapshot->'accounts') a where a->>'id' in('100001','310001'))<>2 then raise exception 'Opening-only leaf omitted from the statement chart';end if;
 if (snapshot->'controls'->>'cashClosing')::numeric<>100 then raise exception 'Custom cash leaf not counted by cash reconciliation';end if;
 insert into public.organization_entities(id,organization_id,name,entity_type,active)
 values(branch,org,'Report branch fixture','BRANCH',true);
 begin perform public.financial_branch_report_source(org,'2024-01-01','2024-12-31');
  raise exception 'Missing distribution accepted';
 exception when others then if sqlerrm<>'REPORTING_BRANCH_OPENING_REQUIRED' then raise;end if;end;
 select jsonb_object_agg(r->>'itemId',jsonb_build_array(jsonb_build_object(
  'branchId',branch,'debit',r->>'debit','credit',r->>'credit'))) into entries
 from jsonb_array_elements(opening->'approved_opening') r;
 dist:=public.save_financial_branch_opening(org,'2024-01-01',0,(opening->>'id')::uuid,
  (opening->>'version')::int,entries,'Report source fixture');
 perform public.approve_financial_branch_opening((dist->>'id')::uuid,(dist->>'version')::int);
 dim:=public.financial_branch_report_source(org,'2024-01-01','2024-12-31');
 if dim->'source'<>snapshot or dim->'distribution'->>'status'<>'APPROVED'
  or jsonb_array_length(dim->'journalEvidence'->'links')<>0
  or length(dim->>'revision')<>32 then raise exception 'Atomic report source mismatch';end if;
 -- Genuine posted canonical movements, one branch and one headquarters.
 perform public.save_financial_chart_account(org,'110001','1100','ذمم العملاء','Customers','DEBIT',true,true,0,'Branch report fixture');
 perform public.save_financial_chart_account(org,'410001','4100','الإيرادات','Revenue','CREDIT',true,true,0,'Branch report fixture');
 insert into public.financial_classifications(id,organization_id,code,name,classification_type,created_by)
 values(classification,org,'BRANCH_REPORT_QA','Branch report revenue','REVENUE',owner);
 insert into public.financial_events(id,organization_id,entity_id,event_type,source_module,source_event_key,event_date,status,base_currency,created_by)
 values(event_a,org,branch,'REVENUE','BRANCH_REPORT_QA','branch-sale','2024-02-01','DRAFT','SAR',owner),
 (event_b,org,null,'REVENUE','BRANCH_REPORT_QA','hq-sale','2024-02-01','DRAFT','SAR',owner);
 insert into public.financial_event_lines(event_id,organization_id,line_number,classification_id,amount,currency,exchange_rate,base_amount,cash_direction)
 values(event_a,org,1,classification,10,'SAR',1,10,'NON_CASH'),
 (event_b,org,1,classification,20,'SAR',1,20,'NON_CASH');
 update public.financial_events set status='ACTUAL',posted_by=owner,posted_at=now() where id in(event_a,event_b);
 policy:=public.save_financial_reporting_policy(org,'2024-01-01',0,jsonb_build_array(jsonb_build_object(
  'eventType','REVENUE','sourceModule','BRANCH_REPORT_QA','classificationId',classification::text||':BASE',
  'cashDirection','NON_CASH','debitAccountId','110001','creditAccountId','410001')),'Map branch source revenue');
 perform public.approve_financial_reporting_policy((policy->>'id')::uuid,(policy->>'version')::integer);
 dim:=public.financial_branch_report_source(org,'2024-01-01','2024-12-31');
 if jsonb_array_length(dim->'journalEvidence'->'links')<>2
  or not exists(select 1 from jsonb_array_elements(dim->'journalEvidence'->'links') l
   where l->>'journalId'=event_a::text and l->>'branchId'=branch::text)
  or not exists(select 1 from jsonb_array_elements(dim->'journalEvidence'->'links') l
   where l->>'journalId'=event_b::text and l->'branchId'='null'::jsonb)
 then raise exception 'Canonical branch attribution mismatch';end if;
 -- A newer editable draft must not hide the operative approved distribution.
 perform public.save_financial_branch_opening(org,'2024-01-01',0,(opening->>'id')::uuid,
  (opening->>'version')::int,entries,'Draft must not override approved source');
 if public.financial_branch_report_source(org,'2024-01-01','2024-12-31')->'distribution'->>'status'<>'APPROVED'
 then raise exception 'Draft shadowed approved allocation';end if;
 update public.organization_entities set active=false where id=branch;
 dim:=public.financial_branch_report_source(org,'2024-01-01','2024-12-31');
 if not exists(select 1 from jsonb_array_elements(dim->'entities') x where x->>'id'=branch::text and (x->>'active')::boolean=false)
 then raise exception 'Inactive branch history missing';end if;
 perform set_config('request.jwt.claim.sub',other_owner::text,true);
 begin perform public.financial_branch_report_source(org,'2024-01-01','2024-12-31');raise exception 'Foreign organization report visible';
 exception when others then if sqlerrm<>'REPORTING_ACCESS_DENIED' then raise;end if;end;
end $$;
select 'PASS atomic branch source, missing distribution, approved-over-draft, inactive history and tenant isolation';
rollback;
