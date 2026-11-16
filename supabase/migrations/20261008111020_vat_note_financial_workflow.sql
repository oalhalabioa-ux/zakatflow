-- Notes are separate recognition adjustments; cash refunds remain separate settlements.
create or replace function public.prepare_vat_note_financial_event(p_document_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare d public.vat_documents%rowtype; original public.vat_documents%rowtype;
 root public.financial_events%rowtype; ob public.financial_event_obligations%rowtype;
 eid uuid; cls uuid; taxcls uuid; existing uuid; payload jsonb; obligations jsonb;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 select * into d from public.vat_documents where id=p_document_id for update;
 if d.id is null then raise exception 'VAT_SOURCE_NOT_FOUND'; end if;
 if not public.is_organization_admin(d.organization_id) or not public.financial_core_can(d.organization_id,'financial_core.create') then raise exception 'VAT_FINANCIAL_PREPARE_DENIED'; end if;
 if d.document_kind not in ('CREDIT_NOTE','DEBIT_NOTE') or d.preceding_document_id is null or nullif(trim(d.notes),'') is null then raise exception 'VAT_NOTE_REFERENCE_AND_REASON_REQUIRED'; end if;
 select * into original from public.vat_documents where id=d.preceding_document_id and organization_id=d.organization_id for update;
 if original.id is null or original.document_kind<>'INVOICE' or original.document_type<>d.document_type or original.counterparty_contact_id is distinct from d.counterparty_contact_id
  or original.currency<>d.currency or coalesce(original.source_currency,original.currency)<>coalesce(d.source_currency,d.currency) or original.exchange_rate<>d.exchange_rate then raise exception 'VAT_NOTE_ORIGINAL_IDENTITY_OR_CURRENCY_MISMATCH'; end if;
 if d.transaction_date<original.transaction_date then raise exception 'VAT_NOTE_DATE_BEFORE_ORIGINAL'; end if;
 select e.* into root from public.financial_event_links l join public.financial_events e on e.id=l.event_id and e.organization_id=l.organization_id
 where l.organization_id=d.organization_id and l.link_type='SOURCE' and l.target_module='vat_documents' and l.target_record_id=original.id;
 if root.id is null or root.status in ('CANCELLED','REVERSED') then raise exception 'VAT_ORIGINAL_FINANCIAL_EVENT_REQUIRED'; end if;
 select event_id into existing from public.financial_vat_source_bindings where organization_id=d.organization_id and source_table='vat_documents' and source_record_id=d.id;
 if existing is not null then return existing; end if;
 select * into ob from public.financial_event_obligations where organization_id=d.organization_id and event_id=root.id and adjusts_obligation_id is null and obligation_type=case when d.document_type='SALES' then 'RECEIVABLE' else 'PAYABLE' end for update;
 if ob.id is null then raise exception 'VAT_ORIGINAL_OBLIGATION_REQUIRED'; end if;
 select l.classification_id into cls from public.financial_event_lines l join public.financial_classifications c on c.id=l.classification_id
 where l.event_id=root.id and c.classification_type<>'TAX' order by l.line_number limit 1;
 select l.classification_id into taxcls from public.financial_event_lines l join public.financial_classifications c on c.id=l.classification_id
 where l.event_id=root.id and c.classification_type='TAX' order by l.line_number limit 1;
 if taxcls is null then select id into taxcls from public.financial_classifications where organization_id=d.organization_id and classification_type='TAX' and active order by is_system desc limit 1; end if;
 if cls is null or (d.tax_amount>0 and taxcls is null) then raise exception 'VAT_FINANCIAL_CLASSIFICATIONS_REQUIRED'; end if;
 obligations:=case when d.document_kind='CREDIT_NOTE' then jsonb_build_array(jsonb_build_object('obligation_key','note-adjustment','obligation_type',ob.obligation_type,'adjusts_obligation_id',ob.id,'adjustment_effect','DECREASE','settleable_amount',d.gross_amount,'currency',d.currency,'exchange_rate',1,'base_currency',d.currency,'settleable_base_amount',d.gross_amount))
 else jsonb_build_array(jsonb_build_object('obligation_key','note-gross','obligation_type',ob.obligation_type,'settleable_amount',d.gross_amount,'currency',d.currency,'exchange_rate',1,'base_currency',d.currency,'settleable_base_amount',d.gross_amount)) end;
 payload:=jsonb_build_object('organization_id',d.organization_id,'entity_id',root.entity_id,'counterparty_id',root.counterparty_id,'event_type','ADJUSTMENT','source_module','VAT_INTEGRATION','source_record_id',d.id,'source_event_key','vat_documents:'||d.id,'event_date',d.transaction_date,'due_date',coalesce(d.due_date,d.transaction_date),'base_currency',d.currency,'description',d.document_kind||' '||d.document_number||' / '||original.document_number,
 'lines',jsonb_build_array(jsonb_build_object('line_number',1,'classification_id',cls,'amount',d.net_amount,'currency',d.currency,'exchange_rate',1,'base_amount',d.net_amount,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0,'metadata',jsonb_build_object('source_role','NET_RECOGNITION','recognition_sign',case when d.document_kind='CREDIT_NOTE' then -1 else 1 end))) ||
 case when d.tax_amount>0 then jsonb_build_array(jsonb_build_object('line_number',2,'classification_id',taxcls,'amount',d.tax_amount,'currency',d.currency,'exchange_rate',1,'base_amount',d.tax_amount,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0,'metadata',jsonb_build_object('source_role',case when d.document_type='SALES' then 'OUTPUT_VAT' else 'INPUT_VAT' end,'recognition_sign',case when d.document_kind='CREDIT_NOTE' then -1 else 1 end,'recoverable_percent',d.recoverable_percent))) else '[]'::jsonb end,
 'obligations',obligations,'links',jsonb_build_array(jsonb_build_object('link_type','SOURCE','target_module','vat_documents','target_record_id',d.id),jsonb_build_object('link_type','CORRECTS','related_event_id',root.id,'metadata',jsonb_build_object('original_document_id',original.id,'reason',d.notes))));
 eid:=private.phase2c_create_financial_event_internal(payload);
 perform public.transition_financial_event(eid,'PLANNED','VAT note prepared');
 perform public.transition_financial_event(eid,'COMMITTED','VAT note pending financial approval');
 insert into public.financial_vat_source_bindings(organization_id,source_table,source_record_id,event_id,canonical_payload,payload_fingerprint,document_kind,side,contact_id,entity_id,due_date,original_event_id,is_alias,created_by)
 values(d.organization_id,'vat_documents',d.id,eid,private.canonical_financial_json(to_jsonb(d)),encode(extensions.digest(convert_to(d.id::text||'|'||eid::text,'UTF8'),'sha256'),'hex'),d.document_kind,d.document_type,d.counterparty_contact_id,root.entity_id,coalesce(d.due_date,d.transaction_date),root.id,false,auth.uid());
 return eid;
end $$;
revoke all on function public.prepare_vat_note_financial_event(uuid) from public,anon;
grant execute on function public.prepare_vat_note_financial_event(uuid) to authenticated;

-- Only zero-value, fully closed invoice projections may remain after a credit note.
alter table public.liquidity_flows drop constraint if exists liquidity_flows_amount_check;
alter table public.liquidity_flows add constraint liquidity_flows_amount_check check(amount>0 or (amount=0 and source_module='VAT_INTEGRATION' and settlement_status='SETTLED'));
alter table public.liquidity_flows drop constraint if exists liquidity_flows_base_amount_check;
alter table public.liquidity_flows add constraint liquidity_flows_base_amount_check check(base_amount>0 or (base_amount=0 and source_module='VAT_INTEGRATION' and settlement_status='SETTLED'));

-- Production's recovered balance view lacked obligation adjustments. Preserve the
-- richer QA view where already present; add the same adjustment/advance model only where absent.
do $upgrade$ begin
 if position('adjustment_effect' in pg_get_viewdef('public.financial_event_obligation_balances'::regclass))=0 then
 execute $view$ create or replace view public.financial_event_obligation_balances with(security_invoker=true) as
 with roots as(select o.*,coalesce((select sum(case a.adjustment_effect when 'DECREASE' then -a.settleable_base_amount else a.settleable_base_amount end) from public.financial_event_obligations a join public.financial_events e on e.id=a.event_id and e.organization_id=a.organization_id where a.adjusts_obligation_id=o.id and a.organization_id=o.organization_id and e.status='ACTUAL'),0) adjustment from public.financial_event_obligations o join public.financial_events e on e.id=o.event_id and e.organization_id=o.organization_id where e.status='ACTUAL' and o.adjusts_obligation_id is null),
 sums as(select a.organization_id,a.obligation_id,sum(a.base_amount) amount from public.financial_event_obligation_allocations a join public.financial_events e on e.id=a.application_event_id and e.organization_id=a.organization_id where e.status='ACTUAL' group by a.organization_id,a.obligation_id),
 advances as(select a.organization_id,a.source_advance_obligation_id id,sum(a.base_amount) amount from public.financial_event_obligation_allocations a join public.financial_events e on e.id=a.application_event_id and e.organization_id=a.organization_id where e.status='ACTUAL' and a.source_advance_obligation_id is not null group by a.organization_id,a.source_advance_obligation_id)
 select r.id obligation_id,r.organization_id,r.event_id,r.obligation_key,r.obligation_type,r.settleable_amount,r.currency,r.exchange_rate,r.base_currency,(r.settleable_base_amount+r.adjustment)::numeric(24,4) adjusted_settleable_base_amount,coalesce(s.amount,0)::numeric(24,4) applied_base_amount,coalesce(a.amount,0)::numeric(24,4) consumed_advance_base_amount,greatest(r.settleable_base_amount+r.adjustment-case when r.obligation_type in('RECEIVABLE','PAYABLE') then coalesce(s.amount,0) else coalesce(a.amount,0) end,0)::numeric(24,4) outstanding_base_amount from roots r left join sums s on s.organization_id=r.organization_id and s.obligation_id=r.id left join advances a on a.organization_id=r.organization_id and a.id=r.id $view$;
 end if;
end $upgrade$;

create or replace function private.apply_vat_note_effects()
returns trigger language plpgsql security definer set search_path='' as $$
declare d public.vat_documents%rowtype; original public.vat_documents%rowtype; root uuid; ob public.financial_event_obligations%rowtype; remaining numeric; previous_due numeric; credit_total numeric; refund numeric; f public.liquidity_flows%rowtype; amount_due numeric; direction text;
begin
 if old.status='ACTUAL' and new.status='REVERSED' and exists(select 1 from public.financial_vat_source_bindings where event_id=new.id and document_kind in('CREDIT_NOTE','DEBIT_NOTE')) then raise exception 'VAT_NOTE_REVERSAL_REQUIRES_LINKED_CORRECTION'; end if;
 if new.status<>'ACTUAL' or old.status='ACTUAL' then return new; end if;
 select * into d from public.vat_documents where id=new.source_record_id and organization_id=new.organization_id and document_kind in('CREDIT_NOTE','DEBIT_NOTE');
 if d.id is null or not exists(select 1 from public.financial_vat_source_bindings where event_id=new.id and source_record_id=d.id) then return new; end if;
 if d.document_type='SALES' and d.zatca_status not in('ISSUED','CLEARED','REPORTED','SUBMITTED') then raise exception 'VAT_NOTE_MUST_BE_ISSUED'; end if;
 select * into original from public.vat_documents where id=d.preceding_document_id and organization_id=d.organization_id for update;
 select event_id into root from public.financial_vat_source_bindings where source_table='vat_documents' and source_record_id=original.id and organization_id=d.organization_id;
 if root is null then select event_id into root from public.financial_event_links where target_module='vat_documents' and target_record_id=original.id and link_type='SOURCE' and organization_id=d.organization_id; end if;
 perform 1 from public.financial_events where id=root and organization_id=d.organization_id and status='ACTUAL' for update;
 if not found then raise exception 'VAT_ORIGINAL_RECOGNITION_REQUIRED'; end if;
 select * into ob from public.financial_event_obligations where event_id=root and organization_id=d.organization_id and adjusts_obligation_id is null and obligation_type in('RECEIVABLE','PAYABLE') for update;
 if d.document_kind='CREDIT_NOTE' then
  select coalesce(sum(a.settleable_base_amount),0) into credit_total from public.financial_event_obligations a join public.financial_events ae on ae.id=a.event_id and ae.organization_id=a.organization_id where a.adjusts_obligation_id=ob.id and a.adjustment_effect='DECREASE' and ae.status='ACTUAL';
  if credit_total>original.gross_amount or exists(select 1 from public.vat_documents n join public.financial_vat_source_bindings b on b.source_record_id=n.id and b.organization_id=n.organization_id join public.financial_events e on e.id=b.event_id where n.preceding_document_id=original.id and e.status='ACTUAL' and n.document_kind='CREDIT_NOTE' group by n.preceding_document_id having sum(n.net_amount)>original.net_amount or sum(n.tax_amount)>original.tax_amount) then raise exception 'VAT_CREDIT_EXCEEDS_ORIGINAL'; end if;
  select outstanding_base_amount,adjusted_settleable_base_amount into remaining,amount_due from public.financial_event_obligation_balances where obligation_id=ob.id;
  select coalesce(sum(a.base_amount),0) into previous_due from public.financial_event_obligation_allocations a join public.financial_events e on e.id=a.application_event_id and e.organization_id=a.organization_id where a.obligation_id=ob.id and e.status='ACTUAL';
  refund:=greatest(previous_due-amount_due,0);
  -- Only the incremental excess for this note is refunded.
  refund:=least(d.gross_amount,greatest(0,refund-coalesce((select sum(o.settleable_base_amount) from public.financial_event_obligations o join public.financial_events e on e.id=o.event_id and e.organization_id=o.organization_id join public.vat_documents n on n.id=e.source_record_id where n.preceding_document_id=original.id and o.obligation_key='note-refund' and e.status='ACTUAL' and e.id<>new.id),0)));
  select * into f from public.liquidity_flows where organization_id=d.organization_id and source_module='VAT_INTEGRATION' and source_record_id=original.id for update;
  if f.id is not null then update public.liquidity_flows set amount=settled_amount+coalesce(remaining,0),base_amount=settled_amount+coalesce(remaining,0),settlement_status=case when coalesce(remaining,0)=0 then 'SETTLED' when settled_amount>0 then 'PARTIAL' else 'UNSETTLED' end,updated_at=now() where id=f.id; end if;
  if refund>0 then
   insert into public.financial_event_obligations(organization_id,event_id,obligation_key,obligation_type,settleable_amount,currency,exchange_rate,base_currency,settleable_base_amount,created_by)
   values(d.organization_id,new.id,'note-refund',case when d.document_type='SALES' then 'PAYABLE' else 'RECEIVABLE' end,refund,d.currency,1,d.currency,refund,auth.uid());
  end if;
  amount_due:=refund; direction:=case when d.document_type='SALES' then 'OUTFLOW' else 'INFLOW' end;
 else amount_due:=d.gross_amount; direction:=case when d.document_type='SALES' then 'INFLOW' else 'OUTFLOW' end;
 end if;
 if amount_due>0 then
  insert into public.liquidity_flows(organization_id,direction,flow_type,title,counterparty,counterparty_id,due_date,amount,currency,base_amount,status,source,reference,notes,source_module,source_record_id,source_event_key)
  values(d.organization_id,direction,'OPERATING',d.document_kind||' · '||d.document_number,d.counterparty_name,new.counterparty_id,coalesce(d.due_date,d.transaction_date),amount_due,d.currency,amount_due,'EXPECTED','INVOICE',d.document_number,'Note recognition only; bank changes require a separate approved settlement.','VAT_INTEGRATION',d.id,'vat_documents:'||d.id||':cash-forecast') returning * into f;
  insert into public.financial_event_links(organization_id,event_id,link_type,target_module,target_record_id,metadata,created_by) values(d.organization_id,new.id,'CASH_FLOW','liquidity_flows',f.id,jsonb_build_object('purpose','VAT_NOTE_SETTLEMENT'),auth.uid());
 end if;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(auth.uid(),'vat_document',d.id,'NOTE_EFFECT_POSTED',jsonb_build_object('original_id',original.id,'kind',d.document_kind,'gross',d.gross_amount,'refund_due',case when d.document_kind='CREDIT_NOTE' then amount_due else 0 end,'bank_effect','NONE'));
 return new;
end $$;
revoke all on function private.apply_vat_note_effects() from public,anon,authenticated;
create trigger apply_vat_note_effects after update of status on public.financial_events for each row execute function private.apply_vat_note_effects();

create or replace function public.create_vat_note_document(p_values jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.vat_documents%rowtype; eid uuid;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 d:=jsonb_populate_record(null::public.vat_documents,p_values);
 if d.document_kind not in('CREDIT_NOTE','DEBIT_NOTE') or not public.is_organization_admin(d.organization_id) then raise exception 'INVALID_VAT_NOTE'; end if;
 insert into public.vat_documents(organization_id,user_id,created_by,document_type,document_kind,document_number,transaction_date,due_date,counterparty_contact_id,counterparty_name,counterparty_tax_number,supply_type,net_amount,tax_rate,tax_amount,recoverable_percent,gross_amount,line_items,currency,source_currency,exchange_rate,source_net_amount,source_tax_amount,source_gross_amount,notes,preceding_document_id,zatca_status)
 values(d.organization_id,auth.uid(),auth.uid(),d.document_type,d.document_kind,d.document_number,d.transaction_date,d.due_date,d.counterparty_contact_id,d.counterparty_name,d.counterparty_tax_number,d.supply_type,d.net_amount,d.tax_rate,d.tax_amount,d.recoverable_percent,d.gross_amount,d.line_items,d.currency,d.source_currency,d.exchange_rate,d.source_net_amount,d.source_tax_amount,d.source_gross_amount,d.notes,d.preceding_document_id,case when d.document_type='SALES' then 'DRAFT' else 'NOT_ISSUED' end) returning * into d;
 if d.net_amount<=0 or d.gross_amount<=0 then raise exception 'VAT_NOTE_AMOUNT_INVALID'; end if;
 eid:=public.prepare_vat_note_financial_event(d.id);
 return to_jsonb(d)||jsonb_build_object('financial_core',jsonb_build_object('event_id',eid,'status','COMMITTED','recognition','PENDING_APPROVAL'));
end $$;
revoke all on function public.create_vat_note_document(jsonb) from public,anon;
grant execute on function public.create_vat_note_document(jsonb) to authenticated;

create or replace function public.issue_vat_einvoice(p_invoice_id uuid)
returns public.vat_einvoices language plpgsql security definer set search_path='' as $$
declare i public.vat_einvoices%rowtype; original public.vat_einvoices%rowtype; d public.vat_documents%rowtype;
 payload bytea:=''::bytea; fields text[]; bytes bytea; n int; credit_net numeric; credit_tax numeric; credit_gross numeric;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 select * into i from public.vat_einvoices where id=p_invoice_id for update;
 if i.id is null then raise exception 'EINVOICE_NOT_FOUND'; end if;
 if not public.has_organization_permission(i.organization_id,'vat.issue') then raise exception 'VAT_ISSUE_FORBIDDEN'; end if;
 if i.status<>'DRAFT' then raise exception 'EINVOICE_NOT_DRAFT'; end if;
 if i.document_type<>'INVOICE' then
  select * into original from public.vat_einvoices where id=i.preceding_invoice_id and organization_id=i.organization_id for update;
  if original.id is null or original.document_type<>'INVOICE' or original.status not in('ISSUED','CLEARED','REPORTED','SUBMITTED') then raise exception 'PRECEDING_INVOICE_NOT_ISSUED'; end if;
  if original.invoice_category<>i.invoice_category or original.buyer_contact_id is distinct from i.buyer_contact_id or original.currency<>i.currency or original.exchange_rate<>i.exchange_rate then raise exception 'VAT_NOTE_ORIGINAL_IDENTITY_OR_CURRENCY_MISMATCH'; end if;
  if nullif(trim(i.note_reason),'') is null or i.billing_reference is distinct from original.invoice_number or i.issue_date<original.issue_date then raise exception 'VAT_NOTE_REFERENCE_AND_REASON_REQUIRED'; end if;
  select * into d from public.vat_documents where id=i.accounting_document_id and organization_id=i.organization_id for update;
  if d.id is null or d.document_kind<>i.document_type or d.preceding_document_id is distinct from original.accounting_document_id or not exists(select 1 from public.financial_vat_source_bindings where organization_id=i.organization_id and source_record_id=d.id and document_kind=i.document_type) then raise exception 'VAT_NOTE_FINANCIAL_SOURCE_REQUIRED'; end if;
  if i.document_type='CREDIT_NOTE' then
   select coalesce(sum(tax_exclusive_amount),0)+i.tax_exclusive_amount,coalesce(sum(tax_total_amount),0)+i.tax_total_amount,coalesce(sum(payable_amount),0)+i.payable_amount into credit_net,credit_tax,credit_gross from public.vat_einvoices where organization_id=i.organization_id and preceding_invoice_id=original.id and document_type='CREDIT_NOTE' and status in('ISSUED','CLEARED','REPORTED','SUBMITTED');
   if credit_net>original.tax_exclusive_amount or credit_tax>original.tax_total_amount or credit_gross>original.payable_amount then raise exception 'VAT_CREDIT_EXCEEDS_ORIGINAL'; end if;
  end if;
 end if;
 fields:=array[i.seller_name,i.seller_vat_number,to_char(i.issue_date,'YYYY-MM-DD')||'T'||to_char(i.issue_time,'HH24:MI:SS')||'+03:00',to_char(i.tax_inclusive_amount,'FM99999999999999999990.00'),to_char(i.tax_total_amount,'FM99999999999999999990.00')];
 for n in 1..array_length(fields,1) loop bytes:=convert_to(fields[n],'UTF8'); if octet_length(bytes)>255 then raise exception 'QR_FIELD_TOO_LONG'; end if; payload:=payload||decode(lpad(to_hex(n),2,'0'),'hex')||decode(lpad(to_hex(octet_length(bytes)),2,'0'),'hex')||bytes; end loop;
 if length(translate(encode(payload,'base64'),E'\n\r',''))>700 then raise exception 'QR_PAYLOAD_TOO_LONG'; end if;
 update public.vat_einvoices set status='ISSUED',qr_code=translate(encode(payload,'base64'),E'\n\r',''),issued_at=now(),updated_at=now() where id=i.id returning * into i;
 update public.vat_documents set zatca_status='ISSUED' where id=i.accounting_document_id and organization_id=i.organization_id;
 return i;
end $$;
revoke all on function public.issue_vat_einvoice(uuid) from public,anon;
grant execute on function public.issue_vat_einvoice(uuid) to authenticated;

-- Preserve the existing reporting view and teach recovered Production to read signed note lines.
do $signed$ declare definition text; begin
 definition:=pg_get_viewdef('public.financial_budget_operational_facts'::regclass,true);
 if position('1 AS sign' in definition)>0 then
  definition:=replace(definition,'1 AS sign', 'CASE WHEN l.metadata->>''recognition_sign''=''-1'' THEN -1 ELSE 1 END AS sign');
  definition:=replace(definition,'l.base_amount AS budget_base_amount','(l.base_amount * CASE WHEN l.metadata->>''recognition_sign''=''-1'' THEN -1 ELSE 1 END)::numeric(24,4) AS budget_base_amount');
  definition:=replace(definition,'THEN l.base_amount','THEN l.base_amount * CASE WHEN l.metadata->>''recognition_sign''=''-1'' THEN -1 ELSE 1 END');
  execute 'create or replace view public.financial_budget_operational_facts with(security_invoker=true) as '||definition;
 end if;
end $signed$;
