-- Depends on the V2 reporting contracts and personal income documents.
-- Keep pre-existing debt coverage and admit only verified document-origin receivables.
create or replace function public.read_personal_debts_at_cutoff(p_as_of date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
 if actor is null then raise exception 'UNAUTHORIZED'; end if;
 if p_as_of is null or p_as_of>(now() at time zone 'Asia/Riyadh')::date then
  raise exception 'PERSONAL_CUTOFF_INVALID';
 end if;
 with payable as (
  select d.id,d.event_date,d.currency,d.amount,
    case when exists(select 1 from public.personal_financings f where f.user_id=actor and f.payable_id=d.id)
       or exists(select 1 from public.personal_contract_movements m where m.user_id=actor and m.payable_id=d.id)
       then 'SPECIALIZED_CONTRACT_SOURCE'
     when exists(select 1 from public.audit_logs a where a.user_id=actor and a.entity_id=d.id and a.entity_type='personal_payable'
        and a.action='EDIT' and (a.created_at at time zone 'Asia/Riyadh')::date>p_as_of) then 'POST_CUTOFF_AMENDMENT'
     when exists(select 1 from public.personal_payable_payments p
        left join public.transactions t on t.id=p.transaction_id and t.user_id=actor and t.organization_id is null
        where p.user_id=actor and p.payable_id=d.id and p.payment_date<=p_as_of
          and (t.id is null or t.transaction_type<>'WITHDRAWAL' or t.transaction_date<>p.payment_date
          or t.base_currency<>d.currency or t.base_value<>p.amount
          or coalesce(t.metadata->>'asset_deleted','false')='true')) then 'PAYMENT_SOURCE_UNVERIFIED'
     else null end gap,
    coalesce((select sum(p.amount) from public.personal_payable_payments p
     where p.user_id=actor and p.payable_id=d.id and p.payment_date<=p_as_of
       and not exists(select 1 from public.transactions r where r.user_id=actor and r.organization_id is null
         and r.reversal_of_transaction_id=p.transaction_id and r.transaction_type='REVERSAL' and r.transaction_date<=p_as_of)),0) cleared
  from public.personal_payables d where d.user_id=actor
    and (d.cancelled_at is null or (d.cancelled_at at time zone 'Asia/Riyadh')::date>p_as_of)
    and (d.event_date<=p_as_of or exists(select 1 from public.audit_logs a where a.user_id=actor and a.entity_id=d.id
        and a.entity_type='personal_payable' and a.action='EDIT' and (a.created_at at time zone 'Asia/Riyadh')::date>p_as_of))
 ), receivable as (
  select a.id,p.base_currency currency,
   case when a.metadata ?| array['personal_contract_id','investment_id','register_source']
      or exists(select 1 from public.personal_financings f where f.user_id=actor and f.receivable_id=a.id)
      then 'SPECIALIZED_CONTRACT_SOURCE'
    when exists(select 1 from public.audit_logs h where h.user_id=actor and h.entity_id=a.id and h.entity_type='asset_account'
       and h.action in ('AMEND_OPENING_BALANCE','ARCHIVE_OPENING_BALANCE')
       and (h.created_at at time zone 'Asia/Riyadh')::date>p_as_of) then 'POST_CUTOFF_AMENDMENT'
    when d.id is not null or a.metadata ? 'personal_income_document_id' then
     case when d.id is null or d.kind='TAX_DRAFT' or p.base_currency<>'SAR' or a.currency<>p.base_currency
            or a.metadata->>'personal_income_document_id' is distinct from d.id::text
            or a.metadata->>'entry_source' is distinct from 'PERSONAL_INCOME'
            or q.origin_count<>1 or coalesce(q.document_invalid,false)
       then 'RECEIVABLE_SOURCE_UNVERIFIED' end
    when not coalesce(q.has_opening,false) or coalesce(q.invalid,false) then 'RECEIVABLE_SOURCE_UNVERIFIED'
    else null end gap,q.amount
   from public.asset_accounts a join public.profiles p on p.id=actor
   left join public.personal_income_documents d on d.receivable_id=a.id and d.owner_id=actor
   left join lateral (
    select bool_or(t.transaction_type='OPENING_BALANCE') has_opening,
     bool_or(t.base_currency<>p.base_currency or coalesce(t.metadata->>'asset_deleted','false')='true'
       or (t.transaction_type not in('OPENING_BALANCE','ADD','WITHDRAWAL','REVERSAL'))
       or (t.transaction_type='REVERSAL' and (original.id is null or original.transaction_date>t.transaction_date
        or original.base_currency<>t.base_currency or original.base_value<>t.base_value
        or original.transaction_type not in ('OPENING_BALANCE','ADD','WITHDRAWAL')))) invalid,
     count(*) filter(where t.transaction_type='ADD') origin_count,
     bool_or(case
       when d.id is null then false
       when t.base_currency<>p.base_currency or t.currency<>p.base_currency
         or t.metadata->>'asset_deleted'='true' or t.reversal_of_transaction_id is not null then true
       when t.transaction_type='ADD' then
         t.transaction_date<>d.document_date or t.base_value<>d.gross_amount
         or t.gross_value<>d.gross_amount or t.quantity<>d.gross_amount or t.transfer_id is not null
         or t.metadata->>'personal_income_document_id' is distinct from d.id::text
         or t.metadata->>'entry_source' is distinct from 'PERSONAL_INCOME'
         or t.metadata->'non_cash' is distinct from 'true'::jsonb
       when t.transaction_type='TRANSFER_OUT' then
         t.transaction_date<d.document_date or t.base_value<=0
         or t.metadata->>'source' is distinct from 'FINANCIAL_REGISTER'
         or t.metadata->>'operation' is distinct from 'COLLECT'
         or t.metadata->'cash_transfer_result'->>'transfer_id' is distinct from t.transfer_id::text
         or t.metadata->'cash_transfer_result'->>'out_transaction_id' is distinct from t.id::text
         or not exists (
           select 1
           from public.transactions receipt
           join public.asset_accounts funding on funding.id=receipt.asset_account_id
           where receipt.user_id=actor and receipt.organization_id is null
             and receipt.transfer_id=t.transfer_id and receipt.transaction_type='TRANSFER_IN'
             and receipt.id::text=t.metadata->'cash_transfer_result'->>'in_transaction_id'
             and receipt.transaction_date=t.transaction_date and receipt.reversal_of_transaction_id is null
             and receipt.base_currency=t.base_currency and receipt.currency=t.currency
             and receipt.base_value=t.base_value and receipt.gross_value=t.gross_value and receipt.quantity=t.quantity
             and coalesce(receipt.metadata->>'asset_deleted','false')<>'true'
             and funding.user_id=actor and funding.organization_id is null
             and funding.ownership_scope='PERSONAL' and funding.asset_type in ('BANK','CASH')
             and funding.currency=p.base_currency
             and not exists(select 1 from public.transactions reversed where reversed.user_id=actor
               and reversed.organization_id is null and reversed.reversal_of_transaction_id=receipt.id
               and reversed.transaction_date<=p_as_of)
         )
       else true end) document_invalid,
     sum(case when t.transaction_type in ('WITHDRAWAL','TRANSFER_OUT') or (t.transaction_type='REVERSAL' and original.transaction_type<>'WITHDRAWAL')
       then -t.base_value else t.base_value end) amount
    from public.transactions t left join public.transactions original on original.id=t.reversal_of_transaction_id
      and original.user_id=actor and original.asset_account_id=a.id and original.organization_id is null
    where t.asset_account_id=a.id and t.user_id=actor and t.organization_id is null and t.transaction_date<=p_as_of
   ) q on true
   where a.user_id=actor and a.organization_id is null and a.ownership_scope='PERSONAL' and a.asset_type='RECEIVABLE'
    and case when d.id is not null then d.document_date<=p_as_of
      else q.amount is not null or (a.created_at at time zone 'Asia/Riyadh')::date<=p_as_of end
 ), rows as (
  select id,'PERSONAL_PAYABLE' source,'PAYABLE' side,currency,amount-cleared balance,
    coalesce(gap,case when amount<cleared then 'NEGATIVE_RESIDUAL' end) gap from payable
  union all
  select id,'PERSONAL_RECEIVABLE','RECEIVABLE',currency,amount,
    coalesce(gap,case when amount<0 then 'NEGATIVE_RESIDUAL' end) from receivable
 )
 select jsonb_build_object('asOf',p_as_of,'scope','PERSONAL','basis','NATIVE_V2_MOVEMENTS',
  'coverage','PARTIAL','rows',coalesce(jsonb_agg(jsonb_build_object('id',id,'source',source,'side',side,'currency',currency,
     'balance',case when gap is null then balance::text end,'gap',gap) order by source,id),'[]'::jsonb),
  'excludedSources',jsonb_build_array('SPECIALIZED_CONTRACTS','INVESTMENT_CONTRACTS','UNPROVEN_EDITED_HISTORY'))
 into result from rows;
 return result;
end $$;
