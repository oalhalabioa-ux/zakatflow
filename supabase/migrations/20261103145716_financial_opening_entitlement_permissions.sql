create or replace function private.financial_opening_can(p_org uuid,p_permission text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare writable boolean;
begin
 if auth.uid() is null or not exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.status='ACTIVE') or not public.financial_core_can(p_org,p_permission) then return false;end if;
 if p_permission<>'financial_core.view' and to_regprocedure('subscription_private.entitlement(uuid)') is not null then
  execute 'select coalesce((subscription_private.entitlement($1)->>''can_write'')::boolean,false)' into writable using p_org;
  if not writable then return false;end if;
 end if;
 return true;
end $$;
revoke all on function private.financial_opening_can(uuid,text) from public,anon;
grant execute on function private.financial_opening_can(uuid,text) to authenticated;
