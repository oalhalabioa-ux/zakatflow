-- Notes are separate recognition adjustments; cash refunds remain separate settlements.
create or replace function public.prepare_vat_note_financial_event(p_document_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare d public.vat_documents%rowtype; original public.vat_documents%rowtype;
 root public.financial_events%rowtype; ob public.financial_event_obligations%rowtype;
 eid uuid; cls uuid; taxcls uuid; existing uuid; payload jsonb; obligations jsonb; canonical jsonb;
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
 canonical:=private.canonical_financial_json(jsonb_build_object('adapter','LINKED_NOTE_V1','document',to_jsonb(d)-'zatca_status'));
 insert into public.financial_vat_source_bindings(organization_id,source_table,source_record_id,event_id,canonical_payload,payload_fingerprint,document_kind,side,contact_id,entity_id,due_date,original_event_id,is_alias,created_by)
 values(d.organization_id,'vat_documents',d.id,eid,canonical,encode(extensions.digest(convert_to(canonical::text,'UTF8'),'sha256'),'hex'),d.document_kind,d.document_type,d.counterparty_contact_id,root.entity_id,coalesce(d.due_date,d.transaction_date),root.id,false,auth.uid());
 return eid;
end $$;
revoke all on function public.prepare_vat_note_financial_event(uuid) from public,anon;
grant execute on function public.prepare_vat_note_financial_event(uuid) to authenticated;

create or replace function private.apply_vat_note_effects()
returns trigger language plpgsql security definer set search_path='' as $$
declare d public.vat_documents%rowtype; original public.vat_documents%rowtype; root uuid; ob public.financial_event_obligations%rowtype; remaining numeric; previous_due numeric; credit_total numeric; refund numeric; f public.liquidity_flows%rowtype; amount_due numeric; direction text;
begin
 if old.status='ACTUAL' and new.status='REVERSED' and exists(select 1 from public.financial_vat_source_bindings where event_id=new.id and document_kind in('CREDIT_NOTE','DEBIT_NOTE')) then raise exception 'VAT_NOTE_REVERSAL_REQUIRES_LINKED_CORRECTION'; end if;
 if new.status<>'ACTUAL' or old.status='ACTUAL' then return new; end if;
 select * into d from public.vat_documents where id=new.source_record_id and organization_id=new.organization_id and document_kind in('CREDIT_NOTE','DEBIT_NOTE');
 if d.id is null or not exists(select 1 from public.financial_vat_source_bindings where event_id=new.id and source_record_id=d.id) then return new; end if;
 if not exists(select 1 from public.financial_vat_source_bindings b where b.event_id=new.id and b.payload_fingerprint=encode(extensions.digest(convert_to(private.canonical_financial_json(jsonb_build_object('adapter','LINKED_NOTE_V1','document',to_jsonb(d)-'zatca_status'))::text,'UTF8'),'sha256'),'hex')) then raise exception 'VAT_NOTE_FINANCIAL_SOURCE_CHANGED'; end if;
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

-- QA's legacy VAT adapter validates its own fingerprint shape. Notes use the
-- dedicated signed-line adapter, whose AFTER trigger verifies its own fingerprint.
do $guard$ declare definition text; begin
 if to_regprocedure('private.phase2c_post_guard()') is not null then
  definition:=pg_get_functiondef('private.phase2c_post_guard()'::regprocedure);
  definition:=replace(definition,'for b in select *', $branch$if b.canonical_payload->>'adapter'='LINKED_NOTE_V1' then
   if exists(select 1 from public.financial_event_lines l where l.event_id=new.id and l.cash_direction<>'NON_CASH') then raise exception 'VAT_RECOGNITION_CANNOT_MOVE_CASH'; end if;
   return new;
  end if;
  for b in select *$branch$);
  execute definition;
 end if;
end $guard$;
