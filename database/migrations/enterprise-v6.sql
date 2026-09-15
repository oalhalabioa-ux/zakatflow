-- ZakatFlow V6: enterprise, approvals, billing, report jobs
do $$ begin create type org_plan as enum ('FREE','FAMILY','PROFESSIONAL','BUSINESS','ENTERPRISE'); exception when duplicate_object then null; end $$;
do $$ begin create type member_role as enum ('OWNER','ADMIN','ACCOUNTANT','ADVISOR','VIEWER','SHARIA_REVIEWER'); exception when duplicate_object then null; end $$;
do $$ begin create type entity_type as enum ('PERSON','FAMILY','COMPANY','TRUST','OTHER'); exception when duplicate_object then null; end $$;
do $$ begin create type approval_status as enum ('PENDING','APPROVED','REJECTED','CANCELLED'); exception when duplicate_object then null; end $$;
do $$ begin create type report_format as enum ('CSV','XLSX','PDF'); exception when duplicate_object then null; end $$;
do $$ begin create type job_status as enum ('QUEUED','PROCESSING','COMPLETED','FAILED'); exception when duplicate_object then null; end $$;

create table if not exists organizations(
 id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null,
 plan org_plan not null default 'FREE', base_currency text not null references currencies(code),
 owner_id uuid not null references profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists organization_members(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 user_id uuid not null references profiles(id) on delete cascade, role member_role not null default 'VIEWER',
 active boolean not null default true, created_at timestamptz not null default now(), unique(organization_id,user_id)
);
create table if not exists organization_entities(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 name text not null, type entity_type not null, registration_no text, base_currency text not null references currencies(code),
 active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists entity_members(
 entity_id uuid not null references organization_entities(id) on delete cascade,
 user_id uuid not null references profiles(id) on delete cascade,
 role member_role not null default 'VIEWER', primary key(entity_id,user_id)
);
create table if not exists assessment_approvals(
 id uuid primary key default gen_random_uuid(), assessment_id uuid not null references zakat_assessments(id) on delete cascade,
 requested_by uuid not null references profiles(id), reviewer_id uuid references profiles(id),
 status approval_status not null default 'PENDING', comments text, requested_at timestamptz not null default now(), reviewed_at timestamptz
);
create table if not exists report_jobs(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
 assessment_id uuid references zakat_assessments(id), format report_format not null, status job_status not null default 'QUEUED',
 storage_path text, error_message text, created_at timestamptz not null default now(), completed_at timestamptz
);
create table if not exists subscriptions(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
 plan org_plan not null, provider text, external_customer_id text, external_subscription_id text,
 status text not null default 'ACTIVE', current_period_end timestamptz, created_at timestamptz not null default now()
);

alter table organizations enable row level security; alter table organization_members enable row level security;
alter table organization_entities enable row level security; alter table entity_members enable row level security;
alter table assessment_approvals enable row level security; alter table report_jobs enable row level security; alter table subscriptions enable row level security;

create or replace function is_org_member(p_org uuid) returns boolean language sql security definer stable as $$ select exists(select 1 from organization_members where organization_id=p_org and user_id=auth.uid() and active); $$;
create or replace function has_org_role(p_org uuid,p_role member_role) returns boolean language sql security definer stable as $$ select exists(select 1 from organization_members where organization_id=p_org and user_id=auth.uid() and active and (role=p_role or role='OWNER' or role='ADMIN')); $$;
create policy org_read on organizations for select using (is_org_member(id));
create policy org_update on organizations for update using (has_org_role(id,'ADMIN')) with check (has_org_role(id,'ADMIN'));
create policy org_member_read on organization_members for select using (user_id=auth.uid() or is_org_member(organization_id));
create policy org_member_admin on organization_members for all using (has_org_role(organization_id,'ADMIN')) with check (has_org_role(organization_id,'ADMIN'));
create policy entity_access on organization_entities for all using (is_org_member(organization_id)) with check (is_org_member(organization_id));
create policy entity_member_access on entity_members for all using (exists(select 1 from organization_entities e where e.id=entity_id and is_org_member(e.organization_id))) with check (exists(select 1 from organization_entities e where e.id=entity_id and is_org_member(e.organization_id)));
create policy approval_access on assessment_approvals for all using (requested_by=auth.uid() or reviewer_id=auth.uid());
create policy report_access on report_jobs for all using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy subscription_access on subscriptions for select using (exists(select 1 from organizations o where o.id=organization_id and is_org_member(o.id)));

create or replace function request_assessment_approval(p_assessment uuid,p_reviewer uuid default null) returns uuid language plpgsql security invoker as $$
declare v_id uuid; v_user uuid:=auth.uid(); begin
 if not exists(select 1 from zakat_assessments where id=p_assessment and user_id=v_user) then raise exception 'ASSESSMENT_NOT_ACCESSIBLE'; end if;
 insert into assessment_approvals(assessment_id,requested_by,reviewer_id) values(p_assessment,v_user,p_reviewer) returning id into v_id;
 return v_id; end; $$;

create or replace function review_assessment_approval(p_approval uuid,p_status approval_status,p_comments text default null) returns uuid language plpgsql security invoker as $$
declare v_user uuid:=auth.uid(); v_assessment uuid; begin
 select assessment_id into v_assessment from assessment_approvals where id=p_approval and (reviewer_id=v_user or reviewer_id is null);
 if v_assessment is null then raise exception 'APPROVAL_NOT_ACCESSIBLE'; end if;
 update assessment_approvals set status=p_status,comments=p_comments,reviewed_at=now(),reviewer_id=coalesce(reviewer_id,v_user) where id=p_approval;
 if p_status='APPROVED' then update zakat_assessments set status='CONFIRMED' where id=v_assessment; end if;
 return p_approval; end; $$;
