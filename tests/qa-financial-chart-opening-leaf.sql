-- Disposable Supabase only. No data or approvals survive the rollback.
begin;
do $$
declare owner uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); bank uuid:=gen_random_uuid();
 source jsonb; saved jsonb;opening jsonb;policy jsonb;snapshot jsonb;trial jsonb;chart jsonb;first_cash jsonb;
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
 trial:=private.financial_fiscal_trial(snapshot,'3300');
 if (select r->>'opening' from jsonb_array_elements(trial->'trialBalance') r where r->>'accountId'='100001')<>'100.0000' then raise exception 'Leaf opening detail missing';end if;
 if (select r->>'debit' from jsonb_array_elements(trial->'nextOpening') r where r->>'accountId'='1000')<>'100.0000' then raise exception 'Cash leaf next-year rollup incorrect';end if;
 if (select r->>'credit' from jsonb_array_elements(trial->'nextOpening') r where r->>'accountId'='3100')<>'100.0000' then raise exception 'Equity leaf next-year rollup incorrect';end if;
 if exists(select 1 from jsonb_array_elements(trial->'nextOpening') r where length(r->>'accountId')>4) then raise exception 'Leaf double counted during year close';end if;

 -- A new unreferenced account does not rewrite previously approved statements.
 perform public.save_financial_chart_account(org,'100004','1000','بنك بلا حركة','Unused bank leaf','DEBIT',true,true,0,'Unreferenced catalog addition');
 if public.financial_statement_live_snapshot(org,'2024-01-01','2024-12-31')-'coverage'-'readAt'<>snapshot-'coverage'-'readAt' then raise exception 'Unrelated account changed approved statement';end if;
 perform set_config('request.jwt.claim.sub',other_owner::text,true);
 begin perform public.financial_opening_workspace(org,'2024-01-01');raise exception 'Foreign organization opening visible';
 exception when others then if sqlerrm<>'OPENING_ACCESS_DENIED' then raise;end if;end;
end $$;
select 'PASS opening leaf mapping, source identity, approval, cash reconciliation, rollup, chart lock and tenant isolation';
rollback;
