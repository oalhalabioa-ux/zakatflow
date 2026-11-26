-- Tenant-scoped sources for Work 03. The existing V2 ledger remains authoritative.
create table public.organization_reporting_fx_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  from_currency text not null references public.currencies(code),
  to_currency text not null references public.currencies(code),
  purpose text not null check (purpose in ('CLOSING','TRANSACTION','PRIOR_CLOSING')),
  period_start date not null,
  period_end date not null check (period_end>=period_start),
  source text not null check (length(source) between 1 and 160),
  quote_scope text not null check (quote_scope in ('ORGANIZATION','PUBLISHED')),
  selection_basis text not null check (selection_basis in ('EXACT_DATE','LATEST_ON_OR_BEFORE')),
  allow_inverse boolean not null,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  reason text not null check (length(reason) between 3 and 500),
  check (from_currency<>to_currency),
  unique (organization_id,from_currency,to_currency,purpose,period_start)
);
alter table public.organization_reporting_fx_policies enable row level security;
revoke all on public.organization_reporting_fx_policies from public,anon,authenticated;
grant select on public.organization_reporting_fx_policies to authenticated;
create policy org_reporting_fx_policy_read on public.organization_reporting_fx_policies
 for select to authenticated using (public.financial_core_can(organization_id,'financial_core.view'));

create function public.approve_organization_reporting_fx_policy(p_org uuid,p_pair_from text,p_pair_to text,
 p_purpose text,p_start date,p_end date,p_source text,p_quote_scope text,p_basis text,p_inverse boolean,p_reason text)
returns public.organization_reporting_fx_policies language plpgsql security definer set search_path='' as $$
declare result public.organization_reporting_fx_policies%rowtype;
begin
 if auth.uid() is null or not public.financial_core_can(p_org,'financial_core.approve')
   or not public.financial_core_can(p_org,'financial_core.post') then
  raise exception 'REPORTING_FX_POLICY_DENIED';
 end if;
 if p_pair_from is null or p_pair_to is null or p_purpose is null or p_start is null or p_end is null
   or p_start>p_end or p_pair_from=p_pair_to then raise exception 'REPORTING_FX_POLICY_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','reporting-fx',p_org,p_pair_from,p_pair_to,p_purpose),0));
 select * into result from public.organization_reporting_fx_policies
  where organization_id=p_org and from_currency=p_pair_from and to_currency=p_pair_to and purpose=p_purpose
    and period_start=p_start and period_end=p_end;
 if found then
  if (result.source,result.quote_scope,result.selection_basis,result.allow_inverse)
    is distinct from (btrim(p_source),p_quote_scope,p_basis,p_inverse) then
    raise exception 'REPORTING_FX_POLICY_IMMUTABLE';
  end if;
  return result;
 end if;
 if exists(select 1 from public.organization_reporting_fx_policies
   where organization_id=p_org and from_currency=p_pair_from and to_currency=p_pair_to and purpose=p_purpose
     and period_start<=p_end and period_end>=p_start) then raise exception 'REPORTING_FX_POLICY_OVERLAP'; end if;
 insert into public.organization_reporting_fx_policies(organization_id,from_currency,to_currency,purpose,period_start,period_end,
   source,quote_scope,selection_basis,allow_inverse,approved_by,reason)
 values(p_org,p_pair_from,p_pair_to,p_purpose,p_start,p_end,btrim(p_source),p_quote_scope,p_basis,p_inverse,auth.uid(),btrim(p_reason))
 returning * into result;
 return result;
end $$;
revoke all on function public.approve_organization_reporting_fx_policy(uuid,text,text,text,date,date,text,text,text,boolean,text) from public,anon;
grant execute on function public.approve_organization_reporting_fx_policy(uuid,text,text,text,date,date,text,text,text,boolean,text) to authenticated;

