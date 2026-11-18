-- Explicit documentary pairing, not elimination approval or a journal entry.
-- Both company administrators attest the original documents. No name/amount
-- heuristic can create an approved match. All commands use the caller identity.
create table private.financial_group_document_matches (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
 left_event_id uuid not null references public.financial_events(id),
 right_event_id uuid not null references public.financial_events(id),
 left_organization_id uuid not null references public.organizations(id),
 right_organization_id uuid not null references public.organizations(id),
 evidence_reference text not null check(length(trim(evidence_reference)) between 8 and 1000),
 source_fingerprint text not null,
 status text not null default 'DRAFT' check(status in ('DRAFT','APPROVED','REVOKED')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 approved_by uuid references auth.users(id), approved_at timestamptz,
 revoked_by uuid references auth.users(id), revoked_at timestamptz,
 check(left_event_id<right_event_id),
 check(left_organization_id<>right_organization_id),
 check((status='DRAFT' and approved_by is null and approved_at is null and revoked_by is null and revoked_at is null)
  or (status='APPROVED' and approved_by is not null and approved_at is not null and revoked_by is null and revoked_at is null)
  or (status='REVOKED' and revoked_by is not null and revoked_at is not null))
);
create unique index financial_group_document_active_pair on private.financial_group_document_matches(left_event_id,right_event_id) where status='APPROVED';
create table private.financial_group_document_match_audit (
 id bigint generated always as identity primary key,
 match_id uuid not null references private.financial_group_document_matches(id),
 actor_id uuid not null references auth.users(id),
 action text not null check(action in ('PROPOSE','APPROVE','REVOKE')),
 reason text not null check(length(trim(reason)) between 8 and 1000),
 created_at timestamptz not null default now()
);
create index financial_group_document_audit_lookup on private.financial_group_document_match_audit(match_id,id);
alter table private.financial_group_document_matches enable row level security;
alter table private.financial_group_document_match_audit enable row level security;
revoke all on private.financial_group_document_matches,private.financial_group_document_match_audit from public,anon,authenticated;

-- Private only. The enclosing command checks both companies before calling.
create function private.financial_group_document_fingerprint(p_left uuid,p_right uuid)
returns text language sql stable security definer set search_path='' as $$
 select md5(jsonb_agg(jsonb_build_object('event',to_jsonb(e),'lines',
  (select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]'::jsonb) from public.financial_event_lines l where l.event_id=e.id and l.organization_id=e.organization_id)
 ) order by e.id)::text) from public.financial_events e where e.id in (p_left,p_right)
$$;
revoke all on function private.financial_group_document_fingerprint(uuid,uuid) from public,anon,authenticated;

create function public.financial_group_document_propose(p_first uuid,p_second uuid,p_evidence text,p_reason text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.financial_events%rowtype;b public.financial_events%rowtype;prior private.financial_group_document_matches%rowtype;result uuid;
begin
 if auth.uid() is null or p_request_id is null or p_first is null or p_second is null or p_first=p_second then raise exception 'GROUP_DOCUMENT_WRITE_DENIED';end if;
 select * into a from public.financial_events where id=least(p_first,p_second);
 select * into b from public.financial_events where id=greatest(p_first,p_second);
 if a.id is null or b.id is null or not private.financial_opening_can(a.organization_id,'financial_core.create')
  or not private.financial_opening_can(b.organization_id,'financial_core.create')
  or not public.is_organization_admin(a.organization_id) or not public.is_organization_admin(b.organization_id)
 then raise exception 'GROUP_DOCUMENT_WRITE_DENIED';end if;
 if a.organization_id=b.organization_id or a.status<>'ACTUAL' or b.status<>'ACTUAL' or a.base_currency<>b.base_currency
  or length(trim(coalesce(p_evidence,''))) not between 8 and 1000
  or length(trim(coalesce(p_reason,''))) not between 8 and 1000
 then raise exception 'GROUP_DOCUMENT_EVIDENCE_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('group-document-request:'||p_request_id::text,0));
 select * into prior from private.financial_group_document_matches where request_id=p_request_id;
 if prior.id is not null then
  if prior.created_by<>auth.uid() or prior.left_event_id<>a.id or prior.right_event_id<>b.id or prior.evidence_reference<>trim(p_evidence)
   then raise exception 'GROUP_DOCUMENT_REQUEST_CONFLICT';end if;
  return prior.id;
 end if;
 insert into private.financial_group_document_matches(request_id,left_event_id,right_event_id,left_organization_id,right_organization_id,evidence_reference,source_fingerprint,created_by)
 values(p_request_id,a.id,b.id,a.organization_id,b.organization_id,trim(p_evidence),private.financial_group_document_fingerprint(a.id,b.id),auth.uid()) returning id into result;
 insert into private.financial_group_document_match_audit(match_id,actor_id,action,reason) values(result,auth.uid(),'PROPOSE',trim(p_reason));
 return result;
end $$;

create function public.financial_group_document_decide(p_match uuid,p_action text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare item private.financial_group_document_matches%rowtype;
begin
 if auth.uid() is null then raise exception 'GROUP_DOCUMENT_APPROVAL_DENIED';end if;
 select * into item from private.financial_group_document_matches where id=p_match;
 if item.id is null or not private.financial_opening_can(item.left_organization_id,'financial_core.approve')
  or not private.financial_opening_can(item.right_organization_id,'financial_core.approve')
  or not public.is_organization_admin(item.left_organization_id) or not public.is_organization_admin(item.right_organization_id)
 then raise exception 'GROUP_DOCUMENT_APPROVAL_DENIED';end if;
 if coalesce(p_action,'') not in ('APPROVE','REVOKE') or length(trim(coalesce(p_reason,''))) not between 8 and 1000
 then raise exception 'GROUP_DOCUMENT_DECISION_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('group-document-pair:'||item.left_event_id::text||':'||item.right_event_id::text,0));
 select * into item from private.financial_group_document_matches where id=p_match for update;
 if p_action='APPROVE' then
  if item.status<>'DRAFT' then raise exception 'GROUP_DOCUMENT_NOT_DRAFT';end if;
  if item.created_by=auth.uid() and not(public.can_self_approve_financial_event(item.left_organization_id) and public.can_self_approve_financial_event(item.right_organization_id))
   then raise exception 'GROUP_DOCUMENT_SELF_APPROVAL_DENIED';end if;
  -- Lock originals in deterministic order against a concurrent state transition.
  perform id from public.financial_events where id in(item.left_event_id,item.right_event_id) order by id for update;
  if exists(select 1 from public.financial_events where id in(item.left_event_id,item.right_event_id) and status<>'ACTUAL')
   or private.financial_group_document_fingerprint(item.left_event_id,item.right_event_id)<>item.source_fingerprint
   then raise exception 'GROUP_DOCUMENT_SOURCE_CHANGED';end if;
  if exists(select 1 from private.financial_group_document_matches where left_event_id=item.left_event_id and right_event_id=item.right_event_id and status='APPROVED')
   then raise exception 'GROUP_DOCUMENT_ALREADY_MATCHED';end if;
  update private.financial_group_document_matches set status='APPROVED',approved_by=auth.uid(),approved_at=now() where id=p_match;
 else
  if item.status='REVOKED' then raise exception 'GROUP_DOCUMENT_ALREADY_REVOKED';end if;
  update private.financial_group_document_matches set status='REVOKED',revoked_by=auth.uid(),revoked_at=now() where id=p_match;
 end if;
 insert into private.financial_group_document_match_audit(match_id,actor_id,action,reason) values(p_match,auth.uid(),p_action,trim(p_reason));
 return p_match;
end $$;

create function public.financial_group_document_context(p_matches uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item private.financial_group_document_matches%rowtype;result jsonb:='[]';match_id uuid;
begin
 if auth.uid() is null or p_matches is null or cardinality(p_matches)>200 or array_position(p_matches,null) is not null then raise exception 'GROUP_DOCUMENT_READ_DENIED';end if;
 for match_id in select distinct unnest(p_matches) order by 1 loop
  select * into item from private.financial_group_document_matches where id=match_id;
  if item.id is null or not private.financial_opening_can(item.left_organization_id,'financial_core.view') or not private.financial_opening_can(item.right_organization_id,'financial_core.view') then raise exception 'GROUP_DOCUMENT_READ_DENIED';end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',item.id,'status',item.status,
   'leftOrganizationId',item.left_organization_id,'rightOrganizationId',item.right_organization_id,
   'leftEventId',item.left_event_id,'rightEventId',item.right_event_id,
   'evidenceReference',item.evidence_reference,'approvedBy',item.approved_by,'approvedAt',item.approved_at,
   'sourceCurrent',private.financial_group_document_fingerprint(item.left_event_id,item.right_event_id)=item.source_fingerprint));
 end loop;
 return result;
end $$;
revoke all on function public.financial_group_document_propose(uuid,uuid,text,text,uuid),public.financial_group_document_decide(uuid,text,text),public.financial_group_document_context(uuid[]) from public,anon,authenticated;
grant execute on function public.financial_group_document_propose(uuid,uuid,text,text,uuid),public.financial_group_document_decide(uuid,text,text),public.financial_group_document_context(uuid[]) to authenticated;
