-- Review approved documentary pairs and earlier open balances against the approved batch.
-- Event references only, without documentary contents or changes to ledgers.
create index financial_group_document_approved_organizations
 on private.financial_group_document_matches(left_organization_id,right_organization_id)
 where status='APPROVED';

create function private.financial_group_prior_pair_balance(
 p_left_org uuid,p_left_event uuid,p_right_org uuid,p_right_event uuid,p_currency text,p_to date,p_current boolean
) returns jsonb language plpgsql stable set search_path='' as $$
declare left_kinds text[]; right_kinds text[]; left_balance text; right_balance text;
begin
 select array_agg(distinct obligation_type::text) into left_kinds from public.financial_event_obligations
 where organization_id=p_left_org and event_id=p_left_event and adjusts_obligation_id is null;
 select array_agg(distinct obligation_type::text) into right_kinds from public.financial_event_obligations
 where organization_id=p_right_org and event_id=p_right_event and adjusts_obligation_id is null;
 if not coalesce((left_kinds @> array['PAYABLE'] and right_kinds @> array['RECEIVABLE'])
  or (left_kinds @> array['RECEIVABLE'] and right_kinds @> array['PAYABLE']),false) then return null;end if;
 if not p_current or cardinality(left_kinds)<>1 or cardinality(right_kinds)<>1
  then return jsonb_build_object('status','REVIEW_REQUIRED');end if;
 begin
  left_balance:=private.financial_group_open_item(p_left_org,p_left_event,left_kinds[1],p_currency,p_to)->>'outstanding';
  right_balance:=private.financial_group_open_item(p_right_org,p_right_event,right_kinds[1],p_currency,p_to)->>'outstanding';
 exception when raise_exception then
  if sqlerrm not in ('GROUP_BATCH_OPEN_ITEM_AMBIGUOUS','GROUP_BATCH_OPEN_ITEM_INVALID','GROUP_BATCH_OPEN_ITEM_UNRECONCILED') then raise;end if;
  return jsonb_build_object('status','REVIEW_REQUIRED');
 end;
 if left_balance::numeric=0 and right_balance::numeric=0 then return null;end if;
 return jsonb_build_object('status','OPEN','currency',p_currency,'leftOutstanding',left_balance,'rightOutstanding',right_balance);
end $$;
revoke all on function private.financial_group_prior_pair_balance(uuid,uuid,uuid,uuid,text,date,boolean) from public,anon,authenticated;