create function public.resolve_organization_reporting_fx(p_org uuid,p_pair_from text,p_pair_to text,p_purpose text,p_as_of date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare policy public.organization_reporting_fx_policies%rowtype;
 quote public.fx_rates%rowtype; quote_date date; matches integer;
begin
 if auth.uid() is null or not public.financial_core_can(p_org,'financial_core.view') then
  raise exception 'REPORTING_FX_POLICY_DENIED';
 end if;
 select * into policy from public.organization_reporting_fx_policies
 where organization_id=p_org and from_currency=p_pair_from and to_currency=p_pair_to and purpose=p_purpose
   and p_as_of between period_start and period_end;
 if not found then raise exception 'REPORTING_FX_POLICY_MISSING'; end if;
 select max(r.valuation_date) into quote_date from public.fx_rates r
 where r.organization_id is not distinct from case when policy.quote_scope='ORGANIZATION' then p_org else null end
   and r.source=policy.source and r.rate>0 and r.rate<'Infinity'::numeric
   and r.valuation_date<=p_as_of and (policy.selection_basis<>'EXACT_DATE' or r.valuation_date=p_as_of)
   and ((r.from_currency=p_pair_from and r.to_currency=p_pair_to)
     or (policy.allow_inverse and r.from_currency=p_pair_to and r.to_currency=p_pair_from));
 if quote_date is null then raise exception 'REPORTING_FX_QUOTE_MISSING'; end if;
 select count(*) into matches from public.fx_rates r
 where r.organization_id is not distinct from case when policy.quote_scope='ORGANIZATION' then p_org else null end
   and r.source=policy.source and r.valuation_date=quote_date and r.rate>0 and r.rate<'Infinity'::numeric
   and ((r.from_currency=p_pair_from and r.to_currency=p_pair_to)
     or (policy.allow_inverse and r.from_currency=p_pair_to and r.to_currency=p_pair_from));
 if matches<>1 then raise exception 'REPORTING_FX_QUOTE_AMBIGUOUS'; end if;
 select * into strict quote from public.fx_rates r
 where r.organization_id is not distinct from case when policy.quote_scope='ORGANIZATION' then p_org else null end
   and r.source=policy.source and r.valuation_date=quote_date and r.rate>0 and r.rate<'Infinity'::numeric
   and ((r.from_currency=p_pair_from and r.to_currency=p_pair_to)
     or (policy.allow_inverse and r.from_currency=p_pair_to and r.to_currency=p_pair_from));
 return jsonb_build_object('policy',to_jsonb(policy),'quoteId',quote.id,'quoteDate',quote.valuation_date,
   'quoteFrom',quote.from_currency,'quoteTo',quote.to_currency,'rate',
   case when quote.from_currency=p_pair_from then quote.rate::text else (1::numeric/quote.rate)::text end,'asOf',p_as_of);
end $$;
revoke all on function public.resolve_organization_reporting_fx(uuid,text,text,text,date) from public,anon;
grant execute on function public.resolve_organization_reporting_fx(uuid,text,text,text,date) to authenticated;

create table public.financial_fx_revaluation_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  journal_id uuid not null,
  line_id uuid not null,
  obligation_id uuid not null,
  document_module text not null,
  document_id uuid not null,
  debt_account_id text not null,
  debt_side text not null check(debt_side in ('DEBIT','CREDIT')),
  offset_account_id text not null,
  posting_rule_id text not null,
  cutoff date not null,
  posted_base_amount numeric(24,4) not null check(posted_base_amount>0),
  quote_evidence jsonb not null,
  bound_by uuid not null references auth.users(id),
  bound_at timestamptz not null default now(),
  foreign key (journal_id,organization_id) references public.financial_events(id,organization_id),
  foreign key (line_id,organization_id) references public.financial_event_lines(id,organization_id),
  foreign key (obligation_id,organization_id) references public.financial_event_obligations(id,organization_id),
  unique (organization_id,line_id),
  unique (organization_id,obligation_id,cutoff),
  check(debt_account_id<>offset_account_id)
);
alter table public.financial_fx_revaluation_evidence enable row level security;
revoke all on public.financial_fx_revaluation_evidence from public,anon,authenticated;
grant select on public.financial_fx_revaluation_evidence to authenticated;
create policy fx_revaluation_evidence_read on public.financial_fx_revaluation_evidence
 for select to authenticated using (public.financial_core_can(organization_id,'financial_core.view'));

