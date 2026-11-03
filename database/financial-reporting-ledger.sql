-- One reporting chart shared by opening and event projection. No stored running totals.
create or replace function public.financial_reporting_chart()
returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_agg(jsonb_build_object('id',code,'code',code,'ar',ar,'en',en,'kind',kind,'cash',cash,'presentation',presentation) order by code)
 from (values
 ('1000','النقد والبنوك','Cash & banks','ASSET',true,'CURRENT'),
 ('1100','الذمم المدينة','Trade receivables','ASSET',false,'CURRENT'),
 ('1200','قروض مدينة','Loans receivable','ASSET',false,'NON_CURRENT'),
 ('1300','السلف والدفعات المقدمة','Advances & prepayments','ASSET',false,'CURRENT'),
 ('1400','ضريبة مدخلات قابلة للاسترداد','Recoverable input VAT','ASSET',false,'CURRENT'),
 ('1500','الأصول الثابتة','Property & equipment','ASSET',false,'NON_CURRENT'),
 ('1590','مجمع الإهلاك','Accumulated depreciation','ASSET',false,'NON_CURRENT'),
 ('1600','الاستثمارات','Investments','ASSET',false,'NON_CURRENT'),
 ('1700','المخزون','Inventory','ASSET',false,'CURRENT'),
 ('1800','أصول متداولة أخرى','Other current assets','ASSET',false,'CURRENT'),
 ('2100','الذمم الدائنة','Trade payables','LIABILITY',false,'CURRENT'),
 ('2200','القروض الدائنة','Borrowings','LIABILITY',false,'NON_CURRENT'),
 ('2300','مصروفات والتزامات مستحقة','Accrued liabilities','LIABILITY',false,'CURRENT'),
 ('2400','دفعات مقدمة من العملاء','Customer advances','LIABILITY',false,'CURRENT'),
 ('2500','ضريبة المخرجات','Output VAT','LIABILITY',false,'CURRENT'),
 ('3100','رأس المال','Share capital','EQUITY',false,'OTHER'),
 ('3200','الاحتياطيات','Reserves','EQUITY',false,'OTHER'),
 ('3300','الأرباح المحتجزة','Retained earnings','EQUITY',false,'OTHER'),
 ('4100','الإيرادات','Revenue','REVENUE',false,'OTHER'),
 ('5100','تكلفة المبيعات','Cost of sales','COGS',false,'OTHER'),
 ('6100','المصروفات التشغيلية','Operating expenses','OPEX',false,'OTHER'),
 ('6200','مصروف الإهلاك','Depreciation expense','OPEX',false,'OTHER'),
 ('7100','تكاليف التمويل','Finance costs','FINANCE',false,'OTHER'),
 ('8100','الزكاة والضريبة','Zakat & income tax','TAX',false,'OTHER')
 ) a(code,ar,en,kind,cash,presentation)
$$;
revoke all on function public.financial_reporting_chart() from public,anon;
grant execute on function public.financial_reporting_chart() to authenticated;

