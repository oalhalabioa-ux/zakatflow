create or replace function private.ensure_advance_classifications(p_org uuid)returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.financial_core_can(p_org,'financial_core.create') or not public.effective_organization_permission(p_org,'liquidity.edit',null,null) then raise exception 'ADVANCE_ACTION_DENIED';end if;
 insert into public.financial_classifications(organization_id,code,name,classification_type,is_system,created_by)
 select p_org,v.code,v.name,v.kind,true,auth.uid() from(values('ADVANCE_SUPPLIER_ASSET','دفعات مقدمة للموردين','ASSET'),('ADVANCE_CUSTOMER_LIABILITY','دفعات العملاء المقدمة','LIABILITY'),('ADVANCE_PAYABLE_CLEARING','تسوية دفعات الموردين','PAYABLE'),('ADVANCE_RECEIVABLE_CLEARING','تسوية دفعات العملاء','RECEIVABLE'))v(code,name,kind)
 on conflict(organization_id,code)do nothing;
end $$;
revoke all on function private.ensure_advance_classifications(uuid) from public,anon;
grant execute on function private.ensure_advance_classifications(uuid) to authenticated;
create or replace function public.ensure_advance_classifications(p_org uuid)returns void language sql security invoker set search_path=pg_catalog,public,private as $$select private.ensure_advance_classifications(p_org);$$;
revoke all on function public.ensure_advance_classifications(uuid) from public,anon;
grant execute on function public.ensure_advance_classifications(uuid) to authenticated;