-- Bind an already posted, standalone non-cash V2 journal. This command never posts or settles a debt.
create function public.bind_financial_fx_revaluation(p_org uuid,p_journal uuid,p_line uuid,p_obligation uuid,p_cutoff date,p_debt_account text)
returns public.financial_fx_revaluation_evidence language plpgsql security definer set search_path='' as $$
declare
 journal public.financial_events%rowtype; document public.financial_events%rowtype;
 line public.financial_event_lines%rowtype; debt public.financial_event_obligations%rowtype;
 result public.financial_fx_revaluation_evidence%rowtype;
 snapshot jsonb; entry jsonb; posting jsonb; candidate jsonb; account jsonb;
 quote jsonb; target text; offset_id text;
begin
 if auth.uid() is null or not public.financial_core_can(p_org,'financial_core.approve')
   or not public.financial_core_can(p_org,'financial_core.post') then raise exception 'REPORTING_FX_BIND_DENIED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','reporting-fx-bind',p_org,p_obligation,p_cutoff),0));
 select * into result from public.financial_fx_revaluation_evidence
 where organization_id=p_org and obligation_id=p_obligation and cutoff=p_cutoff;
 if found then
  if (result.journal_id,result.line_id,result.debt_account_id) is distinct from (p_journal,p_line,p_debt_account)
    then raise exception 'REPORTING_FX_BIND_CONFLICT'; end if;
  return result;
 end if;
 select * into strict journal from public.financial_events where id=p_journal and organization_id=p_org;
 select * into strict line from public.financial_event_lines where id=p_line and event_id=p_journal and organization_id=p_org;
 select * into strict debt from public.financial_event_obligations where id=p_obligation and organization_id=p_org;
 select * into strict document from public.financial_events where id=debt.event_id and organization_id=p_org;
 if journal.status<>'ACTUAL' or journal.event_type<>'ADJUSTMENT' or journal.source_module<>'FX_REVALUATION'
   or journal.event_date is distinct from p_cutoff or line.cash_direction<>'NON_CASH' or line.vat_amount<>0
   or (select count(*) from public.financial_event_lines where event_id=p_journal)<>1
   or exists(select 1 from public.financial_event_obligations where event_id=p_journal)
   or not exists(select 1 from public.financial_event_links k where k.organization_id=p_org and k.event_id=p_journal
     and k.link_type='OTHER' and k.target_module='financial_event_obligations' and k.target_record_id=p_obligation)
   or debt.obligation_type not in ('RECEIVABLE','PAYABLE') or debt.currency=debt.base_currency
   or journal.base_currency<>debt.base_currency or line.currency<>debt.base_currency
   or document.status not in ('ACTUAL','REVERSED') or document.event_date>p_cutoff
   or document.source_record_id is null then raise exception 'REPORTING_FX_BIND_SOURCE_INVALID'; end if;
 select target_module into strict target from public.financial_event_links
 where organization_id=p_org and event_id=document.id and link_type='SOURCE'
   and target_record_id=document.source_record_id and target_module is not null;
 -- Use the posted journal in the approved fiscal snapshot, including its resolved posting rule.
 snapshot:=public.financial_statement_live_snapshot(p_org,p_cutoff,p_cutoff);
 select l into strict entry from jsonb_array_elements(snapshot->'events') e,
   lateral jsonb_array_elements(e->'lines') l
 where e->>'id'=p_journal::text and l->>'id'=p_line::text||':BASE';
 posting:=entry->'resolvedPosting';
 if posting is null then
  select r into strict candidate from jsonb_array_elements(snapshot->'policy'->'rules') r
   where r->>'eventType'='ADJUSTMENT' and r->>'sourceModule'='FX_REVALUATION'
     and r->>'classificationId'=entry->>'classificationId' and r->>'cashDirection'='NON_CASH'
     and p_cutoff between (r->>'from')::date and (r->>'to')::date;
  posting:=jsonb_set(candidate,'{ruleId}',candidate->'id');
 end if;
 if p_debt_account is null or p_debt_account not in (posting->>'debitAccountId',posting->>'creditAccountId')
  or posting->>'ruleId' is null then raise exception 'REPORTING_FX_BIND_ACCOUNT_INVALID'; end if;
 offset_id:=case when p_debt_account=posting->>'debitAccountId' then posting->>'creditAccountId' else posting->>'debitAccountId' end;
 select a into strict account from jsonb_array_elements(snapshot->'accounts') a where a->>'id'=p_debt_account;
 if coalesce((account->>'cash')::boolean,false) or
   account->>'kind' is distinct from (case when debt.obligation_type='RECEIVABLE' then 'ASSET' else 'LIABILITY' end)
   or not exists(select 1 from jsonb_array_elements(snapshot->'accounts') a
     where a->>'id'=offset_id and a->>'kind' in ('REVENUE','OPEX','FINANCE')) then
  raise exception 'REPORTING_FX_BIND_ACCOUNT_INVALID';
 end if;
 -- The debt account must also be a proved posting leg of the source document.
 if not exists(
  select 1 from jsonb_array_elements(snapshot->'events') e
   cross join lateral jsonb_array_elements(e->'lines') l
   cross join lateral (
    select coalesce(l->'resolvedPosting',(
     select r from jsonb_array_elements(snapshot->'policy'->'rules') r
      where r->>'eventType'=e->>'eventType' and r->>'sourceModule'=e->>'sourceModule'
        and r->>'classificationId'=l->>'classificationId' and r->>'cashDirection'=l->>'cashDirection'
        and (e->>'date')::date between (r->>'from')::date and (r->>'to')::date
    )) rule
   ) chosen
  where e->>'id'=document.id::text and p_debt_account=
   case when (debt.obligation_type='RECEIVABLE')=((l->>'recognitionSign')::int=1)
        then chosen.rule->>'debitAccountId' else chosen.rule->>'creditAccountId' end
 ) then raise exception 'REPORTING_FX_DOCUMENT_ACCOUNT_UNVERIFIED'; end if;
 quote:=public.resolve_organization_reporting_fx(p_org,debt.currency,debt.base_currency,'CLOSING',p_cutoff);
 insert into public.financial_fx_revaluation_evidence(organization_id,journal_id,line_id,obligation_id,document_module,
   document_id,debt_account_id,debt_side,offset_account_id,posting_rule_id,cutoff,posted_base_amount,quote_evidence,bound_by)
 values(p_org,p_journal,p_line,p_obligation,target,document.source_record_id,p_debt_account,
   case when (p_debt_account=posting->>'debitAccountId')=((entry->>'recognitionSign')::int=1) then 'DEBIT' else 'CREDIT' end,offset_id,
   posting->>'ruleId',p_cutoff,line.base_amount,quote,auth.uid()) returning * into result;
 return result;