create table public.financial_reporting_policies (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 fiscal_start date not null,fiscal_end date not null check(fiscal_end>=fiscal_start),currency text not null,
 rules jsonb not null,version integer not null default 1,status text not null default 'DRAFT' check(status in('DRAFT','APPROVED','SUPERSEDED')),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 approved_by uuid references auth.users(id),approved_at timestamptz,reason text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index reporting_policy_draft on public.financial_reporting_policies(organization_id,fiscal_start) where status='DRAFT';
create unique index reporting_policy_active on public.financial_reporting_policies(organization_id,fiscal_start) where status='APPROVED';
alter table public.financial_reporting_policies enable row level security;
create policy reporting_policy_read on public.financial_reporting_policies for select to authenticated using(private.financial_opening_can(organization_id,'financial_core.view'));
revoke all on public.financial_reporting_policies from public,anon,authenticated;
grant select on public.financial_reporting_policies to authenticated;
create table public.financial_reporting_policy_audit(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 policy_id uuid not null references public.financial_reporting_policies(id),actor_id uuid not null references auth.users(id),
 action text not null,version integer not null,detail jsonb not null,created_at timestamptz not null default now()
);
create index reporting_policy_audit_org on public.financial_reporting_policy_audit(organization_id,policy_id);
alter table public.financial_reporting_policy_audit enable row level security;
create policy reporting_policy_audit_read on public.financial_reporting_policy_audit for select to authenticated using(private.financial_opening_can(organization_id,'financial_core.view'));
revoke all on public.financial_reporting_policy_audit from public,anon,authenticated;
grant select on public.financial_reporting_policy_audit to authenticated;

-- Raw source lines carry amounts; rules carry only posting accounts, never amounts.
create or replace function private.financial_reporting_events(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if exists(select 1 from public.financial_events e join public.financial_event_lines l on l.event_id=e.id and l.organization_id=p_org
   where e.organization_id=p_org and e.status in('ACTUAL','REVERSED') and e.event_date between p_from and p_to
   and (l.vat_amount<>0 or l.base_amount<=0 or l.base_amount<>round(l.base_amount,4)
    or coalesce(l.metadata->>'recognition_sign','1') not in('1','-1')))
 then raise exception 'REPORTING_SOURCE_NORMALIZATION_REQUIRED';end if;
 with source as (
  select e.*,orig.id original_id,orig.event_date original_date,
   coalesce(orig.event_type,e.event_type) posting_type,coalesce(orig.source_module,e.source_module) posting_module
  from public.financial_events e left join public.financial_event_links rl on rl.event_id=e.id and rl.organization_id=p_org and rl.link_type='REVERSAL_OF'
   left join public.financial_events orig on orig.id=rl.related_event_id and orig.organization_id=p_org
  where e.organization_id=p_org and e.status in('ACTUAL','REVERSED') and e.event_date between p_from and p_to
 ), line_parts as (
  select l.*,coalesce(l.metadata->>'source_role','BASE') source_role,
   case when l.metadata->>'source_role'='INPUT_VAT' then coalesce(nullif(l.metadata->>'recoverable_percent','')::numeric,l.recoverable_percent,100) else 100 end recovery
  from public.financial_event_lines l join source e on e.id=l.event_id where l.organization_id=p_org
 ), normalized as (
  select l.*,v.part,v.amount part_amount from line_parts l cross join lateral (
    select case when l.source_role='INPUT_VAT' then 'INPUT_VAT_RECOVERABLE' else l.source_role end part,
      round(l.base_amount*l.recovery/100,4) amount
    union all select 'INPUT_VAT_NONRECOVERABLE',l.base_amount-round(l.base_amount*l.recovery/100,4) where l.source_role='INPUT_VAT' and l.recovery<100
  ) v where v.amount>0
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'organizationId',e.organization_id,'currency',e.base_currency,
  'date',e.event_date,'eventType',e.posting_type,'sourceModule',e.posting_module,'sourceKey',e.source_event_key,
  'status',e.status,'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id::text||':'||l.part,
    'classificationId',l.classification_id::text||':'||l.part,'baseAmount',l.part_amount::numeric(24,4)::text,
    'cashDirection',l.cash_direction,'recognitionSign',case when e.original_id is not null then -1 else coalesce((l.metadata->>'recognition_sign')::int,1) end) order by l.line_number,l.part)
    from normalized l where l.event_id=e.id),'[]'::jsonb))
    ||case when e.original_id is not null and e.original_date>=p_from then jsonb_build_object('reversesEventId',e.original_id) else '{}' end order by e.event_date,e.id),'[]'::jsonb)
 into result from source e;
 if jsonb_array_length(result)>10000 then raise exception 'REPORTING_SOURCE_TOO_LARGE';end if;
 return result||private.financial_reporting_legacy_events(p_org,p_from,p_to);
end $$;
revoke all on function private.financial_reporting_events(uuid,date,date) from public,anon,authenticated;

