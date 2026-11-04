begin;
do $$
declare actor uuid:=gen_random_uuid();org uuid:=gen_random_uuid();other uuid:=gen_random_uuid();plan uuid:=gen_random_uuid();other_plan uuid:=gen_random_uuid();prior jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(actor,'fiscal-budget-'||actor||'@example.invalid',now());
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.organizations(id,owner_user_id,name) values(org,actor,'January budget fiscal fixture'),(other,actor,'July budget fiscal fixture');
 perform public.save_financial_fiscal_calendar(org,1,1,'3300',0,'January budget calendar fixture');
 perform public.save_financial_fiscal_calendar(other,7,1,'3300',0,'July budget calendar fixture');
 insert into public.budget_plans(id,user_id,name,fiscal_year,currency,scenario,status,organization_name,cost_center) values(plan,actor,'January plan',2026,'SAR','BASE','DRAFT','January budget fiscal fixture','HQ'),(other_plan,actor,'July plan',2026,'SAR','BASE','DRAFT','July budget fiscal fixture','HQ');
 insert into public.financial_budget_plan_ownership(plan_id,organization_id,fiscal_start,adopted_by) values(plan,org,'2026-01-01',actor),(other_plan,other,'2026-07-01',actor);
 prior:=(select to_jsonb(t) from public.financial_budget_plan_ownership t where plan_id=other_plan);
 begin update public.financial_budget_plan_ownership set fiscal_start='2026-01-01' where plan_id=other_plan;raise exception 'Budget accepted a foreign calendar';
 exception when others then if sqlerrm<>'FISCAL_BUDGET_PERIOD_REVIEW_REQUIRED' then raise;end if;end;
 if prior is distinct from (select to_jsonb(t) from public.financial_budget_plan_ownership t where plan_id=other_plan) then raise exception 'Budget was rewritten';end if;
 begin perform public.save_financial_fiscal_calendar(other,1,1,'3300',1,'Must not move existing budget fiscal dates');raise exception 'Used calendar changed';
 exception when others then if sqlerrm<>'FISCAL_CALENDAR_IN_USE' then raise;end if;end;
 if (private.financial_fiscal_period(other,'2026-11-04')->>'end')<>'2027-06-30' then raise exception 'July period mismatch';end if;
 if (private.financial_fiscal_period(org,'2026-11-04')->>'end')<>'2026-12-31' then raise exception 'January period mismatch';end if;
 update public.budget_plans set status='APPROVED' where id=other_plan;
 begin update public.financial_budget_plan_ownership set fiscal_start='2027-07-01' where plan_id=other_plan;raise exception 'Approved budget fiscal dates changed';
 exception when others then if sqlerrm<>'FISCAL_PERIOD_CLOSED' then raise;end if;end;
 -- Initial calendar configuration also preserves existing legacy budget dates.
 org:=gen_random_uuid();plan:=gen_random_uuid();
 insert into public.organizations(id,owner_user_id,name) values(org,actor,'Legacy budget fiscal fixture');
 insert into public.budget_plans(id,user_id,name,fiscal_year,currency,scenario,status,organization_name,cost_center) values(plan,actor,'Legacy plan',2026,'SAR','BASE','DRAFT','Legacy budget fiscal fixture','HQ');
 insert into public.financial_budget_plan_ownership(plan_id,organization_id,fiscal_start,adopted_by) values(plan,org,'2026-07-01',actor);
 begin perform public.save_financial_fiscal_calendar(org,1,1,'3300',0,'Wrong initial calendar for an existing budget');raise exception 'Legacy budget silently moved';
 exception when others then if sqlerrm<>'FISCAL_BUDGET_PERIOD_REVIEW_REQUIRED' then raise;end if;end;
 perform public.save_financial_fiscal_calendar(org,7,1,'3300',0,'Explicit matching calendar for a legacy budget');
end $$;
select 'PASS independent January/July budgets, mismatch protection, immutable approved bindings and legacy calendar review' as result;
rollback;
