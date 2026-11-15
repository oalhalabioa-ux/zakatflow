-- QA V2 ONLY: ubotbpjngtfvolthpfec. Never apply to Production, main or legacy Financial Core.
-- Supersedes feasibility project invitation, member and snapshot policies to align direct Data API with app-level licences.
-- READ_ONLY/expired/suspended/cancelled grants can read/export after the entitlement start date.
-- Only active TRIAL/ACTIVE grants within their validity window may write.
-- Missing/future grants deny all. Direct EDITOR Data API writes remain disabled until audited collaborator editing ships.
-- One transaction; the migration runner records history only on success.

drop policy if exists feasibility_project_owner_or_member_read on public.feasibility_projects;
drop policy if exists feasibility_owner_insert on public.feasibility_projects;
drop policy if exists feasibility_project_owner_or_editor_update on public.feasibility_projects;
drop policy if exists feasibility_project_owner_write on public.feasibility_projects;
drop policy if exists feasibility_owner_delete on public.feasibility_projects;
drop policy if exists feasibility_reviews_owner_select on public.feasibility_review_snapshots;
drop policy if exists feasibility_reviews_owner_insert on public.feasibility_review_snapshots;
drop policy if exists feasibility_invite_owner_read on public.feasibility_project_invitations;
drop policy if exists feasibility_invite_owner_insert on public.feasibility_project_invitations;
drop policy if exists feasibility_member_owner_or_self_read on public.feasibility_project_members;

create policy feasibility_project_owner_or_member_read on public.feasibility_projects for SELECT to authenticated
 using ((exists(select 1 from public.feasibility_access_grants g
    where g.user_id=(select auth.uid()) and g.starts_at<=now())) and
    (owner_user_id=(select auth.uid()) or private.feasibility_collaborator_role(id) in ('VIEWER','REVIEWER','EDITOR')));

create policy feasibility_owner_insert on public.feasibility_projects for INSERT to authenticated
 with check (owner_user_id=(select auth.uid()) and (exists(select 1 from public.feasibility_access_grants g
    where g.user_id=(select auth.uid()) and g.starts_at<=now()
      and g.status in ('TRIAL','ACTIVE')
      and (g.ends_at is null or g.ends_at>now()))));

create policy feasibility_project_owner_write on public.feasibility_projects for UPDATE to authenticated
 using (owner_user_id=(select auth.uid()) and (exists(select 1 from public.feasibility_access_grants g
    where g.user_id=(select auth.uid()) and g.starts_at<=now()
      and g.status in ('TRIAL','ACTIVE')
      and (g.ends_at is null or g.ends_at>now()))))
  with check (owner_user_id=(select auth.uid()) and (exists(select 1 from public.feasibility_access_grants g
    where g.user_id=(select auth.uid()) and g.starts_at<=now()
      and g.status in ('TRIAL','ACTIVE')
      and (g.ends_at is null or g.ends_at>now()))));

create policy feasibility_owner_delete on public.feasibility_projects for DELETE to authenticated
 using (owner_user_id=(select auth.uid()) and (exists(select 1 from public.feasibility_access_grants g
    where g.user_id=(select auth.uid()) and g.starts_at<=now()
      and g.status in ('TRIAL','ACTIVE')
      and (g.ends_at is null or g.ends_at>now()))));

create policy feasibility_reviews_owner_select on public.feasibility_review_snapshots for SELECT to authenticated
 using (owner_user_id=(select auth.uid()) and (exists(select 1 from public.feasibility_access_grants g
    where g.user_id=(select auth.uid()) and g.starts_at<=now())));

create policy feasibility_reviews_owner_insert on public.feasibility_review_snapshots for INSERT to authenticated
 with check (owner_user_id=(select auth.uid()) and (exists(select 1 from public.feasibility_access_grants g
    where g.user_id=(select auth.uid()) and g.starts_at<=now()
      and g.status in ('TRIAL','ACTIVE')
      and (g.ends_at is null or g.ends_at>now()))));

create policy feasibility_invite_owner_read on public.feasibility_project_invitations for SELECT to authenticated
 using (created_by=(select auth.uid()) and (exists(select 1 from public.feasibility_access_grants g
    where g.user_id=(select auth.uid()) and g.starts_at<=now())) and
  exists(select 1 from public.feasibility_projects p where p.id=project_id and p.owner_user_id=(select auth.uid())));

create policy feasibility_invite_owner_insert on public.feasibility_project_invitations for INSERT to authenticated
 with check (created_by=(select auth.uid()) and (exists(select 1 from public.feasibility_access_grants g
    where g.user_id=(select auth.uid()) and g.starts_at<=now()
      and g.status in ('TRIAL','ACTIVE')
      and (g.ends_at is null or g.ends_at>now()))) and
  exists(select 1 from public.feasibility_projects p where p.id=project_id and p.owner_user_id=(select auth.uid())));

create policy feasibility_member_owner_or_self_read on public.feasibility_project_members for SELECT to authenticated
 using ((exists(select 1 from public.feasibility_access_grants g
    where g.user_id=(select auth.uid()) and g.starts_at<=now())) and (user_id=(select auth.uid()) or
    exists(select 1 from public.feasibility_projects p where p.id=project_id and p.owner_user_id=(select auth.uid()))));

-- Keep RLS enabled and retain existing table privileges; no grants are elevated.