create or replace function public.financial_reporting_policy_workspace(p_org uuid,p_fiscal_start date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;pol jsonb;
begin
 if not private.financial_opening_can(p_org,'financial_core.view') then raise exception 'REPORTING_ACCESS_DENIED';end if;
 select to_jsonb(p) into pol from public.financial_reporting_policies p where organization_id=p_org and fiscal_start=p_fiscal_start and status in('DRAFT','APPROVED') order by case when status='DRAFT' then 0 else 1 end limit 1;
 result:=private.financial_reporting_events(p_org,p_fiscal_start,(p_fiscal_start+interval '1 year'-interval '1 day')::date);
 return jsonb_build_object('organizationId',p_org,'fiscalStart',p_fiscal_start,'chart',public.financial_reporting_chart(),'policy',pol,
  'events',result,'canSave',private.financial_opening_can(p_org,'financial_core.create'),'canApprove',private.financial_opening_can(p_org,'financial_core.approve') and private.financial_opening_can(p_org,'financial_core.post'));
end $$;
revoke all on function public.financial_reporting_policy_workspace(uuid,date) from public,anon;
grant execute on function public.financial_reporting_policy_workspace(uuid,date) to authenticated;

create or replace function public.save_financial_reporting_policy(p_org uuid,p_fiscal_start date,p_expected_version integer,p_rules jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pol public.financial_reporting_policies%rowtype;rule jsonb;base text;
begin
 if not private.financial_opening_can(p_org,'financial_core.create') then raise exception 'REPORTING_SAVE_DENIED';end if;
 if p_fiscal_start is null or p_expected_version is null or p_expected_version<0 or jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules)>5000 or length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'REPORTING_POLICY_INVALID';end if;
 for rule in select * from jsonb_array_elements(p_rules) loop
  if jsonb_typeof(rule) is distinct from 'object' or exists(select 1 from jsonb_object_keys(rule) k where k not in('eventType','sourceModule','classificationId','cashDirection','debitAccountId','creditAccountId','cashActivity'))
   or nullif(rule->>'eventType','') is null or nullif(rule->>'sourceModule','') is null or nullif(rule->>'classificationId','') is null
   or coalesce(rule->>'cashDirection','') not in('NON_CASH','INFLOW','OUTFLOW')
   or not exists(select 1 from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'id'=rule->>'debitAccountId')
   or not exists(select 1 from jsonb_array_elements(public.financial_reporting_chart()) a where a->>'id'=rule->>'creditAccountId')
   or rule->>'debitAccountId'=rule->>'creditAccountId' and (rule->>'debitAccountId'<>'1000' or rule->>'cashDirection'='NON_CASH')
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
revoke all on function public.save_financial_reporting_policy(uuid,date,integer,jsonb,text) from public,anon;
grant execute on function public.save_financial_reporting_policy(uuid,date,integer,jsonb,text) to authenticated;

create or replace function public.approve_financial_reporting_policy(p_id uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pol public.financial_reporting_policies%rowtype;mode text;
begin
 select * into pol from public.financial_reporting_policies where id=p_id;
 if pol.id is null or not private.financial_opening_can(pol.organization_id,'financial_core.approve') or not private.financial_opening_can(pol.organization_id,'financial_core.post') then raise exception 'REPORTING_APPROVE_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended('reporting-policy:'||pol.organization_id::text||pol.fiscal_start::text,0));
 select * into pol from public.financial_reporting_policies where id=p_id for update;
 if pol.status='APPROVED' and pol.version=p_expected_version+1 then return to_jsonb(pol);end if;
 if pol.status<>'DRAFT' or pol.version is distinct from p_expected_version then raise exception 'REPORTING_VERSION_CONFLICT';end if;
 select approval_policy into mode from public.organizations where id=pol.organization_id for share;
 if auth.uid() in(pol.created_by,pol.updated_by) and not
  (mode='OWNER_CONTROLLED' and exists(select 1 from public.organization_members where organization_id=pol.organization_id and user_id=auth.uid() and status='ACTIVE' and role='OWNER')
  or mode='ROLE_BASED' and public.explicit_organization_permission(pol.organization_id,'financial_core.self_approve',null,pol.currency)) then raise exception 'REPORTING_SELF_APPROVAL_DENIED';end if;
 update public.financial_reporting_policies set status='SUPERSEDED' where organization_id=pol.organization_id and fiscal_start=pol.fiscal_start and status='APPROVED';
 update public.financial_reporting_policies set status='APPROVED',approved_by=auth.uid(),approved_at=now(),updated_at=now(),version=version+1 where id=pol.id returning * into pol;
 insert into public.financial_reporting_policy_audit(organization_id,policy_id,actor_id,action,version,detail) values(pol.organization_id,pol.id,auth.uid(),'APPROVE',pol.version,to_jsonb(pol));
 return to_jsonb(pol);
end $$;
revoke all on function public.approve_financial_reporting_policy(uuid,integer) from public,anon;
grant execute on function public.approve_financial_reporting_policy(uuid,integer) to authenticated;

create or replace function public.financial_statement_live_context()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('organizationId',o.id,'name',o.name,'currency',o.base_currency,'fiscalStart',w.fiscal_start,'fiscalEnd',(w.fiscal_start+interval '1 year'-interval '1 day')::date) order by o.name,w.fiscal_start),'[]'::jsonb)
 from public.organizations o join public.financial_opening_workspaces w on w.organization_id=o.id and w.status='APPROVED'
 where private.financial_opening_can(o.id,'financial_core.view')
