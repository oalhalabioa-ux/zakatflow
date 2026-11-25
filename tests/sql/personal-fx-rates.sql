-- Run against a disposable database after applying the canonical migrations.
begin;
do $test$
declare
  owner_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  asset_id uuid := gen_random_uuid();
  transaction_id uuid;
  saved_rate_id uuid;
  asset_updated_at timestamptz;
  change jsonb := '{"name":"FX opening test","date":"2026-11-07","amount":100,"quantity":1,"fx_rate":4,"fx_rate_date":"2026-11-07","fx_rate_source":"QA personal"}';
begin
  insert into auth.users(id,email,email_confirmed_at) values
    (owner_id,owner_id||'@personal-fx.invalid',now()),
    (outsider_id,outsider_id||'@personal-fx.invalid',now());
  update public.profiles set base_currency='SAR' where id in (owner_id,outsider_id);
  insert into public.fx_rates(from_currency,to_currency,valuation_date,rate,source)
    values ('USD','SAR','2026-11-07',3.75,'QA shared');

  set local role authenticated;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.personal_fx_rates(user_id,from_currency,to_currency,valuation_date,rate,source)
    values (owner_id,'SAR','USD','2026-11-07',0.24,'QA personal') returning id into saved_rate_id;
  insert into public.personal_fx_rates(user_id,from_currency,to_currency,valuation_date,rate,source)
    values (owner_id,'SAR','USD','2026-11-07',0.25,'QA personal')
    on conflict (user_id,from_currency,to_currency,valuation_date,source) do update set rate=excluded.rate;
  insert into public.personal_fx_rates(user_id,from_currency,to_currency,valuation_date,rate,source)
    values (owner_id,'USD','SAR','2026-11-08',9,'QA future');

  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  if exists(select 1 from public.personal_fx_rates where id=saved_rate_id) then
    raise exception 'Other accounts can see the saved FX rate';
  end if;
  update public.personal_fx_rates set rate=1 where id=saved_rate_id;
  if found then raise exception 'Other accounts can update the saved FX rate'; end if;
  begin
    insert into public.personal_fx_rates(user_id,from_currency,to_currency,valuation_date,rate,source)
      values (owner_id,'EUR','SAR','2026-11-07',10,'QA forged owner');
    raise exception 'Other accounts can insert a quote on behalf of the owner';
  exception when insufficient_privilege then null;
  end;
  insert into public.personal_fx_rates(user_id,from_currency,to_currency,valuation_date,rate,source)
    values (outsider_id,'USD','SAR','2026-11-07',17,'QA outsider');

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  if (select count(*) from public.personal_fx_rates) <> 2
    or (select rate from public.personal_fx_rates where id=saved_rate_id) <> 0.25 then
    raise exception 'Personal quote failed isolation or retry';
  end if;
  if has_table_privilege('anon','public.personal_fx_rates','SELECT') then
    raise exception 'Personal rates allow anonymous access';
  end if;

  insert into public.asset_accounts(id,user_id,asset_type,name,currency,ownership_scope)
    values (asset_id,owner_id,'OTHER','Opening asset','USD','PERSONAL')
    returning updated_at into asset_updated_at;
  insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,
    currency,gross_value,base_currency,base_value,created_by)
    values (owner_id,asset_id,'OPENING_BALANCE','2026-11-07',1,'USD',100,'SAR',375,owner_id)
    returning id into transaction_id;
  insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,
    hawl_start_date,hawl_due_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base)
    values (owner_id,asset_id,transaction_id,'2026-11-07','2026-11-07','2027-11-07',1,1,375,375);
  change := change || jsonb_build_object('fx_rate_id',saved_rate_id);
  perform public.manage_asset_opening(asset_id,'UPDATE',asset_updated_at,change);
  if not exists (select 1 from public.transactions
    where id=transaction_id and base_value=400 and metadata->>'fx_rate_id'=saved_rate_id::text) then
    raise exception 'The opening command failed to apply the private inverse quote';
  end if;
end
$test$;
rollback;