end $$;
revoke all on function public.bind_financial_fx_revaluation(uuid,uuid,uuid,uuid,date,text) from public,anon;
grant execute on function public.bind_financial_fx_revaluation(uuid,uuid,uuid,uuid,date,text) to authenticated;

create function public.read_financial_fx_revaluation(p_org uuid,p_journal uuid,p_as_of date)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result public.financial_fx_revaluation_evidence%rowtype; reversal jsonb;
begin
 if auth.uid() is null or not public.financial_core_can(p_org,'financial_core.view') then raise exception 'REPORTING_FX_BIND_DENIED'; end if;
 select * into result from public.financial_fx_revaluation_evidence
   where organization_id=p_org and journal_id=p_journal and cutoff<=p_as_of;
 if not found then return null; end if;
 select jsonb_build_object('journalId',e.id,'lineId',l.id,'date',e.event_date,'baseAmount',l.base_amount::text)
 into reversal
 from public.financial_event_links k
 join public.financial_events e on e.id=k.event_id and e.organization_id=p_org
 join public.financial_event_lines l on l.event_id=e.id and l.organization_id=p_org
 where k.organization_id=p_org and k.link_type='REVERSAL_OF' and k.related_event_id=result.journal_id
   and e.status in ('ACTUAL','REVERSED') and e.event_type='REVERSAL'
   and e.event_date between result.cutoff and p_as_of and l.cash_direction='NON_CASH'
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
revoke all on function public.read_financial_fx_revaluation(uuid,uuid,date) from public,anon;
grant execute on function public.read_financial_fx_revaluation(uuid,uuid,date) to authenticated;

