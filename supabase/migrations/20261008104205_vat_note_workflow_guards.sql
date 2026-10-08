-- Keep bound source financial evidence immutable while allowing an issued note's
-- lifecycle status to mirror its linked electronic invoice.
do $guards$ declare definition text; begin
 if to_regprocedure('private.phase2c_source_immutable()') is not null then
  definition:=pg_get_functiondef('private.phase2c_source_immutable()'::regprocedure);
  definition:=replace(definition,'if bound then', $branch$if bound and tg_table_name='vat_documents' and tg_op='UPDATE' then
   if (to_jsonb(new)-array['zatca_status']) is not distinct from (to_jsonb(old)-array['zatca_status'])
    and new.zatca_status in('ISSUED','CLEARED','REPORTED','SUBMITTED')
    and exists(select 1 from public.vat_einvoices i where i.accounting_document_id=new.id and i.organization_id=new.organization_id and i.status=new.zatca_status) then return new; end if;
  end if;
  if bound then$branch$);
  execute definition;
 end if;
 if to_regprocedure('private.phase2c_evidence_immutable()') is not null then
  definition:=pg_get_functiondef('private.phase2c_evidence_immutable()'::regprocedure);
  definition:=replace(definition,'eid:=case when', $branch$if tg_table_name='financial_event_obligations' and tg_op='INSERT' and pg_trigger_depth()>1 then
   if new.obligation_key='note-refund' and new.adjusts_obligation_id is null
    and exists(select 1 from public.financial_vat_source_bindings b join public.financial_events e on e.id=b.event_id and e.organization_id=b.organization_id join public.vat_documents d on d.id=b.source_record_id and d.organization_id=b.organization_id
     where e.id=new.event_id and e.organization_id=new.organization_id and e.status='ACTUAL' and e.source_module='VAT_INTEGRATION' and b.document_kind='CREDIT_NOTE'
     and new.obligation_type=case when d.document_type='SALES' then 'PAYABLE' else 'RECEIVABLE' end) then return new; end if;
  end if;
  eid:=case when$branch$);
  execute definition;
 end if;
end $guards$;

-- Validate monetary identity at the RPC boundary and prevent edits to submitted periods.
create or replace function private.validate_vat_note_document()
returns trigger language plpgsql security definer set search_path='' as $$
declare original public.vat_documents%rowtype;
begin
 if new.document_kind not in('CREDIT_NOTE','DEBIT_NOTE') then return new; end if;
 if new.net_amount<=0 or new.tax_amount<0 or new.gross_amount<>new.net_amount+new.tax_amount
  or new.source_gross_amount<>new.source_net_amount+new.source_tax_amount
  or new.net_amount<>round(new.source_net_amount*new.exchange_rate,2)
  or new.tax_amount<>round(new.source_tax_amount*new.exchange_rate,2)
  or new.source_net_amount is null or new.source_tax_amount is null or new.exchange_rate<=0 then raise exception 'VAT_NOTE_AMOUNT_INVALID'; end if;
 select * into original from public.vat_documents where id=new.preceding_document_id and organization_id=new.organization_id;
 if original.id is null then raise exception 'VAT_NOTE_REFERENCE_AND_REASON_REQUIRED'; end if;
 if new.document_type='PURCHASE' and new.recoverable_percent is distinct from original.recoverable_percent then raise exception 'VAT_NOTE_RECOVERY_MUST_MATCH_ORIGINAL'; end if;
 if exists(select 1 from public.vat_period_summaries where organization_id=new.organization_id and filing_status='FILED' and new.transaction_date between period_start and period_end) then raise exception 'VAT_NOTE_FILED_PERIOD_LOCKED'; end if;
 return new;
end $$;
revoke all on function private.validate_vat_note_document() from public,anon,authenticated;
create trigger validate_vat_note_document before insert on public.vat_documents for each row execute function private.validate_vat_note_document();
