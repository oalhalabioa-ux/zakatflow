-- Exercises the REAL normalization RPC after every canonical Production
-- migration has been applied. Disposable local database only; ROLLBACK.
begin;
do $$
declare
 actor uuid:=gen_random_uuid();
 org uuid:=gen_random_uuid();
 classification uuid:=gen_random_uuid();
 event_id uuid:=gen_random_uuid();
 line_id uuid:=gen_random_uuid();
 reported jsonb;
 event_lines jsonb;
 total numeric;
begin
 insert into auth.users(id,email,email_confirmed_at)
 values(actor,actor::text||'@financial-parity.invalid',now());
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.organizations(id,owner_user_id,name,base_currency)
 values(org,actor,'Isolated Production-source normalization','SAR');
 insert into public.organization_members(organization_id,user_id,role,status)
 values(org,actor,'OWNER','ACTIVE');
 insert into public.financial_classifications(id,organization_id,code,name,
  classification_type,created_by)
 values(classification,org,'INPUTVAT','Partial input VAT','EXPENSE',actor);
 insert into public.financial_events(id,organization_id,event_type,source_module,
  source_event_key,event_date,status,base_currency,created_by)
 values(event_id,org,'EXPENSE','PARITY_QA','vat-split','2026-03-02','ACTUAL','SAR',actor);
 insert into public.financial_event_lines(id,event_id,organization_id,line_number,
  classification_id,amount,currency,exchange_rate,base_amount,cash_direction,
  recoverable_percent,metadata)
 values(line_id,event_id,org,1,classification,100,'SAR',1,100,'NON_CASH',60,
  '{"source_role":"INPUT_VAT","recoverable_percent":"60"}'::jsonb);

 select private.financial_reporting_events(org,date '2026-01-01',date '2026-12-31')
 into reported;
 if jsonb_typeof(reported)<>'array' or jsonb_array_length(reported)<>1
 then raise exception 'PARITY_NORMALIZED_EVENT_COVERAGE_INVALID';end if;
 event_lines:=reported->0->'lines';
 if jsonb_array_length(event_lines)<>2
 then raise exception 'PARITY_VAT_PART_COUNT_INVALID';end if;
 select sum((part->>'baseAmount')::numeric) into total
 from jsonb_array_elements(event_lines) part;
 if total<>100 then raise exception 'PARITY_VAT_PARTS_DO_NOT_MATCH_RAW_SOURCE';end if;
 if not exists(select 1 from jsonb_array_elements(event_lines) l
   where l->>'id'=line_id::text||':INPUT_VAT_RECOVERABLE'
   and l->>'classificationId'=classification::text||':INPUT_VAT_RECOVERABLE'
   and (l->>'baseAmount')::numeric=60
   and l->>'cashDirection'='NON_CASH'
   and (l->>'recognitionSign')::int=1)
 or not exists(select 1 from jsonb_array_elements(event_lines) l
   where l->>'id'=line_id::text||':INPUT_VAT_NONRECOVERABLE'
   and l->>'classificationId'=classification::text||':INPUT_VAT_NONRECOVERABLE'
   and (l->>'baseAmount')::numeric=40
   and l->>'cashDirection'='NON_CASH'
   and (l->>'recognitionSign')::int=1)
 then raise exception 'PARITY_VAT_PART_CLASSIFICATION_OR_DIRECTION_INVALID';end if;
 if (select count(distinct part->>'id') from jsonb_array_elements(event_lines) part)<>2
 then raise exception 'PARITY_VAT_PART_DUPLICATED';end if;
end $$;
rollback;
