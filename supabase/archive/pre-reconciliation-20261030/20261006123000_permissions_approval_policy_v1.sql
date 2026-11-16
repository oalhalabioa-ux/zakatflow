-- Permissions & Approval Policy V1
alter table public.organizations add column if not exists approval_policy text not null default 'OWNER_CONTROLLED';
alter table public.organizations drop constraint if exists organizations_approval_policy_check;
alter table public.organizations add constraint organizations_approval_policy_check check (approval_policy in ('OWNER_CONTROLLED','ROLE_BASED','STRICT_SEGREGATION'));

create or replace function public.can_self_approve_financial_event(p_org uuid)
returns boolean language plpgsql stable security definer set search_path='pg_catalog','public' as $$
declare v_role text; v_policy text;
begin
 if auth.uid() is null then return false; end if;
 select m.role,o.approval_policy into v_role,v_policy
 from public.organization_members m join public.organizations o on o.id=m.organization_id
 where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE';
 if v_role is null or v_policy='STRICT_SEGREGATION' then return false; end if;
 if v_policy='OWNER_CONTROLLED' and v_role='OWNER' then return true; end if;
 if v_policy='ROLE_BASED' then return public.has_organization_permission(p_org,'financial_core.self_approve'); end if;
 return false;
end $$;

create or replace function public.approve_financial_event(p_event_id uuid,p_note text default null)
returns bigint language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_event public.financial_events%rowtype; v_id bigint;
begin
 select * into v_event from public.financial_events where id=p_event_id for update;
 if v_event.id is null then raise exception 'FINANCIAL_EVENT_NOT_FOUND'; end if;
 if not public.financial_core_can(v_event.organization_id,'financial_core.approve') then raise exception 'FINANCIAL_CORE_APPROVE_DENIED'; end if;
 if v_event.status<>'COMMITTED' then raise exception 'EVENT_MUST_BE_COMMITTED_BEFORE_APPROVAL'; end if;
 if v_event.created_by=auth.uid() and not public.can_self_approve_financial_event(v_event.organization_id) then raise exception 'CREATOR_CANNOT_APPROVE_OWN_EVENT'; end if;
 insert into public.financial_event_approvals(event_id,organization_id,approver_id,decision,note)
 values(v_event.id,v_event.organization_id,auth.uid(),'APPROVED',p_note) returning id into v_id;
 insert into public.financial_event_status_history(event_id,organization_id,from_status,to_status,actor_id,note)
 values(v_event.id,v_event.organization_id,v_event.status,v_event.status,auth.uid(),'Approved');
 return v_id;
end $$;