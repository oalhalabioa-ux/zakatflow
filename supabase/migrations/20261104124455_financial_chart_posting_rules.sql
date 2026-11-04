-- Phase 2a: optional organization-specific leaf accounts in *new* approved
-- posting policies. Amounts still originate exclusively from canonical events;
-- opening vouchers and historical approved policies remain on their original codes.
create function public.financial_chart_posting_accounts(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'CHART_ACCESS_DENIED';end if;
 select coalesce(jsonb_agg(a order by a->>'code'),'[]'::jsonb) into result from (
  -- Keep existing control-account JSON byte-for-byte compatible with earlier
  -- approved statement snapshots. Only new leaf accounts add hierarchy fields.
  select r a
  from jsonb_array_elements(public.financial_reporting_chart()) r
  union all
  select jsonb_build_object('id',c.code,'code',c.code,'ar',c.name_ar,'en',c.name_en,
   'kind',root.r->>'kind','cash',(root.r->>'cash')::boolean,
   'presentation',root.r->>'presentation','reportingCode',c.reporting_code,
   'parentCode',c.parent_code,'isSystem',false,'isPostable',true,'isActive',true)
  from public.financial_chart_custom_accounts c
  cross join lateral (select r from jsonb_array_elements(public.financial_reporting_chart()) r
    where r->>'code'=c.reporting_code) root
  where c.organization_id=p_org and c.is_active and c.is_postable
 ) chart;
 return result;
end $$;
revoke all on function public.financial_chart_posting_accounts(uuid) from public,anon;
grant execute on function public.financial_chart_posting_accounts(uuid) to authenticated;

-- Referenced leaf accounts may be renamed, but their accounting nature and
-- ability to receive journals cannot silently change while policies use them.
create function private.financial_chart_guard_policy_reference()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (old.normal_side is distinct from new.normal_side
     or (old.is_active and not new.is_active)
     or (old.is_postable and not new.is_postable))
  and exists(
   select 1 from public.financial_reporting_policies p
   where p.organization_id=old.organization_id and p.status in('DRAFT','APPROVED')
     and exists(select 1 from jsonb_array_elements(p.rules) r
      where r->>'debitAccountId'=old.code or r->>'creditAccountId'=old.code)
  ) then raise exception 'CHART_REFERENCED_BY_POLICY';end if;
 return new;
end $$;
create trigger financial_chart_guard_policy_reference before update on public.financial_chart_custom_accounts
 for each row execute function private.financial_chart_guard_policy_reference();

create or replace function public.financial_reporting_policy_workspace(p_org uuid,p_fiscal_start date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;pol jsonb;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'REPORTING_ACCESS_DENIED';end if;
 select to_jsonb(p) into pol from public.financial_reporting_policies p where organization_id=p_org and fiscal_start=p_fiscal_start and status in('DRAFT','APPROVED') order by case when status='DRAFT' then 0 else 1 end limit 1;
 result:=private.financial_reporting_events(p_org,p_fiscal_start,(p_fiscal_start+interval '1 year'-interval '1 day')::date);
 return jsonb_build_object('organizationId',p_org,'fiscalStart',p_fiscal_start,
  'chart',public.financial_chart_posting_accounts(p_org),'policy',pol,'events',result,
  'canSave',private.financial_opening_can(p_org,'financial_core.create'),
  'canApprove',private.financial_opening_can(p_org,'financial_core.approve') and private.financial_opening_can(p_org,'financial_core.post'));
end $$;

create or replace function public.save_financial_reporting_policy(p_org uuid,p_fiscal_start date,p_expected_version integer,p_rules jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pol public.financial_reporting_policies%rowtype;rule jsonb;base text;chart jsonb;
begin
 if not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'REPORTING_SAVE_DENIED';end if;
 if p_fiscal_start is null or p_expected_version is null or p_expected_version<0 or jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules)>5000 or length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'REPORTING_POLICY_INVALID';end if;
 chart:=public.financial_chart_posting_accounts(p_org);
 for rule in select * from jsonb_array_elements(p_rules) loop
  if jsonb_typeof(rule) is distinct from 'object' or exists(select 1 from jsonb_object_keys(rule) k where k not in('eventType','sourceModule','classificationId','cashDirection','debitAccountId','creditAccountId','cashActivity'))
   or nullif(rule->>'eventType','') is null or nullif(rule->>'sourceModule','') is null or nullif(rule->>'classificationId','') is null
   or coalesce(rule->>'cashDirection','') not in('NON_CASH','INFLOW','OUTFLOW')
   or not exists(select 1 from jsonb_array_elements(chart) a where a->>'id'=rule->>'debitAccountId')
   or not exists(select 1 from jsonb_array_elements(chart) a where a->>'id'=rule->>'creditAccountId')
   or rule->>'debitAccountId'=rule->>'creditAccountId'
   or rule->>'cashActivity' is not null and rule->>'cashActivity' not in('OPERATING','INVESTING','FINANCING')
  then raise exception 'REPORTING_POLICY_INVALID';end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_rules) r group by r->>'eventType',r->>'sourceModule',r->>'classificationId',r->>'cashDirection' having count(*)>1) then raise exception 'REPORTING_POLICY_DUPLICATE';end if;
 perform pg_advisory_xact_lock(hashtextextended('reporting-policy:'||p_org::text||p_fiscal_start::text,0));
 select * into pol from public.financial_reporting_policies where organization_id=p_org and fiscal_start=p_fiscal_start and status='DRAFT' for update;
 if coalesce(pol.version,0)<>p_expected_version then raise exception 'REPORTING_VERSION_CONFLICT';end if;
 select base_currency into base from public.organizations where id=p_org;
 if pol.id is null then
  insert into public.financial_reporting_policies(organization_id,fiscal_start,fiscal_end,currency,rules,reason,created_by,updated_by)
  values(p_org,p_fiscal_start,(p_fiscal_start+interval '1 year'-interval '1 day')::date,base,p_rules,p_reason,auth.uid(),auth.uid()) returning * into pol;
 else
  update public.financial_reporting_policies set rules=p_rules,reason=p_reason,version=version+1,updated_by=auth.uid(),updated_at=now() where id=pol.id returning * into pol;
 end if;
 insert into public.financial_reporting_policy_audit(organization_id,policy_id,actor_id,action,version,detail) values(p_org,pol.id,auth.uid(),'SAVE',pol.version,to_jsonb(pol));
 return to_jsonb(pol);
