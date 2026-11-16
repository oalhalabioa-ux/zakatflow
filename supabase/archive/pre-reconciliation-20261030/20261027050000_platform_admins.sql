-- Platform owner role membership. Never infer admin access from email or user metadata.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('platform_owner')),
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;
drop policy if exists "platform admins read own membership" on public.platform_admins;
create policy "platform admins read own membership" on public.platform_admins
for select to authenticated using (user_id = (select auth.uid()));
-- Provision owner memberships only from a privileged SQL administration session.
-- Do not insert owner accounts from public endpoints or user-controlled signup metadata.
