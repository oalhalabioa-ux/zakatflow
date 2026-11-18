-- Rehearse only in disposable database until native cash approval passes.
begin;
create or replace function private.financial_group_batch_evidence(p_root uuid,p_from date,p_to date,p_entries jsonb,p_reporting boolean default false)
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
   or coalesce(e->>'kind','') not in('INTERCOMPANY_BALANCE','INTERCOMPANY_INCOME','INTERCOMPANY_CASH')
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
    or (e->>'kind' in('INTERCOMPANY_INCOME','INTERCOMPANY_CASH') and (ev->>'date')::date<p_from) then raise exception 'GROUP_BATCH_SOURCE_INVALID';end if;
   select x into l from jsonb_array_elements(ev->'lines') x where x->>'id'=ref->>'lineId';
   account_id:=ref->>'accountId';
   select x into a from jsonb_array_elements(s->'accounts') x where x->>'id'=account_id;
   if l is null or a is null or account_id !~ '^\d{4}(\d{2}){1,3}$' or coalesce((a->>'cash')::boolean,false)<>(e->>'kind'='INTERCOMPANY_CASH') or a->>'reportingCode' is null or a->>'reportingCode'=account_id
    or l->'resolvedPosting' is null then raise exception 'GROUP_BATCH_SOURCE_INVALID';end if;
   if account_id is distinct from l->'resolvedPosting'->>(case when (side='debit')=((l->>'recognitionSign')::integer=1) then 'creditAccountId' else 'debitAccountId' end) then raise exception 'GROUP_BATCH_SOURCE_INVALID';end if;
   if (e->>'kind'='INTERCOMPANY_BALANCE' and a->>'kind'<>case when side='debit' then 'LIABILITY' else 'ASSET' end)
    or (e->>'kind'='INTERCOMPANY_INCOME' and ((side='debit' and a->>'kind'<>'REVENUE') or (side='credit' and a->>'kind' not in('OPEX','COGS')))) then raise exception 'GROUP_BATCH_ACCOUNT_KIND_INVALID';end if;
   if e->>'kind'='INTERCOMPANY_CASH' then
    if coalesce(l->'resolvedPosting'->>'cashActivity','') not in('OPERATING','INVESTING','FINANCING')
     or l->>'cashDirection' not in('INFLOW','OUTFLOW')
     or exists(select 1 from jsonb_array_elements(s->'accounts') x where x->>'id'=l->'resolvedPosting'->>(case when account_id=l->'resolvedPosting'->>'debitAccountId' then 'creditAccountId' else 'debitAccountId' end) and coalesce((x->>'cash')::boolean,false))
    then raise exception 'GROUP_BATCH_CASH_SOURCE_INVALID';end if;
   end if;
   source_key:=(e->>'kind')||':'||member||':'||(ref->>'eventId')||':'||(ref->>'lineId')||':'||account_id;
   if source_key=any(seen) then raise exception 'GROUP_BATCH_DUPLICATE_SOURCE';end if;seen:=array_append(seen,source_key);
   if amount>(l->>'baseAmount')::numeric then raise exception 'GROUP_BATCH_SOURCE_AMOUNT_EXCEEDED';end if;
   if e->>'kind'<>'INTERCOMPANY_CASH' then
   account_key:='account:'||member||':'||account_id;
   select (x->>'closing')::numeric*case when side='debit' then -1 else 1 end into balance from jsonb_array_elements(trials->member::text->'trialBalance') x where x->>'accountId'=account_id;
   available:=balance-coalesce((used->>account_key)::numeric,0);
   if balance is null or amount>available or amount>(l->>'baseAmount')::numeric then raise exception 'GROUP_BATCH_SOURCE_AMOUNT_EXCEEDED';end if;
   used:=jsonb_set(used,array[account_key],to_jsonb(coalesce((used->>account_key)::numeric,0)+amount));
   end if;
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


commit;
