-- Platform Admin QA only: weucywfwbdnomtlkjurl
-- Applied to isolated QA on 2026-10-27. Never run against Production or FATOORA QA.
create or replace function public.owner_list_plans()
returns table(id uuid,code text,name_ar text,name_en text,price_amount numeric,currency text,billing_interval text,is_active boolean,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 return query select p.id,p.code,p.name_ar,p.name_en,p.price_amount,p.currency,p.billing_interval,p.is_active,p.created_at from public.platform_plans p order by p.created_at desc limit 200;
end $$;
create or replace function public.owner_list_subscriptions()
returns table(id uuid,organization_name text,plan_name text,status text,started_at timestamptz,current_period_end timestamptz,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if not public.owner_authorized() then raise exception 'forbidden' using errcode='42501'; end if;
 return query select s.id,o.name,p.name_ar,s.status,s.started_at,s.current_period_end,s.created_at from public.platform_subscriptions s join public.platform_organizations o on o.id=s.organization_id join public.platform_plans p on p.id=s.plan_id order by s.created_at desc limit 200;
end $$;
revoke all on function public.owner_list_plans() from public,anon;
revoke all on function public.owner_list_subscriptions() from public,anon;
grant execute on function public.owner_list_plans() to authenticated;
grant execute on function public.owner_list_subscriptions() to authenticated;
