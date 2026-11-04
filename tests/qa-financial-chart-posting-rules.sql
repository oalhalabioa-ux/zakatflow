-- Disposable database only: every organization and rule is rolled back.
begin;
do $$
declare owner uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();org uuid:=gen_random_uuid();other_org uuid:=gen_random_uuid();
 rules jsonb; saved jsonb;chart jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(owner,owner||'@chart-policy.invalid',now()),(outsider,outsider||'@chart-policy.invalid',now());
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.organizations(id,owner_user_id,name) values(org,owner,'Posting chart organization A');
 insert into public.organization_members(organization_id,user_id,role,status) values(org,owner,'OWNER','ACTIVE');
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 insert into public.organizations(id,owner_user_id,name) values(other_org,outsider,'Posting chart organization B');
 insert into public.organization_members(organization_id,user_id,role,status) values(other_org,outsider,'OWNER','ACTIVE');
 perform public.save_financial_chart_account(other_org,'610099','6100','مصروف سري','Private expense','DEBIT',true,true,0,'Fixture other org');
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform public.save_financial_chart_account(org,'100001','1000','بنك مخصص','Bank leaf','DEBIT',true,true,0,'Fixture cash leaf');
 perform public.save_financial_chart_account(org,'610001','6100','مصروف مخصص','Expense leaf','DEBIT',true,true,0,'Fixture expense leaf');
 perform public.save_financial_chart_account(org,'610002','6100','مصروف غير نشط','Inactive expense','DEBIT',true,false,0,'Fixture inactive leaf');
 perform public.save_financial_chart_account(org,'610003','6100','مجموعة مصروفات','Expense summary','DEBIT',false,true,0,'Fixture summary leaf');
 chart:=public.financial_chart_posting_accounts(org);
 if not exists(select 1 from jsonb_array_elements(chart) x where x->>'id'='610001' and x->>'kind'='OPEX' and x->>'reportingCode'='6100') then raise exception 'Leaf expense classification missing';end if;
 if not exists(select 1 from jsonb_array_elements(chart) x where x->>'id'='100001' and x->>'cash'='true' and x->>'kind'='ASSET') then raise exception 'Leaf cash classification missing';end if;
 if exists(select 1 from jsonb_array_elements(chart) x where x->>'id' in('610002','610003','610099')) then raise exception 'Inactive, summary or foreign leaf eligible for posting';end if;
 if jsonb_array_length(chart)<>jsonb_array_length(public.financial_reporting_chart())+2 then raise exception 'Catalog changed baseline controls or doubled a leaf';end if;
 rules:=jsonb_build_array(jsonb_build_object('eventType','EXPENSE','sourceModule','core','classificationId','office',
  'cashDirection','OUTFLOW','debitAccountId','610001','creditAccountId','100001','cashActivity','OPERATING'));
 saved:=public.save_financial_reporting_policy(org,'2026-01-01',0,rules,'Authorized leaf rule for isolated fixture');
 if saved->'rules'<>rules then raise exception 'Leaf policy not stored exactly';end if;
 if not exists(select 1 from jsonb_array_elements(public.financial_reporting_policy_workspace(org,'2026-01-01')->'chart') x where x->>'id'='610001') then raise exception 'Policy UI does not offer leaf';end if;
 begin perform public.save_financial_chart_account(org,'610001','6100','مصروف مخصص','Expense leaf','DEBIT',true,false,1,'Archive referenced account');raise exception 'Mapped account archived';exception when others then if sqlerrm<>'CHART_REFERENCED_BY_POLICY' then raise;end if;end;
 begin perform public.save_financial_chart_account(org,'100001','1000','بنك مخصص','Bank leaf','CREDIT',true,true,1,'Change referenced side');raise exception 'Mapped account changed side';exception when others then if sqlerrm<>'CHART_REFERENCED_BY_POLICY' then raise;end if;end;
 begin perform public.save_financial_chart_account(org,'610001','6100','مصروف مخصص','Expense leaf','DEBIT',false,true,1,'Make referenced account summary');raise exception 'Mapped account made summary';exception when others then if sqlerrm<>'CHART_REFERENCED_BY_POLICY' then raise;end if;end;
 perform public.save_financial_chart_account(org,'610001','6100','مصاريف المكتب','Office expenses','DEBIT',true,true,1,'Safe name update');
 begin perform public.save_financial_reporting_policy(org,'2026-01-01',1,jsonb_build_array(jsonb_build_object('eventType','EXPENSE','sourceModule','core','classificationId','office','cashDirection','NON_CASH','debitAccountId','610099','creditAccountId','2100')),'Reject foreign account');raise exception 'Foreign organization account used';exception when others then if sqlerrm<>'REPORTING_POLICY_INVALID' then raise;end if;end;
 begin perform public.save_financial_reporting_policy(org,'2026-01-01',1,jsonb_build_array(jsonb_build_object('eventType','EXPENSE','sourceModule','core','classificationId','office','cashDirection','NON_CASH','debitAccountId','610002','creditAccountId','2100')),'Reject inactive account');raise exception 'Inactive account used';exception when others then if sqlerrm<>'REPORTING_POLICY_INVALID' then raise;end if;end;
 begin perform public.save_financial_reporting_policy(org,'2026-01-01',1,jsonb_build_array(jsonb_build_object('eventType','EXPENSE','sourceModule','core','classificationId','office','cashDirection','NON_CASH','debitAccountId','610003','creditAccountId','2100')),'Reject summary account');raise exception 'Summary account used';exception when others then if sqlerrm<>'REPORTING_POLICY_INVALID' then raise;end if;end;
 if (select count(*) from public.financial_reporting_policies where organization_id=org)<>1 then raise exception 'Duplicate saved rules';end if;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin perform public.financial_chart_posting_accounts(org);raise exception 'Foreign posting chart readable';exception when others then if sqlerrm<>'CHART_ACCESS_DENIED' then raise;end if;end;
