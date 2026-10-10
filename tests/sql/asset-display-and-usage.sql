-- Run in QA inside BEGIN/ROLLBACK. No production fixtures.
create temporary table asset_display_results(test text,passed boolean);
grant select,insert on asset_display_results to authenticated;
do $$
declare uid uuid; other_uid uuid; before_assets text; after_assets text; before_settings jsonb; after_settings jsonb; gold jsonb; failed boolean:=false; changed integer;
begin
 select id into uid from public.profiles where base_currency='SAR' limit 1;
 select id into other_uid from public.profiles where id<>uid limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 set local role authenticated;
 select md5(coalesce(string_agg(to_jsonb(a)::text,',' order by id),'')) into before_assets from public.asset_accounts a;
 insert into public.user_settings(user_id) values(uid) on conflict(user_id) do nothing;
 select to_jsonb(s)-'asset_usage_mode'-'updated_at' into before_settings from public.user_settings s where user_id=uid;
 update public.user_settings set asset_usage_mode='ORGANIZATION' where user_id=uid;
 insert into asset_display_results values('usage_mode_saved_for_owner',(select asset_usage_mode='ORGANIZATION' from public.user_settings where user_id=uid));
 select to_jsonb(s)-'asset_usage_mode'-'updated_at' into after_settings from public.user_settings s where user_id=uid;
 insert into asset_display_results values('other_settings_preserved',before_settings=after_settings);
 select md5(coalesce(string_agg(to_jsonb(a)::text,',' order by id),'')) into after_assets from public.asset_accounts a;
 insert into asset_display_results values('usage_does_not_mutate_assets',before_assets=after_assets);
 update public.user_settings set asset_usage_mode='PERSONAL' where user_id=other_uid;
 get diagnostics changed=row_count;
 insert into asset_display_results values('cannot_change_other_user_usage',other_uid is not null and changed=0);
 begin update public.user_settings set asset_usage_mode='INVALID' where user_id=uid;exception when check_violation then failed:=true;end;
 insert into asset_display_results values('invalid_usage_rejected',failed);
 gold:=public.create_asset_with_acquisition(jsonb_build_object('name','QA classified gold','asset_type','GOLD','asset_class_code','METALS','asset_type_code','GOLD','currency','SAR','unit','g','ownership_scope','PERSONAL','metadata',jsonb_build_object('quantity',50,'purchase_price',400,'purchase_value',20000,'karat',24,'purchase_date','2026-01-01','acquisition_mode','OPENING_BALANCE')),gen_random_uuid());
 insert into asset_display_results values('classified_gold_uses_existing_quantity_and_cost',(select sum(remaining_quantity)=50 and sum(remaining_value_base)=20000 from public.lots where asset_account_id=(gold->>'id')::uuid));
end $$;
select * from asset_display_results;
