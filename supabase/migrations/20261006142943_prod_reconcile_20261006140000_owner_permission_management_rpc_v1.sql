-- Owner-managed role and member permission mutation RPCs
create or replace function public.owner_update_organization_role(p_org uuid,p_role_id uuid,p_permissions text[],p_amount_limits jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE' and m.role='OWNER') then raise exception 'OWNER_REQUIRED_TO_MANAGE_PERMISSIONS'; end if;
 update public.organization_roles set permissions=coalesce(p_permissions,array[]::text[]),amount_limits=coalesce(p_amount_limits,'{}'::jsonb),updated_at=now()
 where id=p_role_id and organization_id=p_org and is_editable=true;
 if not found then raise exception 'EDITABLE_ROLE_NOT_FOUND'; end if;
end $$;

create or replace function public.owner_set_member_permission_override(p_org uuid,p_user uuid,p_permission text,p_effect text default null,p_amount_limit numeric default null,p_currency text default null)
returns void language plpgsql security definer set search_path='pg_catalog','public' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE' and m.role='OWNER') then raise exception 'OWNER_REQUIRED_TO_MANAGE_PERMISSIONS'; end if;
 if not exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=p_user and m.status='ACTIVE') then raise exception 'ACTIVE_MEMBER_REQUIRED'; end if;
 if p_user=auth.uid() then raise exception 'OWNER_CANNOT_CHANGE_OWN_PERMISSION_OVERRIDE'; end if;
 if p_effect is null then delete from public.organization_member_permission_overrides where organization_id=p_org and user_id=p_user and permission=p_permission; return; end if;
 if p_effect not in ('ALLOW','DENY') then raise exception 'INVALID_PERMISSION_OVERRIDE_EFFECT'; end if;
 insert into public.organization_member_permission_overrides(organization_id,user_id,permission,effect,amount_limit,currency,created_by)
 values(p_org,p_user,p_permission,p_effect,p_amount_limit,upper(p_currency),auth.uid())
 on conflict(organization_id,user_id,permission) do update set effect=excluded.effect,amount_limit=excluded.amount_limit,currency=excluded.currency,updated_at=now();
end $$;