$$;
revoke all on function public.financial_statement_live_context() from public,anon;
grant execute on function public.financial_statement_live_context() to authenticated;

create or replace function public.financial_statement_live_snapshot(p_org uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.financial_opening_workspaces%rowtype;pol public.financial_reporting_policies%rowtype;s jsonb;events jsonb;accounts jsonb;rules jsonb;opening jsonb;closing_cash numeric;opening_cash numeric;original_cash numeric;
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
 select jsonb_agg(a||jsonb_build_object('organizationId',p_org,'currency',w.currency)) into accounts from jsonb_array_elements(public.financial_reporting_chart()) a;
 select jsonb_agg(jsonb_build_object('accountId',code,'debit',greatest(amount,0)::numeric(24,4)::text,'credit',greatest(-amount,0)::numeric(24,4)::text)) into opening from
  (select r->>'accountCode' code,sum((r->>'debit')::numeric-(r->>'credit')::numeric) amount from jsonb_array_elements(w.approved_opening) r group by r->>'accountCode') t;
 select coalesce(jsonb_agg(r||jsonb_build_object('id',pol.id::text||':'||ord,'organizationId',p_org,'currency',pol.currency,'from',pol.fiscal_start,'to',pol.fiscal_end)),'[]'::jsonb) into rules from jsonb_array_elements(pol.rules) with ordinality x(r,ord);
 select coalesce(sum((v->>'debit')::numeric-(v->>'credit')::numeric),0) into original_cash from jsonb_array_elements(s->'rows') r cross join lateral jsonb_array_elements(r->'vouchers') v where r->>'tab'='cash';
 select coalesce(sum((r->>'debit')::numeric-(r->>'credit')::numeric),0) into opening_cash from jsonb_array_elements(w.approved_opening) r where r->>'accountCode'='1000';
 s:=private.financial_opening_sources(p_org,p_to);
 if exists(select 1 from jsonb_array_elements(s->'rows') r where r->>'tab'='cash' and r->>'sourceIssue' is not null) then raise exception 'REPORTING_CASH_RECONCILIATION_REQUIRED';end if;
 select coalesce(sum((v->>'debit')::numeric-(v->>'credit')::numeric),0)+opening_cash-original_cash into closing_cash from jsonb_array_elements(s->'rows') r cross join lateral jsonb_array_elements(r->'vouchers') v where r->>'tab'='cash';
 return jsonb_build_object('origin','LIVE_CANONICAL_EVENTS','organizationId',p_org,'currency',w.currency,'openingDate',w.fiscal_start-1,'fiscalStart',w.fiscal_start,'from',p_from,'to',p_to,'openingSourceId',w.id,
  'controls',jsonb_build_object('cashClosing',closing_cash::numeric(24,4)::text),'accounts',accounts,'opening',opening,'policy',jsonb_build_object('id',pol.id,'organizationId',p_org,'currency',pol.currency,'approvedBy',pol.approved_by,'approvedAt',pol.approved_at,'rules',rules),'events',events,
  'coverage',jsonb_build_object('complete',true,'scope','ORGANIZATION_ALL_ENTITIES','eventCount',jsonb_array_length(events),'lineCount',(select coalesce(sum(jsonb_array_length(e->'lines')),0) from jsonb_array_elements(events) e),'readAt',statement_timestamp()));
end $$;
revoke all on function public.financial_statement_live_snapshot(uuid,date,date) from public,anon;
grant execute on function public.financial_statement_live_snapshot(uuid,date,date) to authenticated;
notify pgrst,'reload schema';
