-- Applied ONLY to Yaqeen Financial Core QA V2 (ubotbpjngtfvolthpfec).
-- Recorded as Supabase migration 20261109095653; never apply to legacy Core QA.
create table public.feasibility_projects (
 id uuid primary key,
 owner_user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (length(btrim(title)) between 1 and 300),
 revision integer not null default 1 check (revision > 0),
 study jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint feasibility_study_document_check check (
  jsonb_typeof(study) = 'object'
  and study->>'id' = id::text
  and study->>'title' = title
  and octet_length(study::text) <= 1000000
 )
);
comment on table public.feasibility_projects is 'QA V2 owner-scoped feasibility drafts only; no accounting entries, legal approvals, or organization grants.';
create index feasibility_projects_owner_updated_idx on public.feasibility_projects(owner_user_id, updated_at desc);
alter table public.feasibility_projects enable row level security;
create policy feasibility_owner_read on public.feasibility_projects for select to authenticated
 using (owner_user_id = (select auth.uid()));
create policy feasibility_owner_insert on public.feasibility_projects for insert to authenticated
 with check (owner_user_id = (select auth.uid()));
create policy feasibility_owner_update on public.feasibility_projects for update to authenticated
 using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
create policy feasibility_owner_delete on public.feasibility_projects for delete to authenticated
 using (owner_user_id = (select auth.uid()));
revoke all on table public.feasibility_projects from public, anon;
grant select, insert, delete on table public.feasibility_projects to authenticated;
grant update (title, revision, study, updated_at) on table public.feasibility_projects to authenticated;
