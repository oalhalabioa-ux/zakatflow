
insert into public.financial_budget_plan_ownership(plan_id,organization_id,entity_id,cost_center_id,fiscal_start,adopted_by,legacy_snapshot)
select bp.id,o.id,null,c.id,make_date(bp.fiscal_year,1,1),bp.user_id,jsonb_build_object('user_id',bp.user_id,'fiscal_year',bp.fiscal_year,'currency',bp.currency,'scenario',bp.scenario)
from public.budget_plans bp join public.organizations o on o.name=bp.organization_name left join public.organization_cost_centers c on c.organization_id=o.id and c.code=bp.cost_center
where not exists(select 1 from public.financial_budget_plan_ownership x where x.plan_id=bp.id)
on conflict(plan_id) do nothing;
