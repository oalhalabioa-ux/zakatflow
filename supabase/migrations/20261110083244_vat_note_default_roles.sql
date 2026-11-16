-- Add explicit refund control roles; preserve all existing role assignments.
create or replace function public.prepare_financial_posting_defaults(p_org uuid,p_fiscal_start date)
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
  ["1800","1800","مبالغ مستردة من الموردين","Supplier refunds receivable","DEBIT"],
  ["2500","2500","مبالغ مستردة للعملاء","Customer refunds payable","CREDIT"],
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
