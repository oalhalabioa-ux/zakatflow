-- Sensitive financial permissions must be explicit for non-owner roles, and approval validity must be consistent through posting/settlement.
create or replace function public.explicit_organization_permission(p_org uuid,p_permission text,p_amount numeric default null,p_currency text default null)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare m public.organization_members%rowtype; ov public.organization_member_permission_overrides%rowtype; allowed boolean:=false; lim numeric;
begin
 if auth.uid() is null then return false; end if;
 select * into m from public.organization_members where organization_id=p_org and user_id=auth.uid() and status='ACTIVE';
 if m.user_id is null then return false; end if;
 select * into ov from public.organization_member_permission_overrides where organization_id=p_org and user_id=auth.uid() and permission=p_permission;
 if ov.effect='DENY' then return false; end if;
 if ov.effect='ALLOW' then
  if p_amount is not null and ov.amount_limit is not null and p_amount>ov.amount_limit then return false; end if;
  if p_currency is not null and ov.currency is not null and upper(p_currency)<>upper(ov.currency) then return false; end if;
  return true;
 end if;
 if m.custom_role_id is null then return false; end if;
 select p_permission=any(r.permissions),nullif(r.amount_limits->>p_permission,'')::numeric into allowed,lim from public.organization_roles r where r.id=m.custom_role_id and r.organization_id=p_org;
 if not coalesce(allowed,false) then return false; end if;
 if p_amount is not null and lim is not null and p_amount>lim then return false; end if;
 return true;
end $$;

create or replace function public.effective_organization_permission(p_org uuid,p_permission text,p_amount numeric default null,p_currency text default null)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare m public.organization_members%rowtype; sensitive boolean;
begin
 if auth.uid() is null then return false; end if;
 select * into m from public.organization_members where organization_id=p_org and user_id=auth.uid() and status='ACTIVE';
 if m.user_id is null then return false; end if;
 sensitive:=p_permission=any(array['financial_core.approve','financial_core.post','financial_core.reverse','financial_core.self_approve','liquidity.settle','budget.approve']::text[]);
 if m.role='OWNER' and p_permission<>'financial_core.self_approve' then return true; end if;
 if public.explicit_organization_permission(p_org,p_permission,p_amount,p_currency) then return true; end if;
 if sensitive then return false; end if;
 return public.has_organization_permission(p_org,p_permission);
end $$;

create or replace function public.can_self_approve_financial_event(p_org uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_role text; v_policy text;
begin
 if auth.uid() is null then return false; end if;
 select m.role,o.approval_policy into v_role,v_policy from public.organization_members m join public.organizations o on o.id=m.organization_id where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE';
 if v_role is null or v_policy='STRICT_SEGREGATION' then return false; end if;
 if v_policy='OWNER_CONTROLLED' then return v_role='OWNER'; end if;
 if v_policy='ROLE_BASED' then return public.explicit_organization_permission(p_org,'financial_core.self_approve',null,null); end if;
 return false;
end $$;

create or replace function public.financial_event_has_valid_approval(p_event_id uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare e public.financial_events%rowtype; pol text;
begin
 select * into e from public.financial_events where id=p_event_id;
 if e.id is null then return false; end if;
 select approval_policy into pol from public.organizations where id=e.organization_id;
 if exists(select 1 from public.financial_event_approvals a where a.event_id=e.id and a.organization_id=e.organization_id and a.decision='APPROVED' and a.approver_id<>e.created_by) then return true; end if;
 if pol='OWNER_CONTROLLED' and exists(select 1 from public.financial_event_approvals a join public.organization_members m on m.organization_id=a.organization_id and m.user_id=a.approver_id and m.status='ACTIVE' where a.event_id=e.id and a.decision='APPROVED' and a.approver_id=e.created_by and m.role='OWNER') then return true; end if;
 if pol='ROLE_BASED' and exists(select 1 from public.financial_event_approvals a join public.organization_member_permission_overrides o on o.organization_id=a.organization_id and o.user_id=a.approver_id and o.permission='financial_core.self_approve' and o.effect='ALLOW' where a.event_id=e.id and a.decision='APPROVED' and a.approver_id=e.created_by) then return true; end if;
 if pol='ROLE_BASED' and exists(select 1 from public.financial_event_approvals a join public.organization_members m on m.organization_id=a.organization_id and m.user_id=a.approver_id and m.status='ACTIVE' join public.organization_roles r on r.id=m.custom_role_id and r.organization_id=m.organization_id where a.event_id=e.id and a.decision='APPROVED' and a.approver_id=e.created_by and 'financial_core.self_approve'=any(r.permissions)) then return true; end if;
 return false;
end $$;

do $$
declare d text;
begin
 select pg_get_functiondef('public.transition_financial_event(uuid,text,text)'::regprocedure) into d;
 d:=replace(d,'if p_new_status=''ACTUAL'' and not exists(select 1 from public.financial_event_approvals a where a.event_id=v_event.id and a.decision=''APPROVED'' and a.approver_id<>v_event.created_by) then raise exception ''INDEPENDENT_APPROVAL_REQUIRED''; end if;','if p_new_status=''ACTUAL'' and not public.financial_event_has_valid_approval(v_event.id) then raise exception ''VALID_APPROVAL_REQUIRED''; end if;');
 execute d;
 select pg_get_functiondef('private.cash_post_financial_settlement_atomic(uuid,uuid,text,date,numeric,text,numeric,numeric,jsonb)'::regprocedure) into d;
 d:=replace(d,'if not public.has_organization_permission(v_event.organization_id,''liquidity.edit'') then raise exception ''CASH_SETTLEMENT_POST_DENIED''; end if;','if not public.effective_organization_permission(v_event.organization_id,''liquidity.settle'',p_base_amount,v_event.base_currency) then raise exception ''CASH_SETTLEMENT_POST_DENIED''; end if;');
 d:=replace(d,'if not exists(select 1 from public.financial_event_approvals a where a.event_id=v_event.id and a.organization_id=v_event.organization_id and a.decision=''APPROVED'' and a.approver_id<>v_event.created_by) then raise exception ''INDEPENDENT_APPROVAL_REQUIRED''; end if;','if not public.financial_event_has_valid_approval(v_event.id) then raise exception ''VALID_APPROVAL_REQUIRED''; end if;');
 execute d;
end $$;

revoke all on function public.explicit_organization_permission(uuid,text,numeric,text) from public,anon;
grant execute on function public.explicit_organization_permission(uuid,text,numeric,text) to authenticated;
revoke all on function public.financial_event_has_valid_approval(uuid) from public,anon;
grant execute on function public.financial_event_has_valid_approval(uuid) to authenticated;