-- Explicit recognition on the owner's general personal document. A cash movement alone is unclassified.
create table public.personal_income_expense_documents (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 transaction_id uuid not null references public.transactions(id),
 kind text not null check (kind in ('INCOME','EXPENSE')),
 category_code text not null check (category_code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
 description text not null check(length(description) between 3 and 500),
 amount numeric(24,8) not null check(amount>0),
 currency text not null references public.currencies(code),
 base_amount numeric(24,8) not null check(base_amount>0),
 base_currency text not null references public.currencies(code),
 document_date date not null,
 recorded_at timestamptz not null default now(),
 unique(user_id,transaction_id)
);
alter table public.personal_income_expense_documents enable row level security;
revoke all on public.personal_income_expense_documents from public,anon,authenticated;
grant select on public.personal_income_expense_documents to authenticated;
create policy personal_income_expense_document_read on public.personal_income_expense_documents
 for select to authenticated using(user_id=(select auth.uid()));

create function public.classify_personal_income_expense(p_transaction uuid,p_kind text,p_code text,p_description text)
returns public.personal_income_expense_documents language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); movement public.transactions%rowtype; result public.personal_income_expense_documents%rowtype;
begin
 if actor is null then raise exception 'UNAUTHORIZED'; end if;
 select * into movement from public.transactions t where t.id=p_transaction and t.user_id=actor
   and t.organization_id is null for update;
 if not found then raise exception 'PERSONAL_CLASSIFICATION_SOURCE_DENIED'; end if;
 select * into result from public.personal_income_expense_documents where user_id=actor and transaction_id=p_transaction;
 if found then
  if (result.kind,result.category_code,result.description) is distinct from (p_kind,p_code,btrim(p_description))
    then raise exception 'PERSONAL_CLASSIFICATION_IMMUTABLE'; end if;
  return result;
 end if;
 if p_kind is null or p_kind not in ('INCOME','EXPENSE') or movement.transaction_type::text is distinct from
     (case when p_kind='INCOME' then 'ADD' else 'WITHDRAWAL' end)
    or movement.transfer_id is not null or movement.reversal_of_transaction_id is not null
    or (movement.metadata - array['fx_rate'])<>'{}'::jsonb
    or not exists(select 1 from public.asset_accounts a where a.id=movement.asset_account_id and a.user_id=actor
      and a.ownership_scope='PERSONAL' and a.organization_id is null and a.asset_type in ('CASH','BANK'))
    or exists(select 1 from public.transactions x where x.reversal_of_transaction_id=movement.id)
    then raise exception 'PERSONAL_CLASSIFICATION_SOURCE_UNSUPPORTED'; end if;
 insert into public.personal_income_expense_documents(user_id,transaction_id,kind,category_code,description,amount,currency,
  base_amount,base_currency,document_date)
 values(actor,movement.id,p_kind,p_code,btrim(p_description),movement.gross_value,movement.currency,
   movement.base_value,movement.base_currency,movement.transaction_date) returning * into result;
 return result;
end $$;
revoke all on function public.classify_personal_income_expense(uuid,text,text,text) from public,anon;
grant execute on function public.classify_personal_income_expense(uuid,text,text,text) to authenticated;

create function public.read_personal_income_expense(p_from date,p_to date)
returns table(document_id uuid,transaction_id uuid,kind text,category_code text,description text,entry_date date,
 amount text,currency text,base_amount text,base_currency text,is_reversal boolean)
