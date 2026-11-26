-- New unsupported assets must not cause an earlier date to enter review.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('b4630200-0000-4000-8000-000000000001','cutoff-asset@example.invalid',now());
insert into public.profiles(id,base_currency) values ('b4630200-0000-4000-8000-000000000001','SAR')
 on conflict(id) do update set base_currency=excluded.base_currency;
set local role authenticated;
select set_config('request.jwt.claim.sub','b4630200-0000-4000-8000-000000000001',true);

do $$
declare
 actor uuid:=auth.uid();
 cycle_id uuid;
 gold_account uuid;
 gold_movement uuid;
 receivable_account uuid;
 method record;
 historical_date date:='2026-02-01';
 added_date date:='2026-02-02';
 historical_evidence jsonb:='{}';
 after_evidence jsonb;
begin
 insert into public.user_settings(user_id,hawl_nisab_policy) values(actor,'CONTINUOUS')
  on conflict(user_id) do update set hawl_nisab_policy=excluded.hawl_nisab_policy;
 insert into public.asset_accounts(user_id,asset_type,name,currency,unit,ownership_scope,is_zakatable)
  values(actor,'GOLD','Synthetic qualifying gold','SAR','g','PERSONAL',true) returning id into gold_account;
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value)
  values(actor,gold_account,'PURCHASE','2026-01-01',90,'SAR','SAR',36000) returning id into gold_movement;
 insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,
   original_value_base,remaining_value_base)
  values(actor,gold_account,gold_movement,'2026-01-01','2026-01-01',90,90,36000,36000);
 insert into public.zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_reached_date,hawl_start_date,hawl_due_date,status,snapshot)
  values(actor,1,'GOLD','2026-01-01','2026-01-01','2026-12-22','ACTIVE',
   jsonb_build_object('personal_start_policy','FIRST_NISAB_V1','nisabEvidence',
     jsonb_build_object('status','PROVEN','movementIds',jsonb_build_array(gold_movement))))
  returning id into cycle_id;
 for method in select id,code from public.zakat_methods where code in ('INDEPENDENT_LOTS','UNIFIED_HAWL') loop
  historical_evidence:=historical_evidence||jsonb_build_object(method.code,
    public.personal_zakat_assessment_context(cycle_id,method.id,historical_date)->'continuity');
 end loop;
 assert historical_evidence ?& array['INDEPENDENT_LOTS','UNIFIED_HAWL'];

 insert into public.asset_accounts(user_id,asset_type,name,currency,ownership_scope,is_zakatable)
  values(actor,'RECEIVABLE','Synthetic later receivable','SAR','PERSONAL',true) returning id into receivable_account;
 -- No lot initially: the future account is deliberately unreconciled as well.
 insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value)
  values(actor,receivable_account,'ADD',added_date,11500,'SAR','SAR',11500);

 for method in select id,code from public.zakat_methods where code in ('INDEPENDENT_LOTS','UNIFIED_HAWL') loop
  after_evidence:=public.personal_zakat_assessment_context(cycle_id,method.id,historical_date)->'continuity';
  assert after_evidence=historical_evidence->method.code,
    'Later unsupported and unreconciled activity changed the earlier evidence';
  begin
   perform public.personal_zakat_assessment_context(cycle_id,method.id,added_date);
   raise exception 'Expected review at the effective receivable date for %',method.code;
  exception when raise_exception then
   if sqlerrm<>'HAWL_CONTINUITY_UNSUPPORTED_ASSET' then raise; end if;
  end;
 end loop;

 -- Relevant supported accounts still require full ledger-to-inventory reconciliation.
 update public.lots set remaining_quantity=89 where source_transaction_id=gold_movement;
 for method in select id,code from public.zakat_methods where code in ('INDEPENDENT_LOTS','UNIFIED_HAWL') loop
  begin
   perform public.personal_zakat_assessment_context(cycle_id,method.id,historical_date);
   raise exception 'Expected review of relevant account reconciliation for %',method.code;
  exception when raise_exception then
   if sqlerrm<>'HAWL_CONTINUITY_UNRECONCILED_BALANCE' then raise; end if;
  end;
 end loop;
 raise notice 'PASS both methods preserve historical continuity evidence and review unsupported or unreconciled in-scope evidence';
end $$;
rollback;
