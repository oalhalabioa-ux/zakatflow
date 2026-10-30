-- Master data only: historical invoice snapshots and amounts are untouched.
create or replace function public.amend_vat_contact_master(p_contact_id uuid,p_values jsonb,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare c public.vat_contacts%rowtype; h public.vat_contacts%rowtype;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 select * into c from public.vat_contacts where id=p_contact_id for update;
 if c.id is null then raise exception 'VAT_CONTACT_NOT_FOUND'; end if;
 if not public.is_organization_admin(c.organization_id) then raise exception 'ORGANIZATION_ADMIN_REQUIRED'; end if;
 if p_expected_updated_at is null or c.updated_at is distinct from p_expected_updated_at then raise exception 'VAT_CONTACT_EDIT_CONFLICT'; end if;
 h:=jsonb_populate_record(c,p_values);
 if h.organization_id is distinct from c.organization_id or h.contact_type is distinct from c.contact_type then raise exception 'VAT_CONTACT_SCOPE_MISMATCH'; end if;
 if h.name is null or length(trim(h.name)) not between 1 and 200 then raise exception 'INVALID_VAT_CONTACT'; end if;
 update public.vat_contacts set name=trim(h.name),vat_number=nullif(trim(h.vat_number),''),
  email=nullif(trim(h.email),''),phone=nullif(trim(h.phone),''),street=nullif(trim(h.street),''),
  building_number=nullif(trim(h.building_number),''),district=nullif(trim(h.district),''),
  additional_number=nullif(trim(h.additional_number),''),city=nullif(trim(h.city),''),
  postal_code=nullif(trim(h.postal_code),''),country_code=h.country_code,updated_at=clock_timestamp()
 where id=c.id returning * into h;
 -- Keep the existing financial party identity; update its master name/contact only.
 update public.liquidity_counterparties cp set name=h.name,email=coalesce(h.email,''),phone=coalesce(h.phone,'')
 from public.financial_vat_counterparty_map m where m.vat_contact_id=c.id and m.organization_id=c.organization_id
  and cp.id=m.counterparty_id and cp.organization_id=c.organization_id;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data)
 values(auth.uid(),'vat_contact',c.id,'UPDATE',to_jsonb(c),to_jsonb(h));
 return to_jsonb(h);
end $fn$;
revoke all on function public.amend_vat_contact_master(uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.amend_vat_contact_master(uuid,jsonb,timestamptz) to authenticated;