create function private.financial_group_document_coverage(p_root uuid,p_from date,p_to date,p_identity_page integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scope jsonb; approved jsonb; members uuid[]; unmatched jsonb; transfer_candidates jsonb; invoice_candidates jsonb; invoice_identity_review jsonb;
begin
 if auth.uid() is null then raise exception 'GROUP_DOCUMENT_READ_DENIED';end if;
 if p_identity_page is null or p_identity_page<1 then raise exception 'GROUP_DOCUMENT_PAGE_INVALID';end if;
 scope:=public.financial_group_registered_scope(p_root,p_from,p_to);
 approved:=public.financial_group_approved_eliminations(p_root,p_from,p_to);
 select array_agg(id::uuid) into members
 from jsonb_array_elements_text(scope->'expectedOrganizationIds') as member(id);
 with omitted as materialized (
  select d.id,d.left_event_id,d.right_event_id,d.left_organization_id,d.right_organization_id,a.base_currency,
   least(a.event_date,b.event_date)<p_from as is_prior,
   a.status='ACTUAL' and b.status='ACTUAL' and a.base_currency=b.base_currency
    and private.financial_group_document_fingerprint(d.left_event_id,d.right_event_id) is not distinct from d.source_fingerprint as source_current
  from private.financial_group_document_matches d
  join public.financial_events a on a.id=d.left_event_id and a.organization_id=d.left_organization_id
  join public.financial_events b on b.id=d.right_event_id and b.organization_id=d.right_organization_id
  where d.status='APPROVED'
   and d.left_organization_id=any(members) and d.right_organization_id=any(members)
   and a.event_date<=p_to and b.event_date<=p_to
   and not exists(select 1 from jsonb_array_elements(approved->'entries') as entry(value)
    where entry.value->>'documentMatchId'=d.id::text)
 ), balances as materialized (
  select *,case when is_prior then private.financial_group_prior_pair_balance(
    left_organization_id,left_event_id,right_organization_id,right_event_id,base_currency,p_to,source_current
   ) end as prior_balance from omitted
 ), review_rows as (
  select * from balances where not is_prior or prior_balance is not null order by id limit 201
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'leftEventId',left_event_id,'rightEventId',right_event_id,
  'sourceCurrent',source_current)||case when is_prior then jsonb_build_object('priorBalance',prior_balance) else '{}'::jsonb end
  order by id),'[]'::jsonb) into unmatched from review_rows;
 if jsonb_array_length(unmatched)>200 then raise exception 'GROUP_DOCUMENT_COVERAGE_LIMIT';end if;

 -- The transfer register identifies both companies. Only an explicit cash
 -- source link can identify a journal for a specific leg of that transfer.
 with candidates as (
  select t.id,t.transfer_date,t.transaction_type,t.source_organization_id,t.destination_organization_id,
   src.name as source_name,dst.name as destination_name,
   legs.out_events,legs.in_events
  from public.liquidity_intercompany_transfers t
  join public.organizations src on src.id=t.source_organization_id
  join public.organizations dst on dst.id=t.destination_organization_id
  cross join lateral (
   select array_agg(distinct e.id) filter(where f.direction='OUTFLOW') as out_events,
    array_agg(distinct e.id) filter(where f.direction='INFLOW') as in_events
   from public.liquidity_flows f
   join public.financial_event_links l on l.organization_id=f.organization_id and l.target_record_id=f.id
    and l.link_type='CASH_FLOW' and l.target_module='liquidity_flows'
   join public.financial_events e on e.id=l.event_id and e.organization_id=f.organization_id
   where f.intercompany_transfer_id=t.id and f.status='ACTUAL' and e.status='ACTUAL'
    and e.event_date between p_from and p_to
    and ((f.direction='OUTFLOW' and f.organization_id=t.source_organization_id)
      or (f.direction='INFLOW' and f.organization_id=t.destination_organization_id))
    and exists(select 1 from public.financial_event_lines ln where ln.event_id=e.id
     and ln.organization_id=e.organization_id and ln.cash_direction=f.direction)
  ) legs
  where t.holding_organization_id=any(members)
   and t.source_organization_id=any(members) and t.destination_organization_id=any(members)
   and t.transfer_date between p_from and p_to
 ), pending as (
  select *,case when cardinality(out_events)=1 and cardinality(in_events)=1
   then 'DOCUMENT_MATCH_REQUIRED' else 'SOURCE_LINK_REVIEW_REQUIRED' end as review_status
  from candidates c
  where not (coalesce(cardinality(out_events),0)=1 and coalesce(cardinality(in_events),0)=1 and exists(
   select 1 from private.financial_group_document_matches d where d.status='APPROVED'
    and d.left_event_id=least(c.out_events[1],c.in_events[1])
    and d.right_event_id=greatest(c.out_events[1],c.in_events[1])
    and ((d.left_organization_id=c.source_organization_id and d.right_organization_id=c.destination_organization_id)
      or (d.left_organization_id=c.destination_organization_id and d.right_organization_id=c.source_organization_id))
    and private.financial_group_document_fingerprint(d.left_event_id,d.right_event_id)=d.source_fingerprint
  ))
  order by transfer_date,id limit 201
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'date',transfer_date,'type',transaction_type,
  'sourceName',source_name,'destinationName',destination_name,
  'status',review_status) order by transfer_date,id),'[]'::jsonb) into transfer_candidates from pending;
 if jsonb_array_length(transfer_candidates)>200 then raise exception 'GROUP_DOCUMENT_COVERAGE_LIMIT';end if;

 -- Use the tax number stored on the posted invoice, never a party name
 -- or an amount. Shared registration numbers cannot identify one member.
 with registered as materialized (
  select btrim(v.tax_registration_number) as tax_number,count(*) as member_count
  from public.vat_profiles v join public.organizations o on o.id=v.organization_id
  where v.organization_id=any(members) and o.country_code='SA'
   and v.registration_status='REGISTERED' and btrim(v.tax_registration_number)~'^3[0-9]{13}3$'
  group by btrim(v.tax_registration_number)
 ), posted_invoices as materialized (
  select d.id,e.id as event_id,d.organization_id,d.transaction_date,d.document_type,issuer.name as issuer,
   nullif(btrim(d.counterparty_tax_number),'') as tax_number
  from public.vat_documents d
  join public.organizations issuer on issuer.id=d.organization_id and issuer.country_code='SA'
  join public.financial_vat_source_bindings b on b.organization_id=d.organization_id and b.source_record_id=d.id
   and b.source_table='vat_documents' and b.document_kind='INVOICE' and not b.is_alias
  join public.financial_events e on e.id=b.event_id and e.organization_id=d.organization_id
  where d.organization_id=any(members) and d.document_kind='INVOICE' and d.transaction_date between p_from and p_to
   and e.status='ACTUAL' and e.event_date between p_from and p_to
 ), pending_invoices as (
  select d.*,party.name as counterparty
  from posted_invoices d
  join registered r on r.tax_number=d.tax_number and r.member_count=1
  join public.vat_profiles p on btrim(p.tax_registration_number)=r.tax_number and p.registration_status='REGISTERED'
  join public.organizations party on party.id=p.organization_id and party.country_code='SA'
  where p.organization_id=any(members) and d.organization_id<>p.organization_id
   and (p.registration_date is null or p.registration_date<=d.transaction_date)
   and not exists (
    select 1 from private.financial_group_document_matches m
    join public.financial_events other on other.organization_id=p.organization_id and other.status='ACTUAL'
     and ((m.left_event_id=d.event_id and m.right_event_id=other.id) or (m.right_event_id=d.event_id and m.left_event_id=other.id))
    where m.status='APPROVED'
     and ((m.left_organization_id=d.organization_id and m.right_organization_id=p.organization_id)
       or (m.right_organization_id=d.organization_id and m.left_organization_id=p.organization_id))
     and private.financial_group_document_fingerprint(m.left_event_id,m.right_event_id)=m.source_fingerprint
   )
  order by d.transaction_date,d.id limit 201
 ), missing_identity as materialized (
  select d.id,d.event_id,d.transaction_date,d.document_type,d.issuer,
   case when d.tax_number is null then 'MISSING_TAX_NUMBER' else 'SHARED_TAX_NUMBER' end as reason
  from posted_invoices d
  left join registered r on r.tax_number=d.tax_number
  where (d.tax_number is null or r.member_count>1)
   and not exists (
    select 1 from private.financial_group_document_matches m
    join public.financial_events other on other.organization_id=any(members) and other.organization_id<>d.organization_id
     and other.status='ACTUAL'
     and ((m.left_event_id=d.event_id and m.left_organization_id=d.organization_id
       and m.right_event_id=other.id and m.right_organization_id=other.organization_id)
      or (m.right_event_id=d.event_id and m.right_organization_id=d.organization_id
       and m.left_event_id=other.id and m.left_organization_id=other.organization_id))
    where m.status='APPROVED'
     and private.financial_group_document_fingerprint(m.left_event_id,m.right_event_id)=m.source_fingerprint
   )
 ), identity_counts as (
  select count(*) filter(where reason='MISSING_TAX_NUMBER') as missing_count,
   count(*) filter(where reason='SHARED_TAX_NUMBER') as shared_count,
   least(p_identity_page,greatest(1,(count(*)+19)/20)) as page
  from missing_identity
 )
 select
  (select coalesce(jsonb_agg(jsonb_build_object('id',id,'eventId',event_id,'date',transaction_date,
   'side',document_type,'organizationName',issuer,'counterpartyName',counterparty) order by transaction_date,id),'[]'::jsonb)
   from pending_invoices),
  (select jsonb_build_object(
   'missingCount',missing_count,'sharedCount',shared_count,'page',page,
   'rows',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'eventId',event_id,'date',transaction_date,
    'side',document_type,'organizationName',issuer,'reason',reason) order by transaction_date desc,id),'[]'::jsonb)
    from (select * from missing_identity order by transaction_date desc,id
     limit 20 offset (select (page-1)*20 from identity_counts)) requested_page)
  ) from identity_counts)
 into invoice_candidates,invoice_identity_review;
 if jsonb_array_length(invoice_candidates)>200 then raise exception 'GROUP_DOCUMENT_COVERAGE_LIMIT';end if;
 if scope is distinct from public.financial_group_registered_scope(p_root,p_from,p_to)
  then raise exception 'GROUP_DOCUMENT_SCOPE_CHANGED';end if;
 return jsonb_build_object('status','GROUP_DOCUMENT_COVERAGE_REVIEW','organization',p_root,'from',p_from,'to',p_to,
  'batchId',approved->'id','batchVersion',approved->'version','rows',unmatched,
  'transferCandidates',transfer_candidates,'invoiceCandidates',invoice_candidates,'invoiceIdentityReview',invoice_identity_review);
end $$;
revoke all on function private.financial_group_document_coverage(uuid,date,date,integer) from public,anon,authenticated;
grant execute on function private.financial_group_document_coverage(uuid,date,date,integer) to authenticated;

create function public.financial_group_document_coverage(p_root uuid,p_from date,p_to date,p_identity_page integer default 1)
returns jsonb language sql security invoker set search_path='' as $$
 select private.financial_group_document_coverage(p_root,p_from,p_to,p_identity_page)
$$;
revoke all on function public.financial_group_document_coverage(uuid,date,date,integer) from public,anon,authenticated;
grant execute on function public.financial_group_document_coverage(uuid,date,date,integer) to authenticated;
