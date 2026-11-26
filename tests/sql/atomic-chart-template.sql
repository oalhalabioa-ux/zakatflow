begin;
create temporary table chart_fixture as select gen_random_uuid() actor, gen_random_uuid() org;
grant select on chart_fixture to authenticated;
insert into auth.users(id,email,email_confirmed_at) select actor, actor||'@chart.invalid',now() from chart_fixture;
select set_config('request.jwt.claim.sub',actor::text,true) from chart_fixture;
insert into public.organizations(id,owner_user_id,name) select org,actor,'Synthetic chart template' from chart_fixture;
insert into public.organization_members(organization_id,user_id,role,status)
select org,actor,'OWNER','ACTIVE' from chart_fixture on conflict do nothing;
set local role authenticated;
do $$
declare
 org_id uuid := (select org from chart_fixture);
 first_leaf jsonb := '{"code":"610081","parentCode":"6100","nameAr":"مصروفات","nameEn":"Expense","normalSide":"DEBIT"}';
 second_leaf jsonb := first_leaf || '{"code":"610082","nameEn":"Overheads"}';
 batch jsonb := jsonb_build_array(first_leaf,second_leaf);
begin
 perform public.apply_financial_chart_template(org_id,'GENERAL',jsonb_build_array(second_leaf));
 begin
  perform public.apply_financial_chart_template(org_id,'GENERAL',
    jsonb_build_array(first_leaf,second_leaf || '{"nameEn":"Conflict"}'));
  raise exception 'expected collision';
 exception when others then if sqlerrm <> 'CHART_TEMPLATE_CONFLICT' then raise; end if; end;
 if exists(select from public.financial_chart_custom_accounts where organization_id=org_id and code='610081') then
  raise exception 'partial activation'; end if;
 if public.apply_financial_chart_template(org_id,'GENERAL',batch)<>1 then raise exception 'missing leaf'; end if;
 if public.apply_financial_chart_template(org_id,'GENERAL',batch)<>0 then raise exception 'duplicate activation'; end if;
 if (select count(*) from public.financial_chart_account_audit where organization_id=org_id and reason='Activate industry template GENERAL')<>2 then
  raise exception 'audit count'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.apply_financial_chart_template(org_id,'GENERAL',batch);
  raise exception 'cross organization activation';
 exception when others then if sqlerrm not in ('CHART_WRITE_DENIED','CHART_ACCESS_DENIED') then raise; end if; end;
end $$;
select 'PASS atomic chart activation, rollback, replay, audit and tenant isolation';
rollback;
