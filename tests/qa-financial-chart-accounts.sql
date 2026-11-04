-- Executed only on disposable Supabase. Every synthetic record is rolled back.
begin;
do $$
declare owner uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); foreign_org uuid:=gen_random_uuid();
 w jsonb; a jsonb; b jsonb; original_chart jsonb:=public.financial_reporting_chart();
begin
 insert into auth.users(id,email,email_confirmed_at) values(owner,owner||'@chart.invalid',now()),(outsider,outsider||'@chart.invalid',now());
 perform set_config('request.jwt.claim.sub',owner::text,true);
 insert into public.organizations(id,owner_user_id,name) values(org,owner,'Chart fixture A');
 insert into public.organization_members(organization_id,user_id,role,status) values(org,owner,'OWNER','ACTIVE');
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 insert into public.organizations(id,owner_user_id,name) values(foreign_org,outsider,'Chart fixture B');
 insert into public.organization_members(organization_id,user_id,role,status) values(foreign_org,outsider,'OWNER','ACTIVE');
 perform set_config('request.jwt.claim.sub',owner::text,true);
 w:=public.financial_chart_workspace(org);
 if jsonb_array_length(w->'accounts')<>jsonb_array_length(original_chart) or w->>'postingIntegration'<>'POLICY_AND_OPENING' then raise exception 'Base chart or integration status changed';end if;
 a:=public.save_financial_chart_account(org,'100001','1000','بنك الاختبار','Fixture bank','DEBIT',true,true,0,'Create a bank child');
 if a->>'reporting_code'<>'1000' or (a->>'version')::int<>1 then raise exception 'Initial custom account incorrect';end if;
 if not exists(select 1 from jsonb_array_elements(public.financial_chart_workspace(org)->'accounts') x where x->>'code'='100001' and x->>'reportingCode'='1000') then raise exception 'Custom account not returned';end if;
 begin perform public.financial_chart_workspace(foreign_org);raise exception 'Foreign chart readable';exception when others then if sqlerrm<>'CHART_ACCESS_DENIED' then raise;end if;end;
 begin perform public.save_financial_chart_account(org,'100001','1000','بنك الاختبار','Fixture bank','DEBIT',true,true,0,'Stale update');raise exception 'Stale update accepted';exception when others then if sqlerrm<>'CHART_VERSION_CONFLICT' then raise;end if;end;
 begin perform public.save_financial_chart_account(org,'100001','1100','بنك الاختبار','Fixture bank','DEBIT',true,true,1,'Reparenting');raise exception 'Reparent accepted';exception when others then if sqlerrm<>'CHART_INPUT_INVALID' then raise;end if;end;
 begin perform public.save_financial_chart_account(org,'10000101','100001','حساب فرعي','Nested child','DEBIT',true,true,0,'Nested under posting account');raise exception 'Posting parent accepted';exception when others then if sqlerrm<>'CHART_PARENT_IS_POSTABLE' then raise;end if;end;
 b:=public.save_financial_chart_account(org,'100001','1000','بنك الاختبار','Fixture bank','DEBIT',false,true,1,'Turn into summary account');
 if (b->>'version')::int<>2 then raise exception 'Revision not increased';end if;
 perform public.save_financial_chart_account(org,'10000101','100001','حساب فرعي','Nested child','DEBIT',true,true,0,'Create a nested child');
 begin perform public.save_financial_chart_account(org,'100001','1000','بنك الاختبار','Fixture bank','DEBIT',true,true,2,'Make parent postable');raise exception 'Parent restored to posting';exception when others then if sqlerrm<>'CHART_HAS_ACTIVE_CHILDREN' then raise;end if;end;
 begin perform public.save_financial_chart_account(org,'100001','1000','بنك الاختبار','Fixture bank','DEBIT',false,false,2,'Hide active parent');raise exception 'Parent archived with active child';exception when others then if sqlerrm<>'CHART_HAS_ACTIVE_CHILDREN' then raise;end if;end;
 if (select count(*) from public.financial_chart_account_audit where organization_id=org)<>3 then raise exception 'Chart audit missing';end if;
 if public.financial_reporting_chart()<>original_chart then raise exception 'Approved reporting chart was altered';end if;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 begin perform public.financial_chart_workspace(org);raise exception 'Foreign chart readable';exception when others then if sqlerrm<>'CHART_ACCESS_DENIED' then raise;end if;end;
 begin perform public.save_financial_chart_account(org,'100003','1000','ممنوع','Forbidden','DEBIT',true,true,0,'Foreign writer');raise exception 'Foreign chart writable';exception when others then if sqlerrm<>'CHART_WRITE_DENIED' then raise;end if;end;
 perform public.save_financial_chart_account(foreign_org,'100001','1000','نقد المؤسسة الأخرى','Other organization cash','DEBIT',true,true,0,'Independent organization');
 if (select count(*) from public.financial_chart_custom_accounts where organization_id in(org,foreign_org) and code='100001')<>2 then raise exception 'Same code not isolated by organization';end if;
 execute 'set local role authenticated';
 if exists(select 1 from public.financial_chart_custom_accounts where organization_id=org) then raise exception 'Custom account RLS leaked';end if;
 begin insert into public.financial_chart_custom_accounts(organization_id,code,parent_code,reporting_code,name_ar,name_en,normal_side,created_by,updated_by)
 values(foreign_org,'100009','1000','1000','محاولة','Attempt','DEBIT',outsider,outsider);raise exception 'Direct write succeeded';
 exception when insufficient_privilege then null;end;
 execute 'set local role postgres';
end $$;
select 'PASS isolated organization charts, hierarchy, immutable controls, RLS and audit';
rollback;