end $$;

-- The approved-opening trial balance stays on canonical control codes for now.
-- New event journals may target a leaf, with its kind/cash/reporting hierarchy
-- inherited from the same immutable control account as all other statements.
create or replace function public.financial_statement_live_snapshot(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.financial_opening_workspaces%rowtype;pol public.financial_reporting_policies%rowtype;s jsonb;events jsonb;accounts jsonb;rules jsonb;opening jsonb;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'REPORTING_ACCESS_DENIED';end if;
 if p_from is null or p_to is null or p_from>p_to then raise exception 'REPORTING_PERIOD_INVALID';end if;
 select * into w from public.financial_opening_workspaces where organization_id=p_org and status='APPROVED' and fiscal_start<=p_from and p_to<(fiscal_start+interval '1 year') order by fiscal_start desc limit 1;
 if w.id is null then raise exception 'REPORTING_APPROVED_OPENING_REQUIRED';end if;
 s:=private.financial_opening_sources(p_org,w.fiscal_start-1);
 if s->>'financialRevision' is distinct from w.financial_revision then raise exception 'REPORTING_HISTORICAL_SOURCE_CHANGED';end if;
 select * into pol from public.financial_reporting_policies where organization_id=p_org and status='APPROVED' and fiscal_start=w.fiscal_start;
 if pol.id is null then raise exception 'REPORTING_APPROVED_POLICY_REQUIRED';end if;
 events:=private.financial_reporting_events(p_org,w.fiscal_start,pol.fiscal_end);
 -- Catalog edits must never rewrite prior certified statements. Only leaves
 -- referenced by this fiscal period's approved policy belong to its ledger.
 select jsonb_agg(a||jsonb_build_object('organizationId',p_org,'currency',w.currency)) into accounts
  from jsonb_array_elements(public.financial_chart_posting_accounts(p_org)) a
  where length(a->>'code')=4 or exists(
   select 1 from jsonb_array_elements(pol.rules) rule
   where rule->>'debitAccountId'=a->>'id' or rule->>'creditAccountId'=a->>'id');
 select jsonb_agg(jsonb_build_object('accountId',code,'debit',greatest(amount,0)::numeric(24,4)::text,'credit',greatest(-amount,0)::numeric(24,4)::text)) into opening from
  (select r->>'accountCode' code,sum((r->>'debit')::numeric-(r->>'credit')::numeric) amount from jsonb_array_elements(w.approved_opening) r group by r->>'accountCode') t;
 select coalesce(jsonb_agg(r||jsonb_build_object('id',pol.id::text||':'||ord,'organizationId',p_org,'currency',pol.currency,'from',pol.fiscal_start,'to',pol.fiscal_end)),'[]'::jsonb) into rules from jsonb_array_elements(pol.rules) with ordinality x(r,ord);
 return jsonb_build_object('origin','LIVE_CANONICAL_EVENTS','organizationId',p_org,'currency',w.currency,'openingDate',w.fiscal_start-1,'fiscalStart',w.fiscal_start,'from',p_from,'to',p_to,'openingSourceId',w.id,
  'accounts',accounts,'opening',opening,'policy',jsonb_build_object('id',pol.id,'organizationId',p_org,'currency',pol.currency,'approvedBy',pol.approved_by,'approvedAt',pol.approved_at,'rules',rules),'events',events,
  'coverage',jsonb_build_object('complete',true,'scope','ORGANIZATION_ALL_ENTITIES','eventCount',jsonb_array_length(events),'lineCount',(select coalesce(sum(jsonb_array_length(e->'lines')),0) from jsonb_array_elements(events) e),'readAt',statement_timestamp()));
end $$;

create or replace function public.financial_chart_workspace(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb;custom jsonb;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'CHART_ACCESS_DENIED';end if;
 select coalesce(jsonb_agg(a||jsonb_build_object('organizationId',p_org,'parentCode',null,'reportingCode',a->>'code',
  'normalSide',case when a->>'code'='1590' or a->>'kind' in ('LIABILITY','EQUITY','REVENUE') then 'CREDIT' else 'DEBIT' end,
  'isSystem',true,'isActive',true,'isPostable',true,'version',0) order by a->>'code'),'[]'::jsonb)
 into base from jsonb_array_elements(public.financial_reporting_chart()) a;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',c.id,'code',c.code,'parentCode',c.parent_code,'reportingCode',c.reporting_code,
  'ar',c.name_ar,'en',c.name_en,'kind',r->>'kind','presentation',r->>'presentation',
  'normalSide',c.normal_side,'isSystem',false,'isActive',c.is_active,
  'isPostable',c.is_postable,'version',c.version) order by c.code),'[]'::jsonb)
 into custom from public.financial_chart_custom_accounts c
 cross join lateral (select a from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'code'=c.reporting_code) root(r)
 where c.organization_id=p_org;
 return jsonb_build_object('organizationId',p_org,'accounts',base||custom,
  'canManage',private.financial_opening_can(p_org,'financial_core.create'),
  'postingIntegration','POLICY_RULES_ONLY');
end $$;
notify pgrst,'reload schema';
