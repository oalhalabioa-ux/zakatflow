
create or replace function private.canonical_financial_json(p_value jsonb) returns jsonb language plpgsql immutable strict set search_path='pg_catalog','public','private' as $$declare k text;v jsonb;res jsonb;begin
if jsonb_typeof(p_value)='object' then select coalesce(jsonb_object_agg(key,private.canonical_financial_json(value) order by key),'{}'::jsonb) into res from jsonb_each(p_value);return res;
elsif jsonb_typeof(p_value)='array' then select coalesce(jsonb_agg(private.canonical_financial_json(value) order by ord),'[]'::jsonb) into res from jsonb_array_elements(p_value) with ordinality x(value,ord);return res;
elsif jsonb_typeof(p_value)='number' then return to_jsonb(trim_scale((p_value#>>'{}')::numeric));end if;return p_value;end$$;

create or replace function private.phase2c_create_financial_event_internal(p_payload jsonb) returns uuid language plpgsql security definer set search_path='pg_catalog','public','private','extensions' as $$
declare org uuid;etype text;module text;skey text;eid uuid;norm jsonb;hash text;reg public.financial_event_command_registry%rowtype;x record;
begin
if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
org:=(p_payload->>'organization_id')::uuid;etype:=upper(trim(p_payload->>'event_type'));module:=trim(p_payload->>'source_module');skey:=trim(p_payload->>'source_event_key');
if not public.financial_core_can(org,'financial_core.create') then raise exception 'FINANCIAL_CORE_CREATE_DENIED';end if;
if org is null or etype is null or module is null or skey is null or jsonb_typeof(p_payload->'lines')<>'array' or jsonb_array_length(p_payload->'lines')=0 then raise exception 'EVENT_COMMAND_PAYLOAD_INVALID';end if;
norm:=private.canonical_financial_json(p_payload);hash:=encode(extensions.digest(convert_to(norm::text,'UTF8'),'sha256'),'hex');
perform pg_advisory_xact_lock(hashtextextended(org::text||'|'||module||'|'||skey||'|EVENT_CREATE',0));
select * into reg from public.financial_event_command_registry where organization_id=org and command_type='EVENT_CREATE' and source_module=module and source_event_key=skey for update;
if found then if reg.payload_fingerprint<>hash then raise exception 'IDEMPOTENCY_CONFLICT';end if;return reg.financial_event_id;end if;
insert into public.financial_events(organization_id,entity_id,counterparty_id,vat_profile_id,event_type,source_module,source_record_id,source_event_key,description,event_date,due_date,base_currency,planning_view,scenario_key,created_by)
values(org,nullif(p_payload->>'entity_id','')::uuid,nullif(p_payload->>'counterparty_id','')::uuid,nullif(p_payload->>'vat_profile_id','')::uuid,etype,module,nullif(p_payload->>'source_record_id','')::uuid,skey,coalesce(p_payload->>'description',''),(p_payload->>'event_date')::date,nullif(p_payload->>'due_date','')::date,upper(trim(p_payload->>'base_currency')),nullif(p_payload->>'planning_view',''),nullif(p_payload->>'scenario_key',''),auth.uid()) returning id into eid;
for x in select * from jsonb_to_recordset(p_payload->'lines') as q(line_number int,description text,classification_id uuid,cost_center_id uuid,budget_line_id uuid,amount numeric,currency text,exchange_rate numeric,base_amount numeric,cash_direction text,vat_treatment text,vat_rate numeric,vat_amount numeric,recoverable_percent numeric,metadata jsonb) loop
insert into public.financial_event_lines(event_id,organization_id,line_number,description,classification_id,cost_center_id,budget_line_id,amount,currency,exchange_rate,base_amount,cash_direction,vat_treatment,vat_rate,vat_amount,recoverable_percent,metadata)
values(eid,org,x.line_number,coalesce(x.description,''),x.classification_id,x.cost_center_id,x.budget_line_id,x.amount,upper(x.currency),x.exchange_rate,x.base_amount,upper(x.cash_direction),coalesce(upper(x.vat_treatment),'OUT_OF_SCOPE'),coalesce(x.vat_rate,0),coalesce(x.vat_amount,0),coalesce(x.recoverable_percent,100),coalesce(x.metadata,'{}'));end loop;
for x in select * from jsonb_to_recordset(coalesce(p_payload->'obligations','[]')) as q(obligation_key text,obligation_type text,adjusts_obligation_id uuid,adjustment_effect text,settleable_amount numeric,currency text,exchange_rate numeric,base_currency text,settleable_base_amount numeric) loop
insert into public.financial_event_obligations(organization_id,event_id,obligation_key,obligation_type,adjusts_obligation_id,adjustment_effect,settleable_amount,currency,exchange_rate,base_currency,settleable_base_amount,created_by)
values(org,eid,x.obligation_key,upper(x.obligation_type),x.adjusts_obligation_id,coalesce(upper(x.adjustment_effect),'INCREASE'),x.settleable_amount,upper(x.currency),x.exchange_rate,upper(x.base_currency),x.settleable_base_amount,auth.uid());end loop;
for x in select * from jsonb_to_recordset(coalesce(p_payload->'links','[]')) as q(link_type text,target_module text,target_record_id uuid,related_event_id uuid,metadata jsonb) loop
insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id,related_event_id,metadata,created_by) values(eid,org,upper(x.link_type),x.target_module,x.target_record_id,x.related_event_id,coalesce(x.metadata,'{}'),auth.uid());end loop;
insert into public.financial_event_command_registry(organization_id,command_type,source_module,source_event_key,payload_fingerprint,financial_event_id,canonical_payload,created_by) values(org,'EVENT_CREATE',module,skey,hash,eid,norm,auth.uid());
return eid;end$$;
create or replace function public.create_financial_event_command(p_payload jsonb) returns uuid language plpgsql security definer set search_path='pg_catalog','public','private' as $$begin if trim(p_payload->>'source_module')='VAT_INTEGRATION' then raise exception 'VAT_SOURCE_NAMESPACE_REQUIRES_ADAPTER';end if;return private.phase2c_create_financial_event_internal(p_payload);end$$;
grant execute on function public.create_financial_event_command(jsonb) to authenticated;
