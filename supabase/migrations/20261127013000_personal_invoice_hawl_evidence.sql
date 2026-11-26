-- Requires the personal income document source and the verified cutoff debt reader.
create table public.personal_invoice_hawl_events (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.personal_income_documents(id),
  request_id uuid not null,
  due_date date not null,
  classification text not null check (classification in ('EXCELLENT','GOOD','BAD')),
  effective_date date not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (document_id, request_id)
);

create index personal_invoice_hawl_events_cutoff_idx
  on public.personal_invoice_hawl_events (document_id, effective_date desc, id desc);

alter table public.personal_invoice_hawl_events enable row level security;
revoke all on public.personal_invoice_hawl_events from public,anon,authenticated;
grant select on public.personal_invoice_hawl_events to authenticated;
create policy personal_invoice_hawl_events_owner_read
  on public.personal_invoice_hawl_events for select to authenticated using (
    exists (
      select 1 from public.personal_income_documents d
      where d.id=document_id and d.owner_id=auth.uid()
    )
  );

create function public.record_personal_invoice_hawl_event(
  p_document uuid, p_request uuid, p_due_date date, p_classification text, p_effective_date date
) returns public.personal_invoice_hawl_events
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid();
  recognized_on date;
  event public.personal_invoice_hawl_events;
begin
  if actor is null then raise exception 'UNAUTHORIZED'; end if;
  -- Serializes event insertion for the same invoice and does not alter the invoice.
  select document_date into recognized_on from public.personal_income_documents
    where id=p_document and owner_id=actor and receivable_id is not null for update;
  if not found then raise exception 'PERSONAL_INVOICE_HAWL_DOCUMENT_NOT_FOUND'; end if;

  if p_request is null or p_due_date is null or p_effective_date is null
     or not isfinite(p_due_date) or not isfinite(p_effective_date)
     or p_due_date<recognized_on or p_effective_date<recognized_on
     or p_classification is null or p_classification not in ('EXCELLENT','GOOD','BAD') then
    raise exception 'PERSONAL_INVOICE_HAWL_EVENT_INVALID';
  end if;

  select * into event from public.personal_invoice_hawl_events
    where document_id=p_document and request_id=p_request;
  if found then
    if (event.due_date,event.classification,event.effective_date)
       is distinct from (p_due_date,p_classification,p_effective_date) then
      raise exception 'PERSONAL_INVOICE_HAWL_REQUEST_CONFLICT';
    end if;
    return event;
  end if;

  insert into public.personal_invoice_hawl_events(document_id,request_id,due_date,classification,effective_date)
    values(p_document,p_request,p_due_date,p_classification,p_effective_date)
    returning * into event;
  return event;
end
$$;
revoke all on function public.record_personal_invoice_hawl_event(uuid,uuid,date,text,date) from public,anon;
grant execute on function public.record_personal_invoice_hawl_event(uuid,uuid,date,text,date) to authenticated;

create function public.read_personal_invoice_hawl_at_cutoff(p_document uuid, p_as_of date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  actor uuid:=auth.uid();
  invoice public.personal_income_documents;
  event public.personal_invoice_hawl_events;
  line jsonb;
  gross_remaining numeric;
  net_collected numeric;
  eligible_from date;
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
      'status','NOT_RECOGNIZED_AT_CUTOFF');
  end if;

  select * into event from public.personal_invoice_hawl_events
    where document_id=p_document and effective_date<=p_as_of
    order by effective_date desc,id desc limit 1;
  if not found then
    return jsonb_build_object('documentId',p_document,'asOf',p_as_of,'status','MISSING_TERMS');
  end if;

  select value into line
    from jsonb_array_elements(public.read_personal_debts_at_cutoff(p_as_of)->'rows')
    where value->>'id'=invoice.receivable_id::text;
  gross_remaining:=(line->>'balance')::numeric;
  if gross_remaining is null or gross_remaining<0 or gross_remaining>invoice.gross_amount then
    return jsonb_build_object('documentId',p_document,'asOf',p_as_of,
      'status','RECEIVABLE_SOURCE_UNVERIFIED','gap',line->>'gap','eventId',event.id);
  end if;

  -- Round cumulative allocation, so the difference between two cutoffs gives
  -- each receipt's net component and the fully paid invoice equals its net value.
  net_collected:=round(invoice.net_amount*(invoice.gross_amount-gross_remaining)/invoice.gross_amount,2);

  if event.classification in ('EXCELLENT','GOOD') and p_as_of>=event.due_date and gross_remaining>0 then
    -- Preserve uninterrupted eligible ranges, including GOOD to EXCELLENT.
    -- A day whose closing status is BAD breaks the range. Due-date amendments
    -- start at their own effective date and preserve earlier cutoff reads.
    with daily as (
      select distinct on (effective_date) effective_date,due_date,classification
      from public.personal_invoice_hawl_events where document_id=p_document and effective_date<=p_as_of
      order by effective_date,id desc
    ), bounded as (
      select greatest(effective_date,due_date) starts_on,
        lead(effective_date,1,p_as_of+1) over(order by effective_date) ends_before,
        classification
      from daily
    ), eligible as (
      select starts_on,ends_before,lag(ends_before) over(order by starts_on) previous_end
      from bounded
      where classification in ('EXCELLENT','GOOD') and starts_on<ends_before
    ), ranges as (
      select starts_on,ends_before,
        sum(case when starts_on=previous_end then 0 else 1 end) over(order by starts_on) range_id
      from eligible
    )
    select min(starts_on) into eligible_from from ranges
      group by range_id having max(ends_before)=p_as_of+1;
  end if;

  return jsonb_build_object(
    'documentId',p_document,'receivableId',invoice.receivable_id,'asOf',p_as_of,'status','VERIFIED',
    'eventId',event.id,'dueDate',event.due_date,'classification',event.classification,
    'classificationEffectiveDate',event.effective_date,'currency',line->>'currency',
    'grossRemaining',gross_remaining,'netCollected',net_collected,
    'netRemaining',invoice.net_amount-net_collected,
    'netEligibleReceivable',case when eligible_from is not null then invoice.net_amount-net_collected else 0 end,
    'receivableEligibleSince',eligible_from
  );
end
$$;
revoke all on function public.read_personal_invoice_hawl_at_cutoff(uuid,date) from public,anon;
grant execute on function public.read_personal_invoice_hawl_at_cutoff(uuid,date) to authenticated;
