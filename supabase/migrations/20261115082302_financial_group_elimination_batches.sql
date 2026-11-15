-- Group-only elimination evidence. Never changes company source journals.
create function private.financial_group_canonical(p_value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;
begin
 if jsonb_typeof(p_value)='array' then
  select coalesce(jsonb_agg(v order by v::text),'[]'::jsonb) into result from (select private.financial_group_canonical(value) v from jsonb_array_elements(p_value)) x;
 elsif jsonb_typeof(p_value)='object' then
  select coalesce(jsonb_object_agg(key,private.financial_group_canonical(value)),'{}'::jsonb) into result from jsonb_each(p_value) where key<>'readAt';
 else result:=p_value;end if;
 return result;
end $$;
revoke all on function private.financial_group_canonical(jsonb) from public,anon,authenticated;

create function private.financial_group_event_effective(p_org uuid,p_event uuid,p_currency text,p_to date)
returns boolean language plpgsql stable set search_path='' as $$
declare e public.financial_events%rowtype;n integer;r public.financial_events%rowtype;
begin
 select * into e from public.financial_events where id=p_event and organization_id=p_org;
 if e.id is null or e.base_currency<>p_currency then raise exception 'GROUP_BATCH_OPEN_ITEM_INVALID';end if;
 if e.status not in('ACTUAL','REVERSED') or e.event_date>p_to then return false;end if;
 select count(*) into n from public.financial_event_links l join public.financial_events x on x.id=l.event_id and x.organization_id=l.organization_id
 where l.organization_id=p_org and l.related_event_id=e.id and l.link_type='REVERSAL_OF' and x.status in('ACTUAL','REVERSED');
 if e.status='ACTUAL' then
  if n<>0 then raise exception 'GROUP_BATCH_OPEN_ITEM_INVALID';end if;return true;
 end if;
 if n<>1 then raise exception 'GROUP_BATCH_OPEN_ITEM_INVALID';end if;
 select x.* into r from public.financial_event_links l join public.financial_events x on x.id=l.event_id and x.organization_id=l.organization_id
 where l.organization_id=p_org and l.related_event_id=e.id and l.link_type='REVERSAL_OF' and x.status in('ACTUAL','REVERSED');
 if r.status<>'ACTUAL' or r.event_date<e.event_date or r.base_currency<>p_currency then raise exception 'GROUP_BATCH_OPEN_ITEM_INVALID';end if;
 return r.event_date>p_to;
end $$;
revoke all on function private.financial_group_event_effective(uuid,uuid,text,date) from public,anon,authenticated;

create function private.financial_group_open_item(p_org uuid,p_event uuid,p_kind text,p_currency text,p_to date)
returns jsonb language plpgsql stable set search_path='' as $$
declare r public.financial_event_obligations%rowtype;n public.financial_event_obligations%rowtype;a public.financial_event_obligation_allocations%rowtype;amount numeric;
begin
 if (select count(*) from public.financial_event_obligations where organization_id=p_org and event_id=p_event and obligation_type=p_kind and adjusts_obligation_id is null)<>1
 then raise exception 'GROUP_BATCH_OPEN_ITEM_AMBIGUOUS';end if;
 select * into r from public.financial_event_obligations where organization_id=p_org and event_id=p_event and obligation_type=p_kind and adjusts_obligation_id is null;
 if r.base_currency<>p_currency or r.adjustment_effect<>'INCREASE' or r.settleable_base_amount<0
  or not private.financial_group_event_effective(p_org,p_event,p_currency,p_to) then raise exception 'GROUP_BATCH_OPEN_ITEM_INVALID';end if;
 amount:=r.settleable_base_amount;
 for n in select * from public.financial_event_obligations where organization_id=p_org and adjusts_obligation_id=r.id loop
  if n.base_currency<>p_currency or n.obligation_type<>p_kind or n.adjustment_effect not in('INCREASE','DECREASE') or n.settleable_base_amount<0 then raise exception 'GROUP_BATCH_OPEN_ITEM_INVALID';end if;
  if private.financial_group_event_effective(p_org,n.event_id,p_currency,p_to) then amount:=amount+n.settleable_base_amount*case when n.adjustment_effect='DECREASE' then -1 else 1 end;end if;
 end loop;
 for a in select * from public.financial_event_obligation_allocations where organization_id=p_org and obligation_id=r.id loop
  if a.base_currency<>p_currency or a.base_amount<0 then raise exception 'GROUP_BATCH_OPEN_ITEM_INVALID';end if;
  if private.financial_group_event_effective(p_org,a.application_event_id,p_currency,p_to) then amount:=amount-a.base_amount;end if;
 end loop;
 if amount<0 then raise exception 'GROUP_BATCH_OPEN_ITEM_UNRECONCILED';end if;
 return jsonb_build_object('obligationId',r.id,'outstanding',amount::numeric(24,4)::text);
end $$;
revoke all on function private.financial_group_open_item(uuid,uuid,text,text,date) from public,anon,authenticated;

create function private.financial_group_batch_evidence(p_root uuid,p_from date,p_to date,p_entries jsonb,p_reporting boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare control jsonb;sources jsonb:='{}';trials jsonb:='{}';s jsonb;trial jsonb;e jsonb;ref jsonb;ev jsonb;l jsonb;a jsonb;doc jsonb;oi jsonb;
 member uuid;ids uuid[];currency text;retained text;side text;account_id text;source_key text;account_key text;open_key text;
 amount numeric;balance numeric;available numeric;used jsonb:='{}';seen text[]:='{}';documents jsonb:='[]';open_items jsonb:='[]';relation jsonb;
begin
 if auth.uid() is null or p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries)>200 then raise exception 'GROUP_BATCH_INPUT_INVALID';end if;
 control:=public.financial_group_registered_scope(p_root,p_from,p_to);
 select array_agg(value::uuid order by value) into ids from jsonb_array_elements_text(control->'expectedOrganizationIds');
 if jsonb_array_length(control->'relationships')<>cardinality(ids)-1 then raise exception 'GROUP_BATCH_CONTROL_INCOMPLETE';end if;
 for relation in select * from jsonb_array_elements(control->'relationships') loop
  if (relation->>'effectiveFrom')::date>p_from or (relation->>'effectiveTo')::date<p_to then raise exception 'GROUP_BATCH_CONTROL_PERIOD_UNSUPPORTED';end if;
  -- Partial ownership needs separately approved acquisition/NCI accounting.
  if (relation->>'directEconomicInterestPercent')::numeric<>100 then raise exception 'GROUP_BATCH_NCI_REQUIRED';end if;
 end loop;
 foreach member in array ids loop
  if p_reporting then
   if not private.financial_opening_can(member,'financial_core.view') then raise exception 'GROUP_BATCH_READ_DENIED';end if;
  elsif not private.financial_opening_can(member,'financial_core.create') or not public.is_organization_admin(member) then raise exception 'GROUP_BATCH_WRITE_DENIED';end if;
  s:=public.financial_statement_live_snapshot(member,p_from,p_to);
  if s->>'closureId' is not null or s->>'origin'<>'LIVE_CANONICAL_EVENTS' or s#>>'{coverage,complete}'<>'true' or s#>>'{coverage,scope}'<>'ORGANIZATION_ALL_ENTITIES' then raise exception 'GROUP_BATCH_SOURCE_UNAVAILABLE';end if;
  if currency is null then currency:=s->>'currency';elsif currency<>s->>'currency' then raise exception 'GROUP_BATCH_FX_REQUIRED';end if;
  select x->>'id' into retained from jsonb_array_elements(s->'accounts') x where x->>'kind'='EQUITY' order by x->>'id' limit 1;
  trial:=private.financial_fiscal_trial(s,retained);
  sources:=jsonb_set(sources,array[member::text],s);trials:=jsonb_set(trials,array[member::text],trial);
 end loop;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_entries) x)<>jsonb_array_length(p_entries) then raise exception 'GROUP_BATCH_DUPLICATE_ENTRY';end if;
 for e in select * from jsonb_array_elements(p_entries) loop
  if jsonb_typeof(e)<>'object' or not(e ?& array['id','documentMatchId','kind','date','amount','reason','debitSource','creditSource'])
   or e->>'id' is null or e->>'documentMatchId' is null or coalesce(e->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
   or coalesce(e->>'kind','') not in('INTERCOMPANY_BALANCE','INTERCOMPANY_INCOME')
   or coalesce(e->>'amount','') !~ '^\d{1,20}(\.\d{1,4})?$' or length(trim(coalesce(e->>'reason',''))) not between 8 and 2000
   or (e->>'date')::date not between p_from and p_to then raise exception 'GROUP_BATCH_INPUT_INVALID';end if;
  perform (e->>'id')::uuid;amount:=(e->>'amount')::numeric;
  if amount<=0 or (e->>'kind'='INTERCOMPANY_BALANCE' and (e->>'date')::date<>p_to) then raise exception 'GROUP_BATCH_INPUT_INVALID';end if;
  if e#>>'{debitSource,organizationId}'=e#>>'{creditSource,organizationId}' then raise exception 'GROUP_BATCH_PAIR_INVALID';end if;
  doc:=(public.financial_group_document_context(array[(e->>'documentMatchId')::uuid]))->0;
  if doc->>'status'<>'APPROVED' or doc->>'sourceCurrent'<>'true' then raise exception 'GROUP_BATCH_DOCUMENT_NOT_APPROVED';end if;
  if not ((doc->>'leftEventId'=e#>>'{debitSource,eventId}' and doc->>'leftOrganizationId'=e#>>'{debitSource,organizationId}' and doc->>'rightEventId'=e#>>'{creditSource,eventId}' and doc->>'rightOrganizationId'=e#>>'{creditSource,organizationId}')
   or (doc->>'rightEventId'=e#>>'{debitSource,eventId}' and doc->>'rightOrganizationId'=e#>>'{debitSource,organizationId}' and doc->>'leftEventId'=e#>>'{creditSource,eventId}' and doc->>'leftOrganizationId'=e#>>'{creditSource,organizationId}')) then raise exception 'GROUP_BATCH_DOCUMENT_MISMATCH';end if;
  documents:=documents||jsonb_build_array(doc);
  foreach side in array array['debit','credit'] loop
   ref:=e->(side||'Source');
   if jsonb_typeof(ref)<>'object' or not(ref ?& array['organizationId','eventId','lineId','accountId'])
    or ref->>'organizationId' is null or ref->>'eventId' is null or ref->>'lineId' is null or ref->>'accountId' is null then raise exception 'GROUP_BATCH_INPUT_INVALID';end if;
   member:=(ref->>'organizationId')::uuid;s:=sources->member::text;
   if s is null then raise exception 'GROUP_BATCH_MEMBER_INVALID';end if;
   select x into ev from jsonb_array_elements(s->'events') x where x->>'id'=ref->>'eventId';
   if ev is null or ev->>'status'<>'ACTUAL' or ev->>'reversesEventId' is not null or (ev->>'date')::date>(e->>'date')::date
    or (e->>'kind'='INTERCOMPANY_INCOME' and (ev->>'date')::date<p_from) then raise exception 'GROUP_BATCH_SOURCE_INVALID';end if;
   select x into l from jsonb_array_elements(ev->'lines') x where x->>'id'=ref->>'lineId';
   account_id:=ref->>'accountId';
   select x into a from jsonb_array_elements(s->'accounts') x where x->>'id'=account_id;
   if l is null or a is null or account_id !~ '^\d{4}(\d{2}){1,3}$' or coalesce((a->>'cash')::boolean,false) or a->>'reportingCode' is null or a->>'reportingCode'=account_id
    or l->'resolvedPosting' is null then raise exception 'GROUP_BATCH_SOURCE_INVALID';end if;
   if account_id is distinct from l->'resolvedPosting'->>(case when (side='debit')=((l->>'recognitionSign')::integer=1) then 'creditAccountId' else 'debitAccountId' end) then raise exception 'GROUP_BATCH_SOURCE_INVALID';end if;
   if (e->>'kind'='INTERCOMPANY_BALANCE' and a->>'kind'<>case when side='debit' then 'LIABILITY' else 'ASSET' end)
    or (e->>'kind'='INTERCOMPANY_INCOME' and ((side='debit' and a->>'kind'<>'REVENUE') or (side='credit' and a->>'kind' not in('OPEX','COGS')))) then raise exception 'GROUP_BATCH_ACCOUNT_KIND_INVALID';end if;
   source_key:=(e->>'kind')||':'||member||':'||(ref->>'eventId')||':'||(ref->>'lineId')||':'||account_id;
   if source_key=any(seen) then raise exception 'GROUP_BATCH_DUPLICATE_SOURCE';end if;seen:=array_append(seen,source_key);
   account_key:='account:'||member||':'||account_id;
   select (x->>'closing')::numeric*case when side='debit' then -1 else 1 end into balance from jsonb_array_elements(trials->member::text->'trialBalance') x where x->>'accountId'=account_id;
   available:=balance-coalesce((used->>account_key)::numeric,0);
   if balance is null or amount>available or amount>(l->>'baseAmount')::numeric then raise exception 'GROUP_BATCH_SOURCE_AMOUNT_EXCEEDED';end if;
   used:=jsonb_set(used,array[account_key],to_jsonb(coalesce((used->>account_key)::numeric,0)+amount));
   if e->>'kind'='INTERCOMPANY_BALANCE' then
    oi:=private.financial_group_open_item(member,(ref->>'eventId')::uuid,case when side='debit' then 'PAYABLE' else 'RECEIVABLE' end,currency,p_to);
    open_key:='open:'||member||':'||(oi->>'obligationId');
    if amount+coalesce((used->>open_key)::numeric,0)>(oi->>'outstanding')::numeric then raise exception 'GROUP_BATCH_OPEN_ITEM_EXCEEDED';end if;
    used:=jsonb_set(used,array[open_key],to_jsonb(coalesce((used->>open_key)::numeric,0)+amount));
    open_items:=open_items||jsonb_build_array(oi||jsonb_build_object('organizationId',member,'entryId',e->>'id'));
   end if;
  end loop;
 end loop;
 return private.financial_group_canonical(jsonb_build_object('control',control,'sources',sources,'entries',p_entries,'documents',documents,'openItems',open_items,'currency',currency));
end $$;
revoke all on function private.financial_group_batch_evidence(uuid,date,date,jsonb,boolean) from public,anon,authenticated;

create table private.financial_group_elimination_batches (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique,
 root_organization_id uuid not null references public.organizations(id),
 period_from date not null,period_to date not null,version integer not null check(version>0),
 status text not null default 'DRAFT' check(status in('DRAFT','APPROVED','SUPERSEDED')),
 entries jsonb not null,evidence jsonb not null,reason text not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 approved_by uuid references auth.users(id),approved_at timestamptz,
 unique(root_organization_id,period_from,period_to,version),
 check(period_from<=period_to),check(jsonb_typeof(entries)='array'),
 check((status='DRAFT' and approved_by is null and approved_at is null) or(status in('APPROVED','SUPERSEDED') and approved_by is not null and approved_at is not null))
);
create unique index financial_group_batch_approved_period on private.financial_group_elimination_batches(root_organization_id,period_from,period_to) where status='APPROVED';
create table private.financial_group_elimination_audit (
 id bigint generated always as identity primary key,batch_id uuid not null references private.financial_group_elimination_batches(id),
 actor_id uuid not null references auth.users(id),action text not null check(action in('SAVE','APPROVE','SUPERSEDE')),
 reason text not null,created_at timestamptz not null default now()
);
alter table private.financial_group_elimination_batches enable row level security;
alter table private.financial_group_elimination_audit enable row level security;
revoke all on private.financial_group_elimination_batches,private.financial_group_elimination_audit from public,anon,authenticated;

create function public.save_financial_group_eliminations(p_root uuid,p_from date,p_to date,p_expected_version integer,p_entries jsonb,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare evidence jsonb;item private.financial_group_elimination_batches%rowtype;latest integer;result uuid;
begin
 if auth.uid() is null or p_request_id is null or p_expected_version is null or p_expected_version<0
  or length(trim(coalesce(p_reason,''))) not between 8 and 1000 or length(p_entries::text)>200000 then raise exception 'GROUP_BATCH_INPUT_INVALID';end if;
 evidence:=private.financial_group_batch_evidence(p_root,p_from,p_to,p_entries);
 perform pg_advisory_xact_lock(hashtextextended('group-batch-request:'||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('group-batch-period:'||p_root||':'||p_from||':'||p_to,0));
 select * into item from private.financial_group_elimination_batches where request_id=p_request_id;
 if item.id is not null then
  if item.created_by<>auth.uid() or item.root_organization_id<>p_root or item.period_from<>p_from or item.period_to<>p_to
   or item.entries<>p_entries or item.reason<>trim(p_reason) then raise exception 'GROUP_BATCH_REQUEST_CONFLICT';end if;
  return jsonb_build_object('id',item.id,'version',item.version,'status',item.status);
 end if;
 select coalesce(max(version),0) into latest from private.financial_group_elimination_batches where root_organization_id=p_root and period_from=p_from and period_to=p_to;
 if latest<>p_expected_version then raise exception 'GROUP_BATCH_VERSION_CONFLICT';end if;
 insert into private.financial_group_elimination_batches(request_id,root_organization_id,period_from,period_to,version,entries,evidence,reason,created_by)
 values(p_request_id,p_root,p_from,p_to,latest+1,p_entries,evidence,trim(p_reason),auth.uid()) returning id into result;
 insert into private.financial_group_elimination_audit(batch_id,actor_id,action,reason) values(result,auth.uid(),'SAVE',trim(p_reason));
 return jsonb_build_object('id',result,'version',latest+1,'status','DRAFT');
end $$;

create function public.approve_financial_group_eliminations(p_batch uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item private.financial_group_elimination_batches%rowtype;member uuid;current_evidence jsonb;prior uuid;
begin
 if auth.uid() is null then raise exception 'GROUP_BATCH_APPROVAL_DENIED';end if;
 select * into item from private.financial_group_elimination_batches where id=p_batch;
 if item.id is null then raise exception 'GROUP_BATCH_APPROVAL_DENIED';end if;
 for member in select value::uuid from jsonb_array_elements_text(item.evidence#>'{control,expectedOrganizationIds}') loop
  if not private.financial_opening_can(member,'financial_core.approve') or not public.is_organization_admin(member) then raise exception 'GROUP_BATCH_APPROVAL_DENIED';end if;
  if item.created_by=auth.uid() and not public.can_self_approve_financial_event(member) then raise exception 'GROUP_BATCH_SELF_APPROVAL_DENIED';end if;
 end loop;
 if p_expected_version is null or length(trim(coalesce(p_reason,''))) not between 8 and 1000 then raise exception 'GROUP_BATCH_INPUT_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('group-batch-period:'||item.root_organization_id||':'||item.period_from||':'||item.period_to,0));
 select * into item from private.financial_group_elimination_batches where id=p_batch for update;
 if item.status<>'DRAFT' or item.version<>p_expected_version or item.version<>(select max(version) from private.financial_group_elimination_batches where root_organization_id=item.root_organization_id and period_from=item.period_from and period_to=item.period_to) then raise exception 'GROUP_BATCH_VERSION_CONFLICT';end if;
 current_evidence:=private.financial_group_batch_evidence(item.root_organization_id,item.period_from,item.period_to,item.entries);
 if current_evidence<>item.evidence then raise exception 'GROUP_BATCH_SOURCE_CHANGED';end if;
 for prior in select id from private.financial_group_elimination_batches where root_organization_id=item.root_organization_id and period_from=item.period_from and period_to=item.period_to and status='APPROVED' for update loop
  update private.financial_group_elimination_batches set status='SUPERSEDED' where id=prior;
  insert into private.financial_group_elimination_audit(batch_id,actor_id,action,reason) values(prior,auth.uid(),'SUPERSEDE',trim(p_reason));
 end loop;
 update private.financial_group_elimination_batches set status='APPROVED',approved_by=auth.uid(),approved_at=now() where id=p_batch;
 insert into private.financial_group_elimination_audit(batch_id,actor_id,action,reason) values(p_batch,auth.uid(),'APPROVE',trim(p_reason));
 return jsonb_build_object('id',item.id,'version',item.version,'status','APPROVED');
end $$;

-- Evidence inventory, NOT a final statement. A reporting consumer must still
-- verify current registry, original sources, documents and open-item balances.
create function public.financial_group_elimination_context(p_root uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare control jsonb;item private.financial_group_elimination_batches%rowtype;result jsonb:='[]';member uuid;
begin
 control:=public.financial_group_registered_scope(p_root,p_from,p_to);
 for item in select * from private.financial_group_elimination_batches where root_organization_id=p_root and period_from=p_from and period_to=p_to order by (status='APPROVED') desc,version desc limit 50 loop
  for member in select value::uuid from jsonb_array_elements_text(item.evidence#>'{control,expectedOrganizationIds}') loop
   if not private.financial_opening_can(member,'financial_core.view') then raise exception 'GROUP_BATCH_READ_DENIED';end if;
  end loop;
  result:=result||jsonb_build_array(to_jsonb(item)-'request_id');
 end loop;
 return jsonb_build_object('status','GROUP_ELIMINATION_EVIDENCE_ONLY','control',control,'batches',result);
end $$;
revoke all on function public.save_financial_group_eliminations(uuid,date,date,integer,jsonb,text,uuid),public.approve_financial_group_eliminations(uuid,integer,text),public.financial_group_elimination_context(uuid,date,date) from public,anon,authenticated;
grant execute on function public.save_financial_group_eliminations(uuid,date,date,integer,jsonb,text,uuid),public.approve_financial_group_eliminations(uuid,integer,text),public.financial_group_elimination_context(uuid,date,date) to authenticated;

-- Revalidate an approved batch against current evidence in one database call.
-- This authorizes readers independently from administrators who save batches.
create function public.financial_group_approved_eliminations(p_root uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare control jsonb;item private.financial_group_elimination_batches%rowtype;current_evidence jsonb;
begin
 control:=public.financial_group_registered_scope(p_root,p_from,p_to);
 perform pg_advisory_xact_lock(hashtextextended('group-batch-period:'||p_root||':'||p_from||':'||p_to,0));
 select * into item from private.financial_group_elimination_batches where root_organization_id=p_root and period_from=p_from and period_to=p_to and status='APPROVED';
 if item.id is null then raise exception 'GROUP_BATCH_APPROVAL_REQUIRED';end if;
 current_evidence:=private.financial_group_batch_evidence(p_root,p_from,p_to,item.entries,true);
 if current_evidence<>item.evidence then raise exception 'GROUP_BATCH_SOURCE_CHANGED';end if;
 return jsonb_build_object('status','APPROVED_GROUP_ELIMINATION_EVIDENCE','id',item.id,'version',item.version,
  'rootOrganizationId',p_root,'from',p_from,'to',p_to,'entries',item.entries,
  'approvedBy',item.approved_by,'approvedAt',item.approved_at,'evidenceFingerprint',md5(current_evidence::text));
end $$;
revoke all on function public.financial_group_approved_eliminations(uuid,date,date) from public,anon,authenticated;
grant execute on function public.financial_group_approved_eliminations(uuid,date,date) to authenticated;