language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
 if p_from is null or p_to is null or p_from>p_to then raise exception 'PERSONAL_CLASSIFICATION_PERIOD_INVALID'; end if;
 return query
 select d.id,d.transaction_id,d.kind,d.category_code,d.description,d.document_date,
   d.amount::text,d.currency,d.base_amount::text,d.base_currency,false
 from public.personal_income_expense_documents d where d.user_id=auth.uid() and d.document_date between p_from and p_to
 union all
 select d.id,r.id,d.kind,d.category_code,d.description,r.transaction_date,
   (-d.amount)::text,d.currency,(-d.base_amount)::text,d.base_currency,true
 from public.personal_income_expense_documents d join public.transactions r on r.reversal_of_transaction_id=d.transaction_id
 where d.user_id=auth.uid() and r.user_id=auth.uid() and r.organization_id is null and r.transaction_type='REVERSAL'
   and r.transaction_date between p_from and p_to
 order by 6,2;
end $$;
revoke all on function public.read_personal_income_expense(date,date) from public,anon;
grant execute on function public.read_personal_income_expense(date,date) to authenticated;

create function private.guard_personal_income_expense_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.personal_income_expense_documents where transaction_id=old.id) then
  if tg_op='DELETE' then raise exception 'PERSONAL_CLASSIFICATION_USE_REVERSAL'; end if;
  if (new.user_id,new.organization_id,new.asset_account_id,new.transaction_date,new.transaction_type,new.currency,
      new.gross_value,new.base_currency,new.base_value,new.transfer_id,new.metadata)
    is distinct from
     (old.user_id,old.organization_id,old.asset_account_id,old.transaction_date,old.transaction_type,old.currency,
      old.gross_value,old.base_currency,old.base_value,old.transfer_id,old.metadata) then
    raise exception 'PERSONAL_CLASSIFICATION_USE_REVERSAL';
  end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.guard_personal_income_expense_source() from public,anon,authenticated;
create trigger guard_personal_income_expense_source before update or delete on public.transactions
 for each row execute function private.guard_personal_income_expense_source();

-- Read only the supported V2 debt rows, with explicit gaps and no zero substitution.
create function public.read_personal_debts_at_cutoff(p_as_of date)
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
    when not coalesce(q.has_opening,false) or coalesce(q.invalid,false) then 'RECEIVABLE_SOURCE_UNVERIFIED'
    else null end gap,q.amount
   from public.asset_accounts a join public.profiles p on p.id=actor
   left join lateral (
    select bool_or(t.transaction_type='OPENING_BALANCE') has_opening,
     bool_or(t.base_currency<>p.base_currency or coalesce(t.metadata->>'asset_deleted','false')='true'
       or (t.transaction_type not in('OPENING_BALANCE','ADD','WITHDRAWAL','REVERSAL'))
       or (t.transaction_type='REVERSAL' and (original.id is null or original.transaction_date>t.transaction_date
        or original.base_currency<>t.base_currency or original.base_value<>t.base_value
        or original.transaction_type not in ('OPENING_BALANCE','ADD','WITHDRAWAL')))) invalid,
     sum(case when t.transaction_type='WITHDRAWAL' or (t.transaction_type='REVERSAL' and original.transaction_type<>'WITHDRAWAL')
       then -t.base_value else t.base_value end) amount
    from public.transactions t left join public.transactions original on original.id=t.reversal_of_transaction_id
      and original.user_id=actor and original.asset_account_id=a.id and original.organization_id is null
    where t.asset_account_id=a.id and t.user_id=actor and t.organization_id is null and t.transaction_date<=p_as_of
   ) q on true
   where a.user_id=actor and a.organization_id is null and a.ownership_scope='PERSONAL' and a.asset_type='RECEIVABLE'
    and (q.amount is not null or (a.created_at at time zone 'Asia/Riyadh')::date<=p_as_of)
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
revoke all on function public.read_personal_debts_at_cutoff(date) from public,anon;
grant execute on function public.read_personal_debts_at_cutoff(date) to authenticated;
