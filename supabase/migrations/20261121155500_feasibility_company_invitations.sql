-- Install the invitation schema with the sharing policy switch disabled by default.
begin;
set local lock_timeout='3s';

alter table private.feasibility_sharing_policy
 add column company_invitations_enabled boolean not null default false;

create table private.feasibility_company_invitations (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.feasibility_projects(id) on delete cascade,
 source_id uuid not null references public.organizations(id),
 recipient_id uuid not null references public.organizations(id),
 source_revision integer not null check (source_revision > 0),
 access_mode text not null check (access_mode in ('read','edit')),
 days integer not null check (days > 0),
 issued_by uuid references auth.users(id) on delete set null,
 issued_at timestamptz not null,
 expires_at timestamptz not null,
 state text not null default 'pending'
  check (state in ('pending','accepted','declined','withdrawn','expired','revoked')),
 check (source_id <> recipient_id and expires_at > issued_at)
);
alter table private.feasibility_company_invitations enable row level security;
revoke all on private.feasibility_company_invitations from public,anon,authenticated,service_role;
create unique index feasibility_pending_company_invite
 on private.feasibility_company_invitations(project_id,recipient_id) where state='pending';
create index feasibility_company_invite_recipient
 on private.feasibility_company_invitations(recipient_id,issued_at desc);

create table private.feasibility_company_directory (
 organization_id uuid primary key references public.organizations(id) on delete cascade
);
alter table private.feasibility_company_directory enable row level security;
revoke all on private.feasibility_company_directory from public,anon,authenticated,service_role;

alter table private.feasibility_organization_shares
 add column company_invitation_id uuid references private.feasibility_company_invitations(id) on delete set null;

-- Keep legacy reads and existing grants intact. The public share RPCs both reach this guard.
alter function private.feasibility_company_shares(text,uuid,uuid,uuid,integer,integer)
 rename to feasibility_company_shares_legacy;
revoke all on function private.feasibility_company_shares_legacy(text,uuid,uuid,uuid,integer,integer)
 from public,anon,authenticated,service_role;

create function private.feasibility_company_shares(
 p_action text,p_organization uuid,p_project uuid,p_recipient uuid,p_revision integer,p_days integer
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_action='share' and (select company_invitations_enabled
   from private.feasibility_sharing_policy where singleton for share) then
  raise exception 'FEASIBILITY_COMPANY_INVITATION_REQUIRED' using errcode='42501';
 end if;
 return private.feasibility_company_shares_legacy(p_action,p_organization,p_project,p_recipient,p_revision,p_days);
end
$$;
revoke all on function private.feasibility_company_shares(text,uuid,uuid,uuid,integer,integer)
 from public,anon,authenticated,service_role;

create function private.feasibility_company_invitation_audit(
 invitation private.feasibility_company_invitations,p_state text,p_actor uuid
) returns void language sql set search_path='' as $$
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details)
 values(p_actor,'feasibility.company_invitation_'||p_state,'feasibility_company_invitation',invitation.id,
  jsonb_build_object('project_id',invitation.project_id,'source_organization_id',invitation.source_id,
    'recipient_organization_id',invitation.recipient_id,'source_revision',invitation.source_revision,
    'access_mode',invitation.access_mode,'days',invitation.days))
$$;
revoke all on function private.feasibility_company_invitation_audit(private.feasibility_company_invitations,text,uuid)
 from public,anon,authenticated,service_role;