end $$;
-- A leaf cash account and a leaf expense must retain full trial detail while
-- producing one next-year opening row per original control account.
do $$
declare snapshot jsonb;result jsonb;
begin
 snapshot:='{
 "organizationId":"rollup-fixture","currency":"SAR","fiscalStart":"2026-01-01","to":"2026-12-31",
 "accounts":[
  {"id":"1000","kind":"ASSET","cash":true},
  {"id":"100001","kind":"ASSET","cash":true,"reportingCode":"1000"},
  {"id":"3100","kind":"EQUITY","cash":false},
  {"id":"3300","kind":"EQUITY","cash":false},
  {"id":"610001","kind":"OPEX","cash":false,"reportingCode":"6100"}
 ],
 "opening":[{"accountId":"1000","debit":"100","credit":"0"},{"accountId":"3100","debit":"0","credit":"100"}],
 "policy":{"approvedBy":"test-owner","rules":[{
  "eventType":"EXPENSE","sourceModule":"core","classificationId":"office","cashDirection":"OUTFLOW",
  "from":"2026-01-01","to":"2026-12-31","debitAccountId":"610001","creditAccountId":"100001","cashActivity":"OPERATING"
 }]},
 "events":[{"id":"event-1","organizationId":"rollup-fixture","currency":"SAR","date":"2026-02-01",
  "status":"ACTUAL","eventType":"EXPENSE","sourceModule":"core","lines":[{
   "id":"line-1","classificationId":"office","baseAmount":"10","cashDirection":"OUTFLOW","recognitionSign":1
  }]}],
 "controls":{"cashClosing":"90.0000"}
 }'::jsonb;
 result:=private.financial_fiscal_trial(snapshot,'3300');
 if result->>'profit'<>'-10.0000' then raise exception 'Leaf expense profit not recognized';end if;
 if (select r->>'closing' from jsonb_array_elements(result->'trialBalance') r where r->>'accountId'='100001')<>'-10.0000' then raise exception 'Leaf cash trial detail lost';end if;
 if jsonb_array_length(result->'nextOpening')<>3 then raise exception 'Leaf added duplicate next-year opening lines';end if;
 if (select r->>'debit' from jsonb_array_elements(result->'nextOpening') r where r->>'accountId'='1000')<>'90.0000' then raise exception 'Cash leaf not consolidated';end if;
 if (select r->>'debit' from jsonb_array_elements(result->'nextOpening') r where r->>'accountId'='3300')<>'10.0000' then raise exception 'Profit not carried into retained earnings';end if;
 if exists(select 1 from jsonb_array_elements(result->'nextOpening') r where length(r->>'accountId')>4) then raise exception 'Leaf leaked into successor opening';end if;
end $$;
select 'PASS scoped posting chart, leaf mappings, policy lock and unchanged controls';
rollback;
