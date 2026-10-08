create or replace function private.guard_linked_vat_note_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.document_kind not in('CREDIT_NOTE','DEBIT_NOTE') or not exists(select 1 from public.financial_vat_source_bindings where source_table='vat_documents' and source_record_id=old.id and organization_id=old.organization_id) then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_op='UPDATE' and (to_jsonb(new)-'zatca_status') is not distinct from (to_jsonb(old)-'zatca_status')
  and new.zatca_status in('ISSUED','CLEARED','REPORTED','SUBMITTED')
  and exists(select 1 from public.vat_einvoices where accounting_document_id=new.id and organization_id=new.organization_id and status=new.zatca_status) then return new; end if;
 raise exception 'VAT_NOTE_BOUND_SOURCE_IMMUTABLE';
end $$;
revoke all on function private.guard_linked_vat_note_source() from public,anon,authenticated;
create trigger guard_linked_vat_note_source before update or delete on public.vat_documents for each row execute function private.guard_linked_vat_note_source();

do $lifecycle$ declare definition text; begin
 definition:=pg_get_functiondef('public.issue_vat_einvoice(uuid)'::regprocedure);
 definition:=replace(definition, 'if i.document_type=''CREDIT_NOTE'' then', $branch$if d.document_type<>'SALES' or d.document_number<>i.invoice_number or d.counterparty_contact_id is distinct from i.buyer_contact_id
    or coalesce(d.source_currency,d.currency)<>i.currency or d.exchange_rate<>i.exchange_rate
    or d.transaction_date<>i.issue_date or coalesce(d.due_date,d.transaction_date)<>coalesce(i.due_date,i.issue_date)
    or coalesce(d.source_net_amount,d.net_amount)<>i.tax_exclusive_amount
    or coalesce(d.source_tax_amount,d.tax_amount)<>i.tax_total_amount
    or coalesce(d.source_gross_amount,d.gross_amount)<>i.payable_amount
    or d.notes is distinct from i.note_reason then raise exception 'EINVOICE_ACCOUNTING_SOURCE_MISMATCH'; end if;
   if exists(select 1 from public.vat_period_summaries where organization_id=d.organization_id and filing_status='FILED' and d.transaction_date between period_start and period_end) then raise exception 'VAT_NOTE_FILED_PERIOD_LOCKED'; end if;
   if i.document_type='CREDIT_NOTE' then$branch$);
 execute definition;
 definition:=pg_get_functiondef('public.delete_unissued_zatca_draft_bundle(uuid)'::regprocedure);
 definition:=replace(definition, 'if coalesce(v_notes,'''')=''Created from ZATCA invoice workspace'' then', 'if coalesce(v_notes,'''')=''Created from ZATCA invoice workspace'' or exists(select 1 from public.financial_vat_source_bindings b where b.event_id=v_event and b.organization_id=v_org and b.canonical_payload->>''adapter''=''LINKED_NOTE_V1'') then');
 execute definition;
end $lifecycle$;
