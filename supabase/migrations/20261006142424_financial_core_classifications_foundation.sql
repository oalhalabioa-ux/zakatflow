create table if not exists public.financial_classifications(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 code text not null,name text not null,classification_type text not null,active boolean not null default true,is_system boolean not null default false,
 metadata jsonb not null default '{}'::jsonb,created_by uuid not null default auth.uid(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,code)
);
alter table public.financial_classifications enable row level security;
drop policy if exists financial_classifications_member_read on public.financial_classifications;
create policy financial_classifications_member_read on public.financial_classifications for select to authenticated using(exists(select 1 from public.organization_members m where m.organization_id=financial_classifications.organization_id and m.user_id=auth.uid() and m.status='ACTIVE'));
grant select on public.financial_classifications to authenticated;
insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)
select o.id,x.code,x.code,x.code,true,coalesce(o.owner_user_id,m.user_id)
from public.organizations o
left join lateral(select user_id from public.organization_members where organization_id=o.id and status='ACTIVE' and role='OWNER' order by created_at limit 1)m on true
cross join (values('REVENUE'),('OPEX'),('CAPEX'),('ASSET'),('INVESTMENT'),('TAX'),('RECEIVABLE'),('PAYABLE'),('LIABILITY'),('EQUITY'),('FINANCING'),('TRANSFER'),('ZAKAT'),('OTHER')) x(code)
where coalesce(o.owner_user_id,m.user_id) is not null
on conflict(organization_id,code) do nothing;