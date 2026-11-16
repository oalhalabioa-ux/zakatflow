-- Explicit organization default roles. Parties remain in their native subledger.
create table public.financial_posting_account_roles (
 organization_id uuid not null references public.organizations(id),
 role text not null,
 account_code text not null,
 primary key(organization_id,role),
 foreign key(organization_id,account_code) references public.financial_chart_custom_accounts(organization_id,code)
);
alter table public.financial_posting_account_roles enable row level security;
revoke all on public.financial_posting_account_roles from public,anon,authenticated;
grant select on public.financial_posting_account_roles to authenticated;
create policy posting_roles_read on public.financial_posting_account_roles for select to authenticated
 using(private.financial_opening_can(organization_id,'financial_core.view'));

create function public.prepare_financial_posting_defaults(p_org uuid,p_fiscal_start date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare spec jsonb; code text; root text; chosen text; matches integer; result jsonb; slot integer;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'REPORTING_SAVE_DENIED';end if;
 if p_fiscal_start is null then raise exception 'REPORTING_SCOPE_INVALID';end if;
 perform private.financial_assert_open_period(p_org,p_fiscal_start);
 perform pg_advisory_xact_lock(hashtextextended('chart-accounts:'||p_org::text,0));
 -- Generic recognition uses explicit general accounts, never an arbitrary
 -- specialized child. Existing detail classifications keep their own accounts.
 for spec in select value from jsonb_array_elements('[
  ["1100","1100","ذمم العملاء","Trade receivables","DEBIT"],
  ["2100","2100","ذمم الموردين","Trade payables","CREDIT"],
  ["EMPLOYEE","1100","ذمم الموظفين","Employee receivables","DEBIT"],
  ["1200","1200","قروض ممنوحة","Loans receivable","DEBIT"],
  ["2200","2200","قروض وتمويل مستلم","Borrowings","CREDIT"],
  ["1300","1300","دفعات مقدمة للموردين","Supplier prepayments","DEBIT"],
  ["2400","2400","دفعات مقدمة من العملاء","Customer advances","CREDIT"],
  ["1400","1400","ضريبة مدخلات قابلة للاسترداد","Recoverable input VAT","DEBIT"],
  ["2300","2300","ضرائب مستحقة","Taxes payable","CREDIT"],
  ["1500","1500","أصول ثابتة عامة","General fixed assets","DEBIT"],
  ["1590","1590","مجمع إهلاك أصول عامة","General accumulated depreciation","CREDIT"],
  ["1600","1600","استثمارات عامة","General investments","DEBIT"],
  ["4100","4100","إيرادات عامة","General revenue","CREDIT"],
  ["6100","6100","مصروفات تشغيلية عامة","General operating expenses","DEBIT"],
  ["6200","6200","مصروف الإهلاك","Depreciation expense","DEBIT"],
  ["7100","7100","تكاليف تمويل","Finance costs","DEBIT"],
  ["8100","8100","مصروفات زكاة وضرائب عامة","General zakat and tax expense","DEBIT"]
 ]'::jsonb) loop
  root:=spec->>1;
  select account_code into chosen from public.financial_posting_account_roles where organization_id=p_org and role=spec->>0;
  if chosen is not null then
   if not exists(select 1 from public.financial_chart_custom_accounts a where a.organization_id=p_org and a.code=chosen and a.reporting_code=root and a.is_active and a.is_postable and not exists(select 1 from public.financial_chart_custom_accounts c where c.organization_id=p_org and c.parent_code=a.code)) then
    raise exception 'REPORTING_DEFAULT_ROLE_INVALID';
   end if;
   continue;
  end if;
  -- Reuse an exact semantic account when unique. Similar names or occupied
  -- account numbers are not evidence of the same accounting purpose.
  select count(*),min(a.code) into matches,chosen from public.financial_chart_custom_accounts a
   where a.organization_id=p_org and a.reporting_code=root and a.is_active and a.is_postable
    and a.normal_side=spec->>4 and (a.name_ar=spec->>2 or a.name_en=spec->>3)
    and not exists(select 1 from public.financial_chart_custom_accounts c where c.organization_id=p_org and c.parent_code=a.code);
  if matches>1 then raise exception 'REPORTING_DEFAULT_ROLE_AMBIGUOUS';end if;
  if chosen is null then
   select n into slot from generate_series(1,99) n where not exists(select 1 from public.financial_chart_custom_accounts a where a.organization_id=p_org and a.code=root||lpad(n::text,2,'0')) order by n limit 1;
   if slot is null then raise exception 'REPORTING_DEFAULT_ACCOUNT_CAPACITY';end if;
   code:=root||lpad(slot::text,2,'0');
   perform public.save_financial_chart_account(p_org,code,root,spec->>2,spec->>3,spec->>4,true,true,0,'Initialize organization posting role '||(spec->>0));
   chosen:=code;
  end if;
  insert into public.financial_posting_account_roles values(p_org,spec->>0,chosen);
 end loop;
 select jsonb_object_agg(role,account_code) into result from public.financial_posting_account_roles where organization_id=p_org;
 return result;
end $$;
revoke all on function public.prepare_financial_posting_defaults(uuid,date) from public,anon;
grant execute on function public.prepare_financial_posting_defaults(uuid,date) to authenticated;

-- Save and approve in ONE transaction. A source/permission/version failure
-- rolls back the candidate policy; the previously approved version stays live.
create function public.activate_financial_posting_defaults(p_org uuid,p_fiscal_start date,p_policy_id uuid,p_expected_version integer,p_rules jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_policy public.financial_reporting_policies%rowtype; saved jsonb;
begin
 if auth.uid() is null or not private.financial_opening_can(p_org,'financial_core.create') or not private.financial_opening_can(p_org,'financial_core.approve') or not private.financial_opening_can(p_org,'financial_core.post') then raise exception 'REPORTING_APPROVE_DENIED';end if;
 if p_fiscal_start is null then raise exception 'REPORTING_SCOPE_INVALID';end if;
 perform private.financial_assert_open_period(p_org,p_fiscal_start);
 perform pg_advisory_xact_lock(hashtextextended('reporting-policy:'||p_org::text||p_fiscal_start::text,0));
 select * into current_policy from public.financial_reporting_policies where organization_id=p_org and fiscal_start=p_fiscal_start and status in ('DRAFT','APPROVED') order by (status='DRAFT') desc,version desc limit 1 for update;
 if current_policy.id is distinct from p_policy_id or coalesce(current_policy.version,0)<>p_expected_version then raise exception 'REPORTING_VERSION_CONFLICT';end if;
 perform private.financial_assert_detailed_rules(p_org,p_rules);
 if current_policy.status='APPROVED' and current_policy.rules=p_rules then return to_jsonb(current_policy);end if;
 saved:=public.save_financial_reporting_policy(p_org,p_fiscal_start,case when current_policy.status='DRAFT' then current_policy.version else 0 end,p_rules,'Organization defaults — batch activation; explicit detail edits preserved');
 -- The first policy supplies the source templates used by account inheritance.
 perform public.prepare_financial_account_rule_links(p_org);
 select to_jsonb(p) into saved from public.financial_reporting_policies p where organization_id=p_org and fiscal_start=p_fiscal_start and status='DRAFT';
 if saved->>'reason' not like 'Organization defaults%' then
  saved:=public.save_financial_reporting_policy(p_org,p_fiscal_start,(saved->>'version')::integer,saved->'rules','Organization defaults — batch activation; explicit detail edits preserved');
 end if;
 perform private.financial_assert_detailed_rules(p_org,saved->'rules');
 return public.approve_financial_reporting_policy((saved->>'id')::uuid,(saved->>'version')::integer);
end $$;
revoke all on function public.activate_financial_posting_defaults(uuid,date,uuid,integer,jsonb) from public,anon;
grant execute on function public.activate_financial_posting_defaults(uuid,date,uuid,integer,jsonb) to authenticated;
notify pgrst,'reload schema';

-- After an organization has activated defaults, ordinary new detail accounts
-- inherit and activate in the same chart-save transaction for authorized owners.
-- Never approve a pre-existing manual draft as a side effect of adding an account.
create function private.financial_auto_activate_account_rules()
returns trigger language plpgsql security definer set search_path='' as $$
declare candidate public.financial_reporting_policies%rowtype;
begin
 if not private.financial_opening_can(new.organization_id,'financial_core.approve') or not private.financial_opening_can(new.organization_id,'financial_core.post') then return new;end if;
 for candidate in select p.* from public.financial_reporting_policies p
  where p.organization_id=new.organization_id and p.status='DRAFT'
   and p.reason like 'Automatic %account%'
   and p.version=1
   and exists(select 1 from public.financial_reporting_policies a where a.organization_id=p.organization_id and a.fiscal_start=p.fiscal_start and a.status in ('APPROVED','SUPERSEDED') and a.reason like 'Organization defaults%')
 loop
  begin
   perform private.financial_assert_detailed_rules(new.organization_id,candidate.rules);
   perform public.approve_financial_reporting_policy(candidate.id,candidate.version);
  exception when raise_exception then
   -- Mapping/source/self-approval gates stay authoritative. Retain the draft
   -- instead of failing unrelated chart creation or bypassing organization policy.
   if sqlerrm not like 'REPORTING_%' and sqlerrm not like 'FISCAL_%' then raise;end if;
  end;
 end loop;
 return new;
end $$;
revoke all on function private.financial_auto_activate_account_rules() from public,anon,authenticated;
create trigger zz_financial_auto_activate_account_rules
 after insert on public.financial_chart_custom_accounts for each row execute function private.financial_auto_activate_account_rules();
