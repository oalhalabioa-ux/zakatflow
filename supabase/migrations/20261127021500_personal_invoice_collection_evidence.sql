-- Expose original verified COLLECT lots for invoice net-basis consumers.
create function public.read_personal_invoice_collection_lots_at_cutoff(p_document uuid, p_as_of date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  actor uuid:=auth.uid();
  invoice public.personal_income_documents;
  debt_line jsonb;
  gross_remaining numeric;
  source_lot_ids uuid[];
  receipt_rows jsonb;
  expected_count bigint;
  matched_count bigint;
  unique_outflows bigint;
  unique_receipts bigint;
  unique_bank_lots bigint;
  unique_transfers bigint;
  gross_sum numeric;
  subcent boolean;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  if p_as_of is null or not isfinite(p_as_of) or p_as_of>(now() at time zone 'Asia/Riyadh')::date then
    raise exception 'PERSONAL_CUTOFF_INVALID';
  end if;
  select * into invoice from public.personal_income_documents
    where id=p_document and owner_id=actor and receivable_id is not null;
  if not found then raise exception 'PERSONAL_INVOICE_HAWL_DOCUMENT_NOT_FOUND'; end if;
  if p_as_of<invoice.document_date then
    return jsonb_build_object('documentId',p_document,'asOf',p_as_of,
      'status','NOT_RECOGNIZED_AT_CUTOFF','rows','[]'::jsonb);
  end if;

  select value into debt_line
    from jsonb_array_elements(public.read_personal_debts_at_cutoff(p_as_of)->'rows')
    where value->>'id'=invoice.receivable_id::text;
  gross_remaining:=(debt_line->>'balance')::numeric;
  if gross_remaining is null or gross_remaining<0 or gross_remaining>invoice.gross_amount then
    return jsonb_build_object('documentId',p_document,'asOf',p_as_of,'status','RECEIVABLE_SOURCE_UNVERIFIED',
      'gap',debt_line->>'gap','rows','[]'::jsonb);
  end if;

  select array_agg(l.id) into source_lot_ids
  from public.lots l
  join public.transactions t on t.id=l.source_transaction_id and t.asset_account_id=l.asset_account_id
  where l.asset_account_id=invoice.receivable_id and l.user_id=actor and l.organization_id is null
    and t.user_id=actor and t.organization_id is null and t.transaction_type='ADD' and t.transaction_date=invoice.document_date
    and t.metadata->>'personal_income_document_id'=invoice.id::text
    and l.acquisition_date=invoice.document_date and l.original_quantity=invoice.gross_amount
    and l.original_value_base=invoice.gross_amount;

  with collections as materialized (
    select t.id,t.transfer_id,t.transaction_date,t.created_at,t.quantity,t.base_value,
      t.metadata->'cash_transfer_result'->>'in_transaction_id' receipt_id
    from public.transactions t
    where t.user_id=actor and t.organization_id is null and t.asset_account_id=invoice.receivable_id
      and t.transaction_type='TRANSFER_OUT' and t.transaction_date<=p_as_of
  ), verified as (
    select c.*,receipt.id in_id,receipt.asset_account_id bank_account_id,a.lot_id receivable_lot_id,l.id bank_lot_id
    from collections c
    join public.transactions receipt on receipt.id::text=c.receipt_id and receipt.transfer_id=c.transfer_id
      and receipt.user_id=actor and receipt.organization_id is null and receipt.transaction_type='TRANSFER_IN'
    join public.transaction_allocations a on a.transaction_id=c.id and a.user_id=actor
      and cardinality(source_lot_ids)=1 and a.lot_id=source_lot_ids[1]
      and a.allocation_method='FIFO' and a.quantity=c.quantity and a.value_base=c.base_value
    join public.lots l on l.source_transaction_id=receipt.id and l.asset_account_id=receipt.asset_account_id
      and l.user_id=actor and l.organization_id is null and l.hawl_continuity_source_lot_id=a.lot_id
      and l.acquisition_date=c.transaction_date and l.original_quantity=a.quantity and l.original_value_base=a.value_base
      and l.metadata->>'source'='internal_transfer' and l.metadata->>'transfer_id'=c.transfer_id::text
      and l.metadata->>'source_lot_id'=a.lot_id::text
    where not exists (
      select 1 from public.transaction_allocations extra
      where extra.transaction_id=c.id and extra.id<>a.id
    ) and not exists (
      select 1 from public.lots extra where extra.source_transaction_id=receipt.id and extra.id<>l.id
    )
  ), cumulative as (
    select v.*,sum(base_value) over(order by transaction_date,created_at,id rows unbounded preceding) gross_to_date
    from verified v
  ), allocated as (
    select c.*,round(invoice.net_amount*gross_to_date/invoice.gross_amount,2)
      -round(invoice.net_amount*(gross_to_date-base_value)/invoice.gross_amount,2) net_amount
    from cumulative c
  )
  select (select count(*) from collections),count(*),count(distinct id),count(distinct in_id),
    count(distinct bank_lot_id),count(distinct transfer_id),coalesce(sum(base_value),0),
    coalesce(bool_or(base_value<>round(base_value,2)),false),
    coalesce(jsonb_agg(jsonb_build_object(
      'transferId',transfer_id,'outTransactionId',id,'inTransactionId',in_id,
      'sourceReceivableLotId',receivable_lot_id,'bankLotId',bank_lot_id,'bankAccountId',bank_account_id,
      'collectedOn',transaction_date,'grossCollected',base_value,'netCollected',net_amount,'taxCollected',base_value-net_amount
    ) order by transaction_date,created_at,id),'[]'::jsonb)
    into expected_count,matched_count,unique_outflows,unique_receipts,unique_bank_lots,unique_transfers,gross_sum,subcent,receipt_rows
    from allocated;

  if expected_count<>matched_count or expected_count<>unique_outflows or expected_count<>unique_receipts
     or expected_count<>unique_bank_lots or expected_count<>unique_transfers
     or gross_sum<>invoice.gross_amount-gross_remaining then
    return jsonb_build_object('documentId',p_document,'asOf',p_as_of,
      'status','COLLECTION_LOT_SOURCE_UNVERIFIED','rows','[]'::jsonb);
  end if;
  if subcent then
    return jsonb_build_object('documentId',p_document,'asOf',p_as_of,
      'status','COLLECTION_PRECISION_UNSUPPORTED','rows','[]'::jsonb);
  end if;

  return jsonb_build_object('documentId',p_document,'receivableId',invoice.receivable_id,
    'asOf',p_as_of,'status','VERIFIED','currency',debt_line->>'currency',
    'grossRemaining',gross_remaining,'netCollected',round(invoice.net_amount*gross_sum/invoice.gross_amount,2),
    'rows',receipt_rows);
end
$$;
revoke all on function public.read_personal_invoice_collection_lots_at_cutoff(uuid,date) from public,anon;
grant execute on function public.read_personal_invoice_collection_lots_at_cutoff(uuid,date) to authenticated;
