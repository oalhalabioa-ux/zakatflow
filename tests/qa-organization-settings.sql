-- Synthetic, transactional settings read/write verification; never persists users.
begin;
do $qa$
declare owner_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid(); org_id uuid:=gen_random_uuid(); changed integer;
begin
 insert into auth.users(id,email,email_confirmed_at) values
  (owner_id,owner_id||'@settings.invalid',now()),(outsider_id,outsider_id||'@settings.invalid',now());
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 insert into public.organizations(id,owner_user_id,name,country_code) values(org_id,owner_id,'Settings acceptance','SA');
 insert into public.organization_members(organization_id,user_id,role,status) values(org_id,owner_id,'OWNER','ACTIVE') on conflict do nothing;
 execute 'set local role authenticated';
 update public.organizations set activity='Trading',contact_email='office@settings.invalid',contact_phone='+966500000000',
  registered_city='Riyadh',registered_region='Riyadh',registered_postal_code='11564',
  registration_authority='QA authority',registration_expires_on=date '2028-12-31' where id=org_id;
 get diagnostics changed=row_count;
 if changed<>1 then raise exception 'SETTINGS_OWNER_SAVE_DENIED';end if;
 if not exists(select 1 from public.organizations where id=org_id and activity='Trading'
  and contact_email='office@settings.invalid' and registration_expires_on=date '2028-12-31')
 then raise exception 'SETTINGS_ROUNDTRIP_FAILED';end if;
 perform set_config('request.jwt.claim.sub',outsider_id::text,true);
 if exists(select 1 from public.organizations where id=org_id) then raise exception 'SETTINGS_FOREIGN_READ_ACCEPTED';end if;
 update public.organizations set contact_email='forbidden@settings.invalid' where id=org_id;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'SETTINGS_FOREIGN_WRITE_ACCEPTED';end if;
 execute 'set local role postgres';
 if (select contact_email from public.organizations where id=org_id)<>'office@settings.invalid'
 then raise exception 'SETTINGS_OWNER_DATA_CHANGED';end if;
end $qa$;
select 'PASS settings owner save/readback, cross-tenant read/write denial';
rollback;