create function private.feasibility_company_invitations(
 p_action text,p_organization uuid,p_invitation uuid,p_project uuid,p_recipient uuid,
 p_revision integer,p_days integer,p_access text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();
 policy private.feasibility_sharing_policy%rowtype;
 member_role text;
 project public.feasibility_projects%rowtype;
 invitation private.feasibility_company_invitations%rowtype;
 share private.feasibility_organization_shares%rowtype;
 now_at timestamptz;
 cutoff timestamptz;
 paid boolean;
 sender_name text;
 next_state text;
begin
 select * into strict policy from private.feasibility_sharing_policy where singleton for share;
 if actor is null or not policy.company_invitations_enabled or not private.feasibility_phase1_org_enabled() then
  raise exception 'FEASIBILITY_COMPANY_INVITATION_DISABLED' using errcode='42501';
 end if;
 select m.role into member_role from public.organization_members m
 join public.organizations o on o.id=m.organization_id and o.status='ACTIVE'
 where m.organization_id=p_organization and m.user_id=actor and m.status='ACTIVE';
 if member_role is null or member_role not in ('OWNER','ADMIN') then
  raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
 end if;

 if p_action='directory_status' then
  if member_role<>'OWNER' then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;
  return to_jsonb(exists(select 1 from private.feasibility_company_directory where organization_id=p_organization));
 end if;
 if p_action in ('directory_enable','directory_disable') then
  if member_role<>'OWNER' then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;
  if p_action='directory_enable' then
   insert into private.feasibility_company_directory(organization_id) values(p_organization) on conflict do nothing;
  else
   delete from private.feasibility_company_directory where organization_id=p_organization;
  end if;
  return to_jsonb(p_action='directory_enable');
 end if;
 if p_action='directory_search' then
  if member_role<>'OWNER' or not private.feasibility_has_company_plan(p_organization,true) then
   raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_access,''))) not between 2 and 100 then
   raise exception 'FEASIBILITY_INVALID_SHARE' using errcode='22023';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(entry) order by entry.name,entry.id),'[]'::jsonb)
   from (select o.id,o.name from private.feasibility_company_directory d
    join public.organizations o on o.id=d.organization_id and o.status='ACTIVE'
    where d.organization_id<>p_organization
     and starts_with(lower(o.name),lower(btrim(p_access)))
    order by o.name,o.id limit 20) entry);
 end if;

 if p_action='inbox' then
  return (select coalesce(jsonb_agg(to_jsonb(i) order by i.issued_at desc,i.id),'[]'::jsonb)
   from (select x.id,o.name as source_name,x.access_mode,x.days,x.issued_at,x.expires_at,x.state
    from private.feasibility_company_invitations x join public.organizations o on o.id=x.source_id
    left join private.feasibility_organization_shares s on s.company_invitation_id=x.id
    where x.recipient_id=p_organization and (
     (x.state='pending' and x.expires_at>statement_timestamp())
     or (x.state='accepted' and s.revoked_at is null and s.expires_at>statement_timestamp()
      and (private.feasibility_has_company_plan(p_organization,true)
       or s.first_shared_at+interval '720 hours'>statement_timestamp())))
    order by x.issued_at desc,x.id limit 300) i);
 end if;
 if p_action='outbox' then
  if member_role<>'OWNER' or not exists(select 1 from public.feasibility_projects
    where id=p_project and organization_id=p_organization) then
   raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(i) order by i.issued_at desc,i.id),'[]'::jsonb)
   from (select x.id,o.name as recipient_name,x.access_mode,x.days,x.issued_at,x.expires_at,
    case when x.state='pending' and x.expires_at<=statement_timestamp() then 'expired'
     when x.state='accepted' and s.revoked_at is not null then 'revoked' else x.state end as state
    from private.feasibility_company_invitations x join public.organizations o on o.id=x.recipient_id
    left join private.feasibility_organization_shares s on s.company_invitation_id=x.id
    where x.project_id=p_project and x.source_id=p_organization order by x.issued_at desc,x.id limit 300) i);
 end if;

 if p_action='issue' then
  if member_role<>'OWNER' or policy.mode='disabled' or not private.feasibility_has_company_plan(p_organization,true) then
   raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
  end if;
  select * into project from public.feasibility_projects
   where id=p_project and organization_id=p_organization and owner_user_id is null for update;
  if not found then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;
  if p_revision is distinct from project.revision then
   raise exception 'FEASIBILITY_STALE_SHARE_REVISION' using errcode='40001';
  end if;
  if p_days is null or p_days<1 or p_access is null or p_access not in ('read','edit')
    or p_recipient=p_organization or not exists(select 1 from public.organizations
     where id=p_recipient and status='ACTIVE') then
   raise exception 'FEASIBILITY_INVALID_SHARE' using errcode='22023';
  end if;
  paid:=private.feasibility_has_company_plan(p_recipient,true);
  if p_access='edit' and (policy.mode<>'edit' or not paid) then
   raise exception 'FEASIBILITY_SHARE_EDIT_FORBIDDEN' using errcode='42501';
  end if;
  if not paid and p_days>30 then
   raise exception 'FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS' using errcode='22023';
  end if;
  now_at:=clock_timestamp();
  select * into invitation from private.feasibility_company_invitations
   where project_id=p_project and recipient_id=p_recipient and state='pending' for update;
  if found then
   if invitation.expires_at<=now_at then
    update private.feasibility_company_invitations set state='expired' where id=invitation.id;
    perform private.feasibility_company_invitation_audit(invitation,'expired',actor);
   elsif invitation.source_revision=p_revision and invitation.days=p_days and invitation.access_mode=p_access then
    return jsonb_build_object('id',invitation.id,'state','pending');
   else
    raise exception 'FEASIBILITY_COMPANY_INVITATION_PENDING' using errcode='40001';
   end if;
  end if;
  insert into private.feasibility_company_invitations
   (project_id,source_id,recipient_id,source_revision,access_mode,days,issued_by,issued_at,expires_at)
   values(p_project,p_organization,p_recipient,p_revision,p_access,p_days,actor,now_at,now_at+interval '168 hours')
   returning * into invitation;
  perform private.feasibility_company_invitation_audit(invitation,'issued',actor);
  select name into sender_name from public.organizations where id=p_organization;
  insert into public.notifications(user_id,type,title,body,scheduled_for,metadata)
   select distinct p.id,'feasibility_company_invitation',
    case when p.locale='ar' then 'دعوة مشاركة دراسة جدوى' else 'Feasibility study invitation' end,
    sender_name,now_at,jsonb_build_object('organization',p_recipient,'invitation',invitation.id)
   from public.organization_members m join public.profiles p on p.id=m.user_id
   where m.organization_id=p_recipient and m.status='ACTIVE' and m.role in ('OWNER','ADMIN');
  return jsonb_build_object('id',invitation.id,'state',invitation.state);
 end if;

 if p_action is null or p_action not in ('accept','decline','withdraw','revoke') then
  raise exception 'FEASIBILITY_INVALID_SHARE_ACTION' using errcode='22023';
 end if;
 select * into invitation from private.feasibility_company_invitations x where x.id=p_invitation and (
  (p_action in ('accept','decline','revoke') and x.recipient_id=p_organization)
  or (p_action in ('withdraw','revoke') and x.source_id=p_organization and member_role='OWNER'));
 if not found then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;

 -- Use the same project-first lock order as sharing and proposal review.
 select * into project from public.feasibility_projects where id=invitation.project_id for update;
 if not found then raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501'; end if;
 select * into strict invitation from private.feasibility_company_invitations where id=p_invitation for update;
 now_at:=clock_timestamp();
 next_state:=case p_action when 'accept' then 'accepted' when 'decline' then 'declined'
  when 'withdraw' then 'withdrawn' when 'revoke' then 'revoked' end;
 if invitation.state=next_state then
  if p_action='accept' and not exists(select 1 from private.feasibility_organization_shares s
    where s.project_id=invitation.project_id and s.recipient_organization_id=invitation.recipient_id
     and s.company_invitation_id=invitation.id and s.revoked_at is null and s.expires_at>now_at
     and (private.feasibility_has_company_plan(invitation.recipient_id,true)
      or s.first_shared_at+interval '720 hours'>now_at)) then
   raise exception 'FEASIBILITY_COMPANY_INVITATION_RESOLVED' using errcode='40001';
  end if;
  return jsonb_build_object('id',invitation.id,'state',invitation.state);
 end if;
 if invitation.state='pending' and invitation.expires_at<=now_at then
  update private.feasibility_company_invitations set state='expired' where id=invitation.id;
  perform private.feasibility_company_invitation_audit(invitation,'expired',actor);
  return jsonb_build_object('id',invitation.id,'state','expired');
 end if;
 if p_action='revoke' and invitation.state='accepted' then
  update private.feasibility_organization_shares set revoked_at=coalesce(revoked_at,now_at)
   where project_id=invitation.project_id and recipient_organization_id=invitation.recipient_id
    and company_invitation_id=invitation.id;
 elsif p_action='revoke' or invitation.state<>'pending' then
  raise exception 'FEASIBILITY_COMPANY_INVITATION_RESOLVED' using errcode='40001';
 elsif p_action='accept' then
  if policy.mode='disabled' or project.organization_id is distinct from invitation.source_id
   or project.owner_user_id is not null or not private.feasibility_has_company_plan(invitation.source_id,true)
   or not exists(select 1 from public.organization_members m
    where m.organization_id=invitation.source_id and m.user_id=invitation.issued_by
     and m.status='ACTIVE' and m.role='OWNER') then
   raise exception 'FEASIBILITY_SHARE_FORBIDDEN' using errcode='42501';
  end if;
  if invitation.source_revision is distinct from project.revision then
   raise exception 'FEASIBILITY_STALE_SHARE_REVISION' using errcode='40001';
  end if;
  paid:=private.feasibility_has_company_plan(invitation.recipient_id,true);
  if invitation.access_mode='edit' and (policy.mode<>'edit' or not paid) then
   raise exception 'FEASIBILITY_SHARE_EDIT_FORBIDDEN' using errcode='42501';
  end if;
  select * into share from private.feasibility_organization_shares
   where project_id=project.id and recipient_organization_id=invitation.recipient_id for update;
  cutoff:=now_at+invitation.days*interval '24 hours';
  if not paid and cutoff>coalesce(share.first_shared_at,now_at)+interval '720 hours' then
   raise exception 'FEASIBILITY_NON_SUBSCRIBER_MAX_30_DAYS' using errcode='22023';
  end if;

  insert into private.feasibility_organization_shares as existing
   (project_id,recipient_organization_id,source_revision,title,study_snapshot,first_shared_at,expires_at,
    shared_by,access_mode,company_invitation_id)
   values(project.id,invitation.recipient_id,project.revision,project.title,project.study,now_at,cutoff,
    invitation.issued_by,invitation.access_mode,invitation.id)
   on conflict (project_id,recipient_organization_id) do update set
    source_revision=excluded.source_revision,expires_at=excluded.expires_at,shared_by=excluded.shared_by,
    revoked_at=null,access_mode=excluded.access_mode,company_invitation_id=excluded.company_invitation_id,
    title=case when existing.source_revision=excluded.source_revision then existing.title else excluded.title end,
    study_snapshot=case when existing.source_revision=excluded.source_revision then existing.study_snapshot else excluded.study_snapshot end,
    shared_revision=existing.shared_revision+1;
 end if;
 update private.feasibility_company_invitations set state=next_state where id=invitation.id;
 perform private.feasibility_company_invitation_audit(invitation,next_state,actor);
 return jsonb_build_object('id',invitation.id,'state',next_state);
end
$$;
revoke all on function private.feasibility_company_invitations(text,uuid,uuid,uuid,uuid,integer,integer,text)
 from public,anon,authenticated,service_role;
grant execute on function private.feasibility_company_invitations(text,uuid,uuid,uuid,uuid,integer,integer,text)
 to authenticated;

create function public.feasibility_company_invitations(
 p_action text,p_organization uuid,p_invitation uuid default null,p_project uuid default null,
 p_recipient uuid default null,p_revision integer default null,p_days integer default null,p_access text default null
) returns jsonb language sql security invoker set search_path='' as $$
 select private.feasibility_company_invitations(p_action,p_organization,p_invitation,p_project,
  p_recipient,p_revision,p_days,p_access)
$$;
revoke all on function public.feasibility_company_invitations(text,uuid,uuid,uuid,uuid,integer,integer,text)
 from public,anon,authenticated,service_role;
grant execute on function public.feasibility_company_invitations(text,uuid,uuid,uuid,uuid,integer,integer,text)
 to authenticated;

commit;
