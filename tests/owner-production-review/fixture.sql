-- Synthetic compatibility fixture: schema metadata only, never Production rows.
create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
create schema auth;grant usage on schema auth,public to anon,authenticated,service_role;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
create table auth.users(
"id" uuid primary key not null,
"email" character varying,
"email_confirmed_at" timestamp with time zone,
"last_sign_in_at" timestamp with time zone,
"created_at" timestamp with time zone,
"banned_until" timestamp with time zone,
"deleted_at" timestamp with time zone);
create table auth.sessions(
"id" uuid primary key not null,
"user_id" uuid not null,
"created_at" timestamp with time zone,
"not_after" timestamp with time zone);
create table public.organizations(
"id" uuid primary key default gen_random_uuid() not null,
"owner_user_id" uuid,
"name" text not null,
"legal_name" text,
"base_currency" text default 'SAR'::text not null,
"entity_type" text default 'FAMILY'::text not null,
"status" text default 'ACTIVE'::text not null,
"created_at" timestamp with time zone default now() not null,
"updated_at" timestamp with time zone default now() not null,
"parent_organization_id" uuid,
"organization_kind" text default 'SUBSIDIARY'::text not null,
"sort_order" integer default 100 not null,
"approval_policy" text default 'OWNER_CONTROLLED'::text not null);
create table public.organization_members(
"organization_id" uuid not null,
"user_id" uuid not null,
"role" text not null,
"status" text default 'ACTIVE'::text not null,
"created_at" timestamp with time zone default now() not null,
"custom_role_id" uuid);
create table public.subscriptions(
"id" uuid primary key default gen_random_uuid() not null,
"user_id" uuid not null,
"plan_code" text default 'FREE'::text not null,
"status" text default 'ACTIVE'::text not null,
"provider" text,
"provider_customer_id" text,
"provider_subscription_id" text,
"current_period_start" timestamp with time zone,
"current_period_end" timestamp with time zone,
"created_at" timestamp with time zone default now(),
"updated_at" timestamp with time zone default now());

-- Dependency stubs reproduce referenced keys, not complete unrelated modules.
create table public.profiles(id uuid primary key references auth.users(id));
create table public.currencies(code text primary key);
create table public.organization_roles(organization_id uuid not null,id uuid not null,primary key(organization_id,id));
alter table public.organization_members add constraint organization_members_custom_role_check CHECK (((role = 'CUSTOM'::text) = (custom_role_id IS NOT NULL)));
alter table public.organization_members add constraint organization_members_custom_role_fkey FOREIGN KEY (organization_id, custom_role_id) REFERENCES organization_roles(organization_id, id) ON DELETE RESTRICT;
alter table public.organization_members add constraint organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table public.organization_members add constraint organization_members_pkey PRIMARY KEY (organization_id, user_id);
alter table public.organization_members add constraint organization_members_role_check CHECK ((role = ANY (ARRAY['OWNER'::text, 'ADMIN'::text, 'ACCOUNTANT'::text, 'ADVISOR'::text, 'VIEWER'::text, 'SHARIA_REVIEWER'::text, 'CUSTOM'::text])));
alter table public.organization_members add constraint organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.organizations add constraint organizations_approval_policy_check CHECK ((approval_policy = ANY (ARRAY['OWNER_CONTROLLED'::text, 'ROLE_BASED'::text, 'STRICT_SEGREGATION'::text])));
alter table public.organizations add constraint organizations_base_currency_fkey FOREIGN KEY (base_currency) REFERENCES currencies(code);
alter table public.organizations add constraint organizations_organization_kind_check CHECK ((organization_kind = ANY (ARRAY['HOLDING'::text, 'SUBSIDIARY'::text])));
alter table public.organizations add constraint organizations_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;
alter table public.organizations add constraint organizations_parent_organization_id_fkey FOREIGN KEY (parent_organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
alter table public.subscriptions add constraint subscriptions_plan_code_check CHECK ((plan_code = ANY (ARRAY['FREE'::text, 'FAMILY'::text, 'PROFESSIONAL'::text, 'BUSINESS'::text, 'ENTERPRISE'::text])));
alter table public.subscriptions add constraint subscriptions_status_check CHECK ((status = ANY (ARRAY['TRIALING'::text, 'ACTIVE'::text, 'PAST_DUE'::text, 'CANCELLED'::text])));
alter table public.subscriptions add constraint subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.subscriptions add constraint subscriptions_user_id_key UNIQUE (user_id);


