-- ZakatFlow V8: end-to-end workflow, approvals, consolidated snapshots and report jobs
create table if not exists workflow_cases(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid,
 entity_id uuid,
 owner_id uuid not null references auth.users(id) on delete cascade,
 assessment_id uuid references zakat_assessments(id) on delete set null,
 title text not null,
 status text not null default 'DRAFT' check(status in ('DRAFT','IN_PROGRESS','ACCOUNTANT_REVIEW','SHARIA_REVIEW','APPROVED','REJECTED','PAID','CLOSED')),
 current_step text not null default 'DATA_ENTRY' check(current_step in ('DATA_ENTRY','CALCULATION','ACCOUNTANT_REVIEW','SHARIA_REVIEW','APPROVAL','PAYMENT','REPORTING','CLOSED')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists workflow_events(
 id uuid primary key default gen_random_uuid(), case_id uuid not null references workflow_cases(id) on delete cascade,
 actor_id uuid not null references auth.users(id), from_status text, to_status text not null, comment text, created_at timestamptz not null default now()
);
create table if not exists consolidated_assessments(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 organization_id uuid, assessment_date date not null, valuation_date date not null, base_currency text not null references currencies(code),
 total_zakatable_value numeric(24,8) not null default 0, total_zakat_due numeric(24,8) not null default 0,
 line_count integer not null default 0, snapshot jsonb not null default '{}', status text not null default 'DRAFT', created_at timestamptz not null default now()
);
create table if not exists consolidated_assessment_lines(
 id uuid primary key default gen_random_uuid(), consolidated_id uuid not null references consolidated_assessments(id) on delete cascade,
 entity_id uuid, assessment_id uuid references zakat_assessments(id) on delete set null, entity_name text not null,
 source_currency text not null, fx_rate numeric(24,12), zakatable_value numeric(24,8) not null, zakat_due numeric(24,8) not null
);
create table if not exists report_jobs(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 report_type text not null, format text not null check(format in ('CSV','XLSX','PDF')),
 reference_id uuid, status text not null default 'QUEUED' check(status in ('QUEUED','PROCESSING','READY','FAILED')),
 file_path text, error_message text, created_at timestamptz not null default now(), completed_at timestamptz
);
create index if not exists idx_workflow_owner on workflow_cases(owner_id,status);
create index if not exists idx_consolidated_owner on consolidated_assessments(owner_id,assessment_date);
create index if not exists idx_report_jobs_owner on report_jobs(owner_id,created_at desc);

alter table workflow_cases enable row level security;
alter table workflow_events enable row level security;
alter table consolidated_assessments enable row level security;
alter table consolidated_assessment_lines enable row level security;
alter table report_jobs enable row level security;
create policy workflow_cases_owner on workflow_cases for all using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy workflow_events_owner on workflow_events for all using(exists(select 1 from workflow_cases c where c.id=case_id and c.owner_id=auth.uid())) with check(exists(select 1 from workflow_cases c where c.id=case_id and c.owner_id=auth.uid()));
create policy consolidated_owner on consolidated_assessments for all using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy consolidated_lines_owner on consolidated_assessment_lines for all using(exists(select 1 from consolidated_assessments c where c.id=consolidated_id and c.owner_id=auth.uid())) with check(exists(select 1 from consolidated_assessments c where c.id=consolidated_id and c.owner_id=auth.uid()));
create policy report_jobs_owner on report_jobs for all using(owner_id=auth.uid()) with check(owner_id=auth.uid());
