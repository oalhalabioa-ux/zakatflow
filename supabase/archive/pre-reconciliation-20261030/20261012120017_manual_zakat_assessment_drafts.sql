-- Separate, immutable manual review drafts. Never consumed by lot/cycle liabilities.
create table public.manual_zakat_assessments (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 organization_id uuid references public.organizations(id) on delete restrict,
 request_id uuid not null,
 model text not null check(model in ('PERSONAL','SIMPLE','SAUDI')),
 title text not null check(length(title) between 1 and 150),
 assessment_date date not null,
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 source text not null default 'MANUAL' check(source='MANUAL'),
 status text not null check((model='SAUDI' and status='REGULATORY_REVIEW') or (model in('PERSONAL','SIMPLE') and status='DRAFT')),
 schema_version integer not null default 1 check(schema_version=1),
 input jsonb not null check(jsonb_typeof(input)='object' and input->>'model'=model and input->>'currency'=currency),
 result jsonb not null check(jsonb_typeof(result)='object' and result->>'source'='MANUAL' and result->>'draft_only'='true'),
 created_at timestamptz not null default now(),
 unique(user_id,request_id),
 check((model='PERSONAL' and organization_id is null) or (model in('SIMPLE','SAUDI') and organization_id is not null))
);
create index manual_zakat_personal_history on public.manual_zakat_assessments(user_id,created_at desc) where organization_id is null;
create index manual_zakat_company_history on public.manual_zakat_assessments(organization_id,created_at desc) where organization_id is not null;
alter table public.manual_zakat_assessments enable row level security;
revoke all on public.manual_zakat_assessments from public,anon,authenticated;
grant select,insert on public.manual_zakat_assessments to authenticated;
create policy manual_zakat_read on public.manual_zakat_assessments for select to authenticated using(
 (organization_id is null and user_id=(select auth.uid())) or
 (organization_id is not null and public.has_organization_permission(organization_id,'zakat.view'))
);
create policy manual_zakat_create on public.manual_zakat_assessments for insert to authenticated with check(
 user_id=(select auth.uid()) and (
 (organization_id is null and model='PERSONAL') or
 (organization_id is not null and model in('SIMPLE','SAUDI') and public.has_organization_permission(organization_id,'zakat.edit'))
 )
);
comment on table public.manual_zakat_assessments is 'Immutable manual review drafts; separate from asset-lot assessments, payments and financial liabilities.';
