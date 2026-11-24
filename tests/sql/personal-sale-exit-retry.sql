begin;

-- A failed audit must roll back both the financial effect and the replay record.
alter table public.audit_logs add constraint qa_personal_exit_reject_audit
  check (new_data->>'notes' is distinct from 'QA personal exit audit failure') not valid;

do $test$
declare
  actor uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  asset uuid := gen_random_uuid();
  bank uuid := gen_random_uuid();
  opening uuid;
  request uuid := gen_random_uuid();
  result jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at) values
    (actor, actor || '@exit-replay.invalid', now()), (outsider, outsider || '@exit-replay.invalid', now());
  update public.profiles set base_currency = 'SAR' where id = actor;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', actor::text, true);

  insert into public.asset_accounts(id, user_id, asset_type, name, currency, ownership_scope)
    values (asset, actor, 'GOLD', 'QA exit replay', 'SAR', 'PERSONAL'),
           (bank, actor, 'BANK', 'QA exit bank', 'SAR', 'PERSONAL');
  insert into public.transactions(user_id, asset_account_id, transaction_type, transaction_date,
    quantity, currency, gross_value, base_currency, base_value, created_by)
    values (actor, asset, 'OPENING_BALANCE', '2025-01-01', 8, 'SAR', 2400, 'SAR', 2400, actor)
    returning id into opening;
  insert into public.lots(user_id, asset_account_id, source_transaction_id, acquisition_date,
    original_quantity, remaining_quantity, original_value_base, remaining_value_base)
    values (actor, asset, opening, '2025-01-01', 8, 8, 2400, 2400);

  begin
    perform public.post_personal_asset_exit(request, 'SALE', asset, bank, '2025-02-01',
      2, 900, 'SAR', 'SAR', 900, 'QA personal exit audit failure');
    raise exception 'The failing audit was accepted';
  exception when check_violation then
    if sqlerrm not like '%qa_personal_exit_reject_audit%' then raise; end if;
  end;

  if exists (select 1 from private.personal_asset_exit_requests where request_id = request)
    or exists (select 1 from public.transactions where asset_account_id = bank or (asset_account_id = asset and id <> opening))
    or (select remaining_quantity from public.lots where source_transaction_id = opening) is distinct from 8
    or (select remaining_value_base from public.lots where source_transaction_id = opening) is distinct from 2400 then
    raise exception 'Failed audit left financial effects or a saved request';
  end if;

  result := public.post_personal_asset_exit(request, 'SALE', asset, bank, '2025-02-01',
    2, 900, 'SAR', 'SAR', 900, null);
  if result is distinct from public.post_personal_asset_exit(request, 'SALE', asset, bank, '2025-02-01',
    2.00, 900.00, 'SAR', 'SAR', 900.00, null) then
    raise exception 'Replay returned a different sale or receipt';
  end if;

  perform set_config('request.jwt.claim.sub', outsider::text, true);
  if exists (select 1 from private.personal_asset_exit_requests where request_id = request) then
    raise exception 'Another user can see the request';
  end if;
  begin
    perform public.post_personal_asset_exit(request, 'SALE', asset, bank, '2025-02-01',
      2, 900, 'SAR', 'SAR', 900, null);
    raise exception 'Another user recovered a receipt from the same key';
  exception when raise_exception then
    if sqlerrm <> 'ASSET_NOT_FOUND' then raise; end if;
  end;
  if has_function_privilege('anon', 'public.post_personal_asset_exit(uuid,text,uuid,uuid,date,numeric,numeric,text,text,numeric,text)', 'execute') then
    raise exception 'An anonymous role can call the exit RPC';
  end if;
end;
$test$;

select 'personal_exit_rollback_replay_and_isolation_pass';
rollback;
