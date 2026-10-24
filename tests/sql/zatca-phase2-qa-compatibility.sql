-- Financial Core QA only. Run in ONE transaction:
-- BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='45s';
-- load zatca-phase2-ledger.sql, zatca-source-freeze.sql,
-- zatca-source-freeze-permissions.sql (NEVER the source-shaped/auth harness).
-- load this script; ROLLBACK. Do not COMMIT. No real key or authority request.
do $test$
declare
  actor uuid; org uuid:=gen_random_uuid(); connection uuid:=gen_random_uuid();
  frozen uuid:=gen_random_uuid(); editable uuid:=gen_random_uuid(); invoice_uuid uuid:=gen_random_uuid();
  header jsonb; draft jsonb; lines jsonb; amounts jsonb; totals jsonb; context jsonb; expected jsonb;
  reserved zatca_preparation.entries; prepared zatca_preparation.entries; repeated zatca_preparation.entries;
  artifact text:='<synthetic-QA-storage-payload/>'; artifact_hash text; reason text; changed bigint; tests integer:=0; row_id uuid;
begin
  select user_id into actor from public.organization_members where role='OWNER' and status='ACTIVE' order by created_at limit 1;
  if actor is null then raise exception 'QA_EXISTING_OWNER_REQUIRED'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  insert into public.organizations(id,name,legal_name,owner_user_id,entity_type)
    values(org,'QA_PHASE2_ROLLBACK_COMPATIBILITY','QA synthetic only',actor,'COMPANY');
  insert into public.organization_members(organization_id,user_id,role,status) values(org,actor,'OWNER','ACTIVE');
  insert into public.vat_profiles(organization_id,registration_status,tax_registration_number,registration_date,filing_frequency,standard_rate,
    registered_name,seller_street,seller_building_number,seller_district,seller_additional_number,seller_city,seller_postal_code,created_by)
    values(org,'REGISTERED','312345678901233','2026-01-01','QUARTERLY',15,'Synthetic seller','Synthetic street','1234','Olaya','5678','Riyadh','12345',actor);
  insert into public.vat_einvoice_connections(id,organization_id,environment,status,taxpayer_vat_number,common_name,legal_name,
    branch_name,branch_location,industry,egs_serial_number,invoice_type,kms_key_arn)
    values(connection,org,'SIMULATION','COMPLIANCE_PASSED','312345678901233','QA_ONLY','Synthetic seller','QA','Riyadh',
      'QA_ONLY','SYNTHETIC-EGS','1100','QA_ONLY_NON_OPERATIONAL_KEY_PLACEHOLDER');
  draft:=jsonb_build_object('organization_id',org,'buyer_contact_id',null,'connection_id',connection,'invoice_number','QA-FROZEN',
    'document_type','INVOICE','invoice_category','SIMPLIFIED','issue_date','2026-10-24','due_date',null,'issue_time','12:00:00',
    'currency','SAR','exchange_rate',1,'seller_name','Synthetic seller','seller_vat_number','312345678901233',
    'seller_address','Synthetic street','seller_city','Riyadh','seller_building_number','1234','seller_district','Olaya',
    'seller_additional_number','5678','seller_postal_code','12345','seller_country_code','SA','buyer_name',null,'buyer_vat_number',null,
    'buyer_address',null,'buyer_city',null,'buyer_building_number',null,'buyer_district',null,'buyer_additional_number',null,
    'buyer_postal_code',null,'buyer_country_code','SA','payment_means_code','30','billing_reference',null,'preceding_invoice_id',null,'note_reason',null);
  totals:='{"line_extension_amount":"100.00","allowance_total_amount":"0.00","tax_exclusive_amount":"100.00","tax_total_amount":"15.00","tax_inclusive_amount":"115.00","payable_amount":"115.00"}';
  lines:='[{"item_name":"QA service","description":null,"quantity":1,"unit_code":"PCE","unit_price":100,"discount_amount":0,"tax_category":"S","tax_rate":15,"tax_exemption_reason_code":null,"tax_exemption_reason":null}]';
  amounts:='[{"line_number":1,"line_extension_amount":"100.00","tax_amount":"15.00","gross_amount":"115.00"}]';
  context:='{"supplyDate":"2026-10-24","sellerId":{"scheme":"CRN","value":"1010000000"},"paymentMeansCode":"30"}';
  header:=draft||totals||jsonb_build_object('id',frozen,'invoice_uuid',invoice_uuid,'status','DRAFT','tax_total_amount_sar',15,'created_at',now(),'updated_at',now());
  insert into public.vat_einvoices select * from jsonb_populate_record(null::public.vat_einvoices,header);
  insert into public.vat_einvoices select * from jsonb_populate_record(null::public.vat_einvoices,
    header||jsonb_build_object('id',editable,'invoice_uuid',gen_random_uuid(),'invoice_number','QA-EDITABLE'));
  foreach row_id in array array[frozen,editable] loop
    insert into public.vat_einvoice_lines select * from jsonb_populate_record(null::public.vat_einvoice_lines,
      (lines->0)||(amounts->0)||jsonb_build_object('id',gen_random_uuid(),'invoice_id',row_id,'created_at',now()));
  end loop;
  insert into zatca_preparation.units(organization_id,environment,unit_id) values(org,'SIMULATION',connection);
  insert into zatca_preparation.document_context(invoice_id,organization_id,context) values(frozen,org,context);
  expected:=jsonb_build_object('version','ZATCA_PREPARATION_V1','scope',jsonb_build_object('organizationId',org,
    'environment','SIMULATION','unitId',connection,'connectionId',connection,'documentId',frozen,'invoiceUuid',invoice_uuid),
    'draft',draft||jsonb_build_object('lines',lines),'context',context,'savedTotals',totals,'savedLineAmounts',amounts);

  -- Actual DB role + actual RLS. Session claims are a SQL test stand-in, not a browser/JWT test.
  set local role authenticated;
  update public.vat_einvoices set note_reason='QA editable' where id=editable;
  get diagnostics changed=row_count; if changed<>1 then raise exception 'QA_UNRESERVED_HEADER_EDIT_FAILED'; end if; tests:=tests+1;
  update public.vat_einvoice_lines set description='QA editable' where invoice_id=editable;
  get diagnostics changed=row_count; if changed<>1 then raise exception 'QA_UNRESERVED_LINE_EDIT_FAILED'; end if; tests:=tests+1;
  perform public.amend_zatca_draft_atomic(editable,header||jsonb_build_object('id',editable,'invoice_number','QA-EDITABLE'),
    jsonb_build_array((lines->0)||(amounts->0))); tests:=tests+1;
  if has_table_privilege('authenticated','zatca_preparation.entries','SELECT')
    or has_table_privilege('authenticated','zatca_preparation.entries','INSERT')
    or has_table_privilege('authenticated','zatca_preparation.entries','UPDATE')
    or has_table_privilege('authenticated','zatca_preparation.entries','TRUNCATE')
    or has_function_privilege('authenticated','zatca_preparation.reserve_saved(uuid,uuid,text,jsonb)','EXECUTE')
    or has_function_privilege('anon','zatca_preparation.source_is_frozen(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','zatca_preparation.finalize_saved(uuid,text,uuid,uuid,text,text,text)','EXECUTE')
    or has_table_privilege('authenticated','zatca_preparation.reservation_config','SELECT')
    or has_table_privilege('authenticated','zatca_preparation.finalization_audit','SELECT')
    or has_table_privilege('authenticated','zatca_preparation.finalization_audit','TRUNCATE') then raise exception 'QA_PRIVATE_GRANTS_UNSAFE'; end if; tests:=tests+1;
  reset role;
  reserved:=zatca_preparation.reserve_saved(org,frozen,'SIMULATION',expected); tests:=tests+1;
  set local role authenticated;
  begin update public.vat_einvoices set invoice_number='FORGED' where id=frozen; reason:='NOT_BLOCKED';
    exception when others then reason:=sqlerrm; end;
  if reason<>'EINVOICE_SOURCE_FROZEN' then raise exception 'QA_FROZEN_HEADER_GUARD:%',reason; end if; tests:=tests+1;
  begin update public.vat_einvoice_lines set unit_price=999 where invoice_id=frozen; reason:='NOT_BLOCKED';
    exception when others then reason:=sqlerrm; end;
  if reason<>'EINVOICE_SOURCE_FROZEN' then raise exception 'QA_FROZEN_LINE_GUARD:%',reason; end if; tests:=tests+1;
  begin perform public.amend_zatca_draft_atomic(frozen,header,jsonb_build_array((lines->0)||(amounts->0))); reason:='NOT_BLOCKED';
    exception when others then reason:=sqlerrm; end;
  if reason<>'EINVOICE_SOURCE_FROZEN' then raise exception 'QA_FROZEN_AMEND_RPC_GUARD:%',reason; end if; tests:=tests+1;
  begin perform public.issue_vat_einvoice(frozen); reason:='NOT_BLOCKED'; exception when others then reason:=sqlerrm; end;
  if reason<>'EINVOICE_SOURCE_FROZEN' then raise exception 'QA_DEFINER_ISSUE_BYPASS:%',reason; end if; tests:=tests+1;
  perform public.issue_vat_einvoice(editable); tests:=tests+1;
  if not exists(select 1 from public.vat_einvoices where id=editable and status='ISSUED') then raise exception 'QA_UNRESERVED_ISSUE_FAILED'; end if;

  -- Private backend stand-in: storage payload is deliberately NOT signed UBL.
  -- Actual cryptographic binding is verified separately by native XMLSec tests.
  reset role;
  artifact_hash:=encode(sha256(convert_to(artifact,'UTF8')),'base64');
  begin
    update public.organization_members set status='INACTIVE' where organization_id=org and user_id=actor;
    perform zatca_preparation.finalize_saved(org,'SIMULATION',connection,reserved.reservation_id,reserved.snapshot_digest,artifact_hash,artifact);
    reason:='NOT_BLOCKED';
  exception when others then reason:=sqlerrm; end;
  if reason<>'ORGANIZATION_ADMIN_REQUIRED' then raise exception 'QA_FINALIZATION_REVOCATION_GUARD:%',reason; end if; tests:=tests+1;
  begin
    update public.vat_einvoice_connections set kms_key_arn='QA_ONLY_CHANGED_KEY_REFERENCE' where id=connection;
    perform zatca_preparation.finalize_saved(org,'SIMULATION',connection,reserved.reservation_id,reserved.snapshot_digest,artifact_hash,artifact);
    reason:='NOT_BLOCKED';
  exception when others then reason:=sqlerrm; end;
  if reason<>'UNIT_CONFIGURATION_CHANGED' then raise exception 'QA_FINALIZATION_CONFIG_GUARD:%',reason; end if; tests:=tests+1;
  begin
    perform zatca_preparation.finalize_saved(org,'SIMULATION',connection,reserved.reservation_id,repeat('0',64),artifact_hash,artifact);
    reason:='NOT_BLOCKED';
  exception when others then reason:=sqlerrm; end;
  if reason<>'SNAPSHOT_DIGEST_MISMATCH' then raise exception 'QA_FINALIZATION_DIGEST_GUARD:%',reason; end if;
  if exists(select 1 from zatca_preparation.finalization_audit where reservation_id=reserved.reservation_id) then raise exception 'QA_DENIED_FINALIZATION_CREATED_AUDIT'; end if; tests:=tests+1;
  prepared:=zatca_preparation.finalize_saved(org,'SIMULATION',connection,reserved.reservation_id,reserved.snapshot_digest,artifact_hash,artifact);
  if prepared.state<>'PREPARED' or not exists(select 1 from public.vat_einvoices where id=frozen and status='DRAFT')
    or not exists(select 1 from zatca_preparation.finalization_audit where reservation_id=reserved.reservation_id and actor_id=actor)
    then raise exception 'QA_PREPARATION_STATE_OR_AUDIT_WRONG'; end if; tests:=tests+1;
  repeated:=zatca_preparation.finalize_saved(org,'SIMULATION',connection,reserved.reservation_id,reserved.snapshot_digest,artifact_hash,artifact);
  if to_jsonb(repeated) is distinct from to_jsonb(prepared)
    or (select count(*) from zatca_preparation.finalization_audit where reservation_id=reserved.reservation_id)<>1
    or (select last_counter from zatca_preparation.units where unit_id=connection)<>1 then raise exception 'QA_FINALIZATION_RETRY_DUPLICATED'; end if; tests:=tests+1;
  begin
    update zatca_preparation.finalization_audit set actor_id=gen_random_uuid() where reservation_id=reserved.reservation_id;
    reason:='NOT_BLOCKED';
  exception when others then reason:=sqlerrm; end;
  if reason<>'PREPARATION_PROVENANCE_IMMUTABLE' then raise exception 'QA_FINALIZATION_AUDIT_MUTABLE:%',reason; end if; tests:=tests+1;
  begin
    update zatca_preparation.reservation_config set connection_stamp=repeat('0',64) where reservation_id=reserved.reservation_id;
    reason:='NOT_BLOCKED';
  exception when others then reason:=sqlerrm; end;
  if reason<>'PREPARATION_PROVENANCE_IMMUTABLE' then raise exception 'QA_RESERVATION_CONFIG_MUTABLE:%',reason; end if; tests:=tests+1;
  set local role authenticated;
  begin perform public.issue_vat_einvoice(frozen); reason:='NOT_BLOCKED'; exception when others then reason:=sqlerrm; end;
  if reason<>'EINVOICE_SOURCE_FROZEN' then raise exception 'QA_PREPARED_SOURCE_ISSUE_BYPASS:%',reason; end if; tests:=tests+1;

  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'role','authenticated')::text,true);
  if exists(select 1 from public.vat_einvoices where organization_id=org)
    or exists(select 1 from public.vat_einvoice_lines where invoice_id in(frozen,editable))
    or exists(select 1 from public.vat_einvoice_connections where organization_id=org) then raise exception 'QA_OUTSIDER_RLS_LEAK'; end if; tests:=tests+1;
  begin perform zatca_preparation.source_is_frozen(org,frozen); reason:='NOT_BLOCKED'; exception when others then reason:=sqlerrm; end;
  if reason<>'VAT_FREEZE_ACCESS_DENIED' then raise exception 'QA_OUTSIDER_LOOKUP_NOT_DENIED:%',reason; end if; tests:=tests+1;
  reset role;
  if (select count(*) from zatca_preparation.entries where organization_id=org)<>1 then raise exception 'QA_DUPLICATE_LEDGER'; end if;
  if exists(select 1 from public.financial_events where organization_id=org)
    or exists(select 1 from public.liquidity_flows where organization_id=org)
    or exists(select 1 from public.vat_documents where organization_id=org) then raise exception 'QA_UNEXPECTED_FINANCIAL_WRITE'; end if; tests:=tests+1;
  perform set_config('qa.phase2.compatibility',jsonb_build_object('passed',tests,'actual_rls',true,
    'frozen_edit_denied',true,'unreserved_amend_and_issue',true,'definer_issue_blocked',true,
    'private_ledger_inaccessible',true,'fresh_finalization_authorization',true,'prepared_state_only',true,'single_finalization_audit',true,'outsider_isolated',true,'no_financial_projection',true,'rollback',true)::text,true);
end $test$;
select current_setting('qa.phase2.compatibility')::jsonb as test_result;
