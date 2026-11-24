begin;

create table private.feasibility_invitation_reception (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null
);
alter table private.feasibility_invitation_reception enable row level security;
revoke all on private.feasibility_invitation_reception from public, anon, authenticated, service_role;

alter table private.feasibility_sharing_policy
  add column company_invitation_pilot_only boolean not null default true,
  add column company_invitation_pilot_source uuid references public.organizations(id),
  add column company_invitation_pilot_recipient uuid references public.organizations(id),
  add constraint feasibility_invitation_pilot_pair check (
    (company_invitation_pilot_source is null and company_invitation_pilot_recipient is null)
    or (company_invitation_pilot_source is not null and company_invitation_pilot_recipient is not null
        and company_invitation_pilot_source <> company_invitation_pilot_recipient)
  );

create function public.feasibility_invitation_reception(p_organization uuid, p_enabled boolean default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  receiving boolean;
begin
  if not exists (
    select from private.feasibility_sharing_policy where singleton and company_invitations_enabled
  ) or not private.feasibility_phase1_org_enabled()
     or not private.feasibility_member_permission(p_organization, auth.uid(), 'feasibility.directory_manage') then
    raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode = '42501';
  end if;

  if p_enabled is null then
    select enabled into receiving from private.feasibility_invitation_reception
      where organization_id = p_organization;
    return coalesce(receiving, false);
  end if;

  insert into private.feasibility_invitation_reception(organization_id, enabled)
    values (p_organization, p_enabled)
    on conflict (organization_id) do update set enabled = excluded.enabled;
  return p_enabled;
end $$;
revoke all on function public.feasibility_invitation_reception(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.feasibility_invitation_reception(uuid, boolean) to authenticated;

create function private.feasibility_check_invitation_reception(
  p_source uuid, p_recipient uuid, p_access text, p_documents text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  policy private.feasibility_sharing_policy%rowtype;
  receiving boolean;
begin
  select * into strict policy from private.feasibility_sharing_policy where singleton for share;
  if policy.company_invitation_pilot_only and (
    p_source is distinct from policy.company_invitation_pilot_source
    or p_recipient is distinct from policy.company_invitation_pilot_recipient
    or p_access is distinct from 'read' or p_documents is distinct from 'none'
  ) then
    raise exception 'FEASIBILITY_INVITATION_PILOT_RESTRICTED' using errcode = '42501';
  end if;

  select enabled into receiving from private.feasibility_invitation_reception
    where organization_id = p_recipient for share;
  if receiving is distinct from true then
    raise exception 'FEASIBILITY_INVITATION_RECEPTION_DISABLED' using errcode = '42501';
  end if;
end $$;
revoke all on function private.feasibility_check_invitation_reception(uuid, uuid, text, text) from public, anon, authenticated, service_role;

create function private.feasibility_guard_company_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.feasibility_check_invitation_reception(new.source_id, new.recipient_id, new.access_mode,
    case when cardinality(new.document_ids) > 0 or new.document_versions <> '{}'::jsonb then 'selected'
      else new.document_mode end);
  return new;
end $$;
revoke all on function private.feasibility_guard_company_invitation() from public, anon, authenticated, service_role;

create trigger feasibility_guard_company_invitation_issue
  before insert on private.feasibility_company_invitations
  for each row execute function private.feasibility_guard_company_invitation();

-- The existing issuance RPC writes the attachment manifest after creating the invitation.
-- Acceptance and attachment capture are in the same transaction as the guarded write.
create trigger feasibility_guard_company_invitation_update
  before update of state, document_mode, document_ids, document_versions on private.feasibility_company_invitations
  for each row when ((old.state = 'pending' and new.state = 'accepted')
    or (new.state = 'pending' and (old.document_mode, old.document_ids, old.document_versions)
      is distinct from (new.document_mode, new.document_ids, new.document_versions)))
  execute function private.feasibility_guard_company_invitation();

create or replace function public.feasibility_issue_with_documents(p_organization uuid,p_project uuid,p_recipient uuid,
 p_revision integer,p_days integer,p_access text,p_document_mode text,p_documents uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare captured uuid[]; versions jsonb; prior uuid; result jsonb; issued uuid;
begin
 if not private.feasibility_member_permission(p_organization,auth.uid(),'feasibility.invite') then
  raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
 end if;
 perform 1 from public.feasibility_projects where id=p_project and organization_id=p_organization for update;
 if not found then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;
 if p_document_mode is null or p_document_mode not in ('none','all','selected') or p_documents is null
  or (p_document_mode='selected') is distinct from (cardinality(p_documents)>0) then
  raise exception 'FEASIBILITY_INVALID_SHARE' using errcode='22023';
 end if;
 if p_document_mode<>'none' and not exists(select from private.feasibility_evidence_feature_switch where singleton and enabled) then
  raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
 end if;
 perform private.feasibility_check_invitation_reception(p_organization,p_recipient,p_access,p_document_mode);
 select id into prior from private.feasibility_company_invitations where project_id=p_project and recipient_id=p_recipient and state='pending';
 result:=private.feasibility_company_invitations('issue',p_organization,null,p_project,p_recipient,p_revision,p_days,p_access);
 issued:=(result->>'id')::uuid;
 if issued=prior then
  if exists(select from private.feasibility_company_invitations where id=issued and document_mode=p_document_mode
    and (p_document_mode<>'selected' or (document_ids @> p_documents and document_ids <@ p_documents))) then return result; end if;
  raise exception 'FEASIBILITY_COMPANY_INVITATION_PENDING' using errcode='40001';
 end if;
 select coalesce(array_agg(d.id order by d.id),'{}'::uuid[]),
  coalesce(jsonb_object_agg(d.id,private.feasibility_evidence_version(d)),'{}') into captured,versions
 from private.feasibility_evidence_documents d where project_id=p_project
  and (p_document_mode='all' or (p_document_mode='selected' and id=any(p_documents)));
 if p_document_mode='selected' and cardinality(captured)<>cardinality(p_documents) then
  raise exception 'FEASIBILITY_INVALID_SHARE' using errcode='22023';
 end if;
 update private.feasibility_company_invitations set document_mode=p_document_mode,document_ids=captured,document_versions=versions where id=issued;
 return result;
end $$;

create or replace function public.feasibility_company_invitations(
  p_action text, p_organization uuid, p_invitation uuid default null, p_project uuid default null,
  p_recipient uuid default null, p_revision integer default null, p_days integer default null, p_access text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_action = 'issue' then
    if not private.feasibility_member_permission(p_organization, auth.uid(), 'feasibility.invite') then
      raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode = '42501';
    end if;
    perform private.feasibility_check_invitation_reception(p_organization,p_recipient,p_access,'none');
  end if;
  return private.feasibility_company_invitations(p_action,p_organization,p_invitation,p_project,p_recipient,
    p_revision,p_days,p_access);
end $$;

commit;
