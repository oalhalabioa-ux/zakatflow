create or replace function public.read_financial_fx_revaluation(p_org uuid,p_journal uuid,p_as_of date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result public.financial_fx_revaluation_evidence%rowtype; reversal jsonb;
begin
 if auth.uid() is null or not public.financial_core_can(p_org,'financial_core.view') then raise exception 'REPORTING_FX_BIND_DENIED'; end if;
 -- A journal-wide lookup can prove at most one eligible binding.
 begin
  select * into strict result from public.financial_fx_revaluation_evidence
    where organization_id=p_org and journal_id=p_journal and cutoff<=p_as_of;
 exception
  when no_data_found then return null;
  when too_many_rows then raise exception 'REPORTING_FX_REVALUATION_AMBIGUOUS';
 end;
 select jsonb_build_object('journalId',e.id,'lineId',l.id,'date',e.event_date,'baseAmount',l.base_amount::text,
    'debtAccountId',result.debt_account_id,'debtSide',case when result.debt_side='DEBIT' then 'CREDIT' else 'DEBIT' end)
 into reversal
 from public.financial_event_links k
 join public.financial_events e on e.id=k.event_id and e.organization_id=p_org
 join public.financial_event_lines l on l.event_id=e.id and l.organization_id=p_org
 where k.organization_id=p_org and k.link_type='REVERSAL_OF' and k.related_event_id=result.journal_id
   and e.status in ('ACTUAL','REVERSED') and e.event_type='REVERSAL'
   and e.event_date between result.cutoff and p_as_of and l.cash_direction='NON_CASH'
   and exists(select 1 from public.financial_events original where original.id=result.journal_id
     and original.organization_id=p_org and original.status='REVERSED')
   and l.base_amount=result.posted_base_amount
   and (select count(*) from public.financial_event_lines lx where lx.event_id=e.id)=1
   and l.classification_id=(select x.classification_id from public.financial_event_lines x where x.id=result.line_id);
 if (select count(*) from public.financial_event_links k join public.financial_events e on e.id=k.event_id and e.organization_id=p_org
   where k.organization_id=p_org and k.link_type='REVERSAL_OF' and k.related_event_id=result.journal_id
     and e.status in ('ACTUAL','REVERSED') and e.event_date<=p_as_of)>(case when reversal is null then 0 else 1 end) then
  raise exception 'REPORTING_FX_REVERSAL_UNVERIFIED';
 end if;
 return jsonb_build_object('evidence',to_jsonb(result),'canonicalLineId',result.line_id::text||':BASE',
   'reversal',reversal,'asOf',p_as_of,'basis','POSTED_V2_LINEAGE');
end $$;
