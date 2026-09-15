-- ZakatFlow V4: governance, roles, rule versioning, notification scheduling and provider metadata.

alter table profiles add column if not exists is_active boolean not null default true;
alter table profiles add column if not exists organization_id uuid;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_currency text not null default 'SAR' references currencies(code),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('OWNER','ADMIN','ACCOUNTANT','ADVISOR','VIEWER','SHARIA_REVIEWER')),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

alter table profiles drop constraint if exists profiles_organization_id_fkey;
alter table profiles add constraint profiles_organization_id_fkey foreign key (organization_id) references organizations(id) on delete set null;

create table if not exists sharia_rule_reviews (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references zakat_rules(id) on delete cascade,
  reviewer_id uuid references profiles(id),
  decision text not null check (decision in ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED')) default 'PENDING',
  notes text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists rule_sources (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references zakat_rules(id) on delete cascade,
  source_title text not null,
  source_reference text,
  source_url text,
  scholar_name text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists notification_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  notification_type text not null,
  scheduled_for timestamptz not null,
  status text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED','CANCELLED')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  unique(user_id,notification_type,scheduled_for)
);

create table if not exists price_provider_configs (
  id uuid primary key default gen_random_uuid(),
  provider_name text not null,
  asset_class text not null,
  is_active boolean not null default true,
  configuration jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_rules_review_status on zakat_rules(review_status);
create index if not exists idx_rule_reviews_rule on sharia_rule_reviews(rule_id,created_at desc);
create index if not exists idx_notifications_pending on notification_jobs(status,scheduled_for);

-- Helper for server-side admin checks. Role values are intentionally explicit.
create or replace function public.has_role(p_user uuid, p_roles text[])
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where id=p_user and is_active=true and role = any(p_roles));
$$;

-- Default notification schedule: 30/15/7 days before each open Hawl due date.
create or replace function public.schedule_hawl_notifications(p_user uuid)
returns integer language plpgsql security invoker as $$
declare r record; n integer := 0; d int; v_ts timestamptz;
begin
  for r in select id,hawl_due_date from lots where user_id=p_user and remaining_quantity>0 and hawl_due_date is not null loop
    foreach d in array[30,15,7] loop
      v_ts := (r.hawl_due_date - make_interval(days=>d))::timestamptz;
      insert into notification_jobs(user_id,notification_type,scheduled_for)
      values(p_user,'HAWL_DUE_'||d,v_ts) on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;
  return n;
end; $$;
