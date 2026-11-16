-- Route Financial Core authorization through effective permissions
create or replace function public.financial_core_can(p_org uuid,p_scope text)
returns boolean language sql stable security definer set search_path='pg_catalog','public' as $$
 select public.effective_organization_permission(p_org,p_scope,null,null);
$$;

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
 if v_policy='ROLE_BASED' then return public.effective_organization_permission(p_org,'financial_core.self_approve',null,null); end if;
 return false;
end $$;