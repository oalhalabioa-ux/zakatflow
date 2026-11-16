-- Rollback-only Production-history regression: approved opening consumption must
-- not be reported a second time or erroneously rejected by legacy attestation.
-- DO NOT apply this SQL against hosted Production or a customer QA database.
begin;
do $$
declare
 actor uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();
 asset uuid:=gen_random_uuid();
 purchase uuid:=gen_random_uuid();
 opening_id uuid:=gen_random_uuid();
 source jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at)
 values(actor,actor::text||'@opening-attestation.invalid',now());
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.organizations(id,owner_user_id,name,base_currency)
 values(org,actor,'Temporary approved-opening legacy source test','SAR');
 insert into public.organization_members(organization_id,user_id,role,status)
 values(org,actor,'OWNER','ACTIVE');
 insert into public.asset_accounts(id,user_id,asset_type,name,currency,
  organization_id,ownership_scope)
 values(asset,actor,'GOLD','Legacy opening source','SAR',org,'ORGANIZATION');
 insert into public.transactions(id,user_id,asset_account_id,transaction_type,
  transaction_date,quantity,unit_price,currency,gross_value,base_currency,
  base_value,organization_id,metadata)
 values(purchase,actor,asset,'PURCHASE','2026-03-02',
  1,100,'SAR',100,'SAR',100,org,'{}'::jsonb);

 select private.financial_reporting_legacy_events(org,date '2026-01-01',date '2026-12-31')
  into source;
 if jsonb_array_length(source)<>1 or source->0->>'id'<>'transaction:'||purchase::text
 then raise exception 'PARITY_LEGACY_OPENING_SOURCE_FIXTURE_MISSING';end if;
 -- The actual statement compiler excludes source IDs once they have been
 -- consumed by an APPROVED opening. Preserve the original purchase once in
 -- approved opening and never demand the same event in annual movements.
 insert into public.financial_opening_workspaces(
  id,organization_id,fiscal_start,currency,status,
  source_revision,financial_revision,source_snapshot,approved_opening,
  approved_by,approved_at,created_by,updated_by)
 values(opening_id,org,date '2026-01-01','SAR','APPROVED',
  'rollback-opening-source-test','rollback-financial-source-test',
  jsonb_build_object('rows',jsonb_build_array(jsonb_build_object(
   'tab','assets','vouchers',jsonb_build_array(jsonb_build_object(
      'canonicalId','transactions:'||purchase::text,'debit','100.0000','credit','0.0000'))))),
  '[{"accountCode":"1300","debit":"100.0000","credit":"0.0000"},
    {"accountCode":"3000","debit":"0.0000","credit":"100.0000"}]'::jsonb,
  actor,now(),actor,actor);

 -- No reporting movement remains. An unfiltered original-source comparison
 -- would incorrectly raise REPORTING_LEGACY_SOURCE_UNVERIFIED here.
 if public.financial_reporting_legacy_attestation(org,date '2026-01-01',
   date '2026-12-31','[]'::jsonb) is distinct from true
 then raise exception 'PARITY_APPROVED_OPENING_SOURCE_FALSE_REJECTION';end if;

 -- A missing/incorrect approved-opening reference must NEVER justify silently
 -- excluding the real transaction. Exact origin/identity matters.
 update public.financial_opening_workspaces
 set source_snapshot=jsonb_build_object('rows',jsonb_build_array(
  jsonb_build_object('tab','assets','vouchers',jsonb_build_array(
   jsonb_build_object('canonicalId','transactions:'||gen_random_uuid()::text,
                      'debit','100.0000','credit','0.0000'))))),
  updated_by=actor where id=opening_id;
 begin
  perform public.financial_reporting_legacy_attestation(org,date '2026-01-01',
    date '2026-12-31','[]'::jsonb);
  raise exception 'PARITY_UNAPPROVED_SOURCE_OMISSION_WAS_ACCEPTED';
 exception when others then
  if sqlerrm<>'REPORTING_LEGACY_SOURCE_UNVERIFIED' then raise;end if;
 end;
end $$;
rollback;
