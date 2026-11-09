-- Independent module catalog and immutable customer requests. Existing plan rows are untouched.
begin;
create table subscription_private.bundle_modules (
 key text primary key check(key in ('assets','liquidity','zakat','vat','debts','budgets','investments')),
 name_ar text not null check(length(name_ar) between 2 and 120), name_en text not null check(length(name_en) between 2 and 120),
 description_ar text not null check(length(description_ar) between 2 and 500), description_en text not null check(length(description_en) between 2 and 500),
 icon text not null check(icon in ('chart','finance','bank','calendar','regulatory','organization','opening')),
 pricing text not null default 'quote' check(pricing in ('fixed','quote')),
 monthly numeric(14,2) check(monthly between 0 and 100000000), yearly numeric(14,2) check(yearly between 0 and 100000000),
 currency text not null default 'SAR' references public.currencies(code), published boolean not null default true,
 requires text[] not null default '{}', revision integer not null default 1,
 check(pricing='quote' or (monthly is not null and yearly is not null)),check(not(key=any(requires)))
);
alter table subscription_private.bundle_modules enable row level security;
revoke all on subscription_private.bundle_modules from public,anon,authenticated,service_role;
insert into subscription_private.bundle_modules(key,name_ar,name_en,description_ar,description_en,icon,requires) values
 ('assets','الأصول والعمليات','Assets and transactions','إدارة الأصول والعمليات ومتابعة الإهلاك.','Manage assets, transactions and depreciation.','organization','{}'),
 ('liquidity','السيولة والبنوك','Cash and banks','متابعة البنوك والتدفقات النقدية والسندات.','Manage banks, cash flows and vouchers.','bank','{}'),
 ('zakat','الزكاة والتقييمات','Zakat and assessments','احتساب الزكاة ومتابعة التقييمات وتقاريرها.','Calculate zakat and track assessments and reports.','finance','{assets,liquidity}'),
 ('vat','الفواتير والضريبة','Invoices and VAT','إدارة الفواتير وضريبة القيمة المضافة.','Manage invoices and value added tax.','regulatory','{assets,liquidity}'),
 ('debts','الديون والعقود والتمويل','Debts, contracts and financing','متابعة الالتزامات والتحصيل والعقود والتمويل.','Track obligations, collections, contracts and financing.','opening','{assets,liquidity}'),
 ('budgets','الموازنات والتخطيط','Budgets and planning','إعداد الموازنات ومتابعة الانحرافات.','Prepare budgets and monitor variances.','calendar','{assets,liquidity}'),
 ('investments','الاستثمارات والمشاركات','Investments and participations','إدارة الاستثمارات والمشاركات ومتابعة أدائها.','Manage investments and participations and track performance.','chart','{assets,liquidity}');
create table subscription_private.bundle_requests (
 id uuid primary key default gen_random_uuid(), request_number bigint generated always as identity unique,
 organization_id uuid not null references public.organizations(id), requester_id uuid references auth.users(id) on delete set null,
 token uuid not null, items jsonb not null, billing_interval text not null check(billing_interval in ('monthly','yearly')),
 currency text not null references public.currencies(code), total numeric(14,2) check(total between 0 and 100000000),
 max_users integer not null check(max_users between 1 and 100000), phone text not null default '', notes text not null default '',
 status text not null check(status in ('pending','offered','accepted','activated','rejected','cancelled')),
 revision integer not null default 1, subscription_revision integer not null, reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,token)
);
create unique index bundle_one_open on subscription_private.bundle_requests(organization_id) where status in ('pending','offered','accepted');
alter table subscription_private.bundle_requests enable row level security;
revoke all on subscription_private.bundle_requests from public,anon,authenticated,service_role;

create function public.subscription_bundle_catalog(p_admin boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
 if p_admin and not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED';end if;
 return (select coalesce(jsonb_agg(to_jsonb(m) order by key),'[]') from subscription_private.bundle_modules m where published or p_admin);
end$$;
create function public.owner_save_bundle_module(p_details jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m subscription_private.bundle_modules%rowtype; deps text[];
begin
 if not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED';end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'ADMIN_REASON_REQUIRED';end if;
 -- Serialize dependency edits, preventing concurrent creation of a cycle.
 lock table subscription_private.bundle_modules in share row exclusive mode;
 select * into m from subscription_private.bundle_modules where key=p_details->>'key' for update;
 if not found or m.revision is distinct from (p_details->>'revision')::integer then raise exception 'MODULE_CONFLICT';end if;
 select coalesce(array_agg(distinct v),'{}') into deps from jsonb_array_elements_text(p_details->'requires') v;
 if m.key=any(deps) or exists(select 1 from unnest(deps) d where not exists(select 1 from subscription_private.bundle_modules where key=d)) then raise exception 'MODULE_DEPENDENCY_INVALID';end if;
 if exists(with recursive reach(k) as (select unnest(deps) union select unnest(b.requires) from subscription_private.bundle_modules b join reach r on b.key=r.k) select 1 from reach where k=m.key) then raise exception 'MODULE_DEPENDENCY_INVALID';end if;
 if (p_details->>'monthly')::numeric <> round((p_details->>'monthly')::numeric,2) or (p_details->>'yearly')::numeric <> round((p_details->>'yearly')::numeric,2) then raise exception 'PRICE_INVALID';end if;
 update subscription_private.bundle_modules set name_ar=trim(p_details->>'name_ar'),name_en=trim(p_details->>'name_en'),description_ar=trim(p_details->>'description_ar'),description_en=trim(p_details->>'description_en'),icon=p_details->>'icon',pricing=p_details->>'pricing',monthly=case when p_details->>'pricing'='fixed' then (p_details->>'monthly')::numeric end,yearly=case when p_details->>'pricing'='fixed' then (p_details->>'yearly')::numeric end,currency=p_details->>'currency',published=(p_details->>'published')::boolean,requires=deps,revision=revision+1 where key=m.key returning * into m;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,details) values(auth.uid(),'bundle.module_saved','bundle_module',jsonb_build_object('reason',p_reason,'module',to_jsonb(m)));
 return to_jsonb(m);
end$$;

create function public.subscription_bundle_requests(p_organization_id uuid,p_action text default 'list',p_details jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare m text; r subscription_private.bundle_requests%rowtype; keys text[]; items jsonb; total numeric; currency text; e jsonb;
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
 select role::text into m from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() and status='ACTIVE';
 if m is null then raise exception 'ORGANIZATION_ACCESS_REQUIRED';end if;
 if p_action='list' then return jsonb_build_object('can_request',m in ('OWNER','ADMIN'),'rows',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]') from (select * from subscription_private.bundle_requests where organization_id=p_organization_id and m in ('OWNER','ADMIN') order by created_at desc limit 50)t));end if;
 if m not in ('OWNER','ADMIN') then raise exception 'ORGANIZATION_ADMIN_REQUIRED';end if;
 -- Lock catalog before organization, consistently with owner activation.
 perform 1 from subscription_private.bundle_modules order by key for share;
 perform 1 from public.organizations where id=p_organization_id for update;
 if not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=auth.uid() and status='ACTIVE' and role in ('OWNER','ADMIN')) then raise exception 'ORGANIZATION_ADMIN_REQUIRED';end if;
 if p_action='submit' then
  if length(coalesce(p_details->>'phone',''))>50 or length(coalesce(p_details->>'notes',''))>2000 or p_details->>'interval' not in ('monthly','yearly') then raise exception 'REQUEST_DETAILS_INVALID';end if;
  select array_agg(v->>'key' order by v->>'key') into keys from jsonb_array_elements(p_details->'modules')v;
  if keys is null or cardinality(keys) not between 2 and 7 or not ('assets'=any(keys) and 'liquidity'=any(keys)) or cardinality(keys)<>(select count(distinct k) from unnest(keys)k) then raise exception 'MODULE_DEPENDENCY_INVALID';end if;
  select * into r from subscription_private.bundle_requests where organization_id=p_organization_id and token=(p_details->>'token')::uuid;
  if found then
   if r.billing_interval is distinct from p_details->>'interval' or r.phone is distinct from coalesce(p_details->>'phone','') or r.notes is distinct from coalesce(p_details->>'notes','') or (select array_agg(v->>'key' order by v->>'key') from jsonb_array_elements(r.items)v) is distinct from keys then raise exception 'REQUEST_CONFLICT';end if;
   return to_jsonb(r);
  end if;
  if exists(select 1 from subscription_private.bundle_requests where organization_id=p_organization_id and status in ('pending','offered','accepted')) or exists(select 1 from subscription_private.activation_requests where organization_id=p_organization_id and status in ('pending','reviewing','needs_info')) then raise exception 'REQUEST_OPEN_CONFLICT';end if;
  if exists(select 1 from jsonb_array_elements(p_details->'modules')v left join subscription_private.bundle_modules b on b.key=v->>'key' where b.key is null or not b.published or b.revision is distinct from (v->>'revision')::integer) then raise exception 'MODULE_CONFLICT';end if;
  if exists(select 1 from subscription_private.bundle_modules b cross join unnest(b.requires)d where b.key=any(keys) and not d=any(keys)) then raise exception 'MODULE_DEPENDENCY_INVALID';end if;
  if (select count(distinct b.currency) from subscription_private.bundle_modules b where key=any(keys))<>1 then raise exception 'MODULE_CURRENCY_INVALID';end if;
  select jsonb_agg(to_jsonb(b) order by key),min(b.currency),case when bool_or(pricing='quote') then null else sum(case when p_details->>'interval'='monthly' then monthly else yearly end) end into items,currency,total from subscription_private.bundle_modules b where key=any(keys);
  e:=subscription_private.entitlement(p_organization_id);
  insert into subscription_private.bundle_requests(organization_id,requester_id,token,items,billing_interval,currency,total,max_users,phone,notes,status,subscription_revision)
   values(p_organization_id,auth.uid(),(p_details->>'token')::uuid,items,p_details->>'interval',currency,total,greatest(1,coalesce((e->>'max_users')::integer,1),(select count(*)::integer from public.organization_members where organization_id=p_organization_id and status='ACTIVE')),coalesce(p_details->>'phone',''),coalesce(p_details->>'notes',''),case when total is null then 'pending' else 'accepted' end,coalesce((e->>'revision')::integer,0)) returning * into r;
 else
  select * into r from subscription_private.bundle_requests where id=(p_details->>'id')::uuid and organization_id=p_organization_id for update;
  if not found or r.revision is distinct from (p_details->>'revision')::integer then raise exception 'REQUEST_CONFLICT';end if;
  if p_action='accept' and r.status='offered' then
   update subscription_private.bundle_requests set status='accepted',revision=revision+1,updated_at=now() where id=r.id returning * into r;
  elsif p_action='cancel' and r.status in ('pending','offered','accepted') then
   update subscription_private.bundle_requests set status='cancelled',revision=revision+1,updated_at=now() where id=r.id returning * into r;
  else raise exception 'REQUEST_CONFLICT';end if;
 end if;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details) values(auth.uid(),'bundle.'||p_action,'bundle_request',r.id,jsonb_build_object('organization_id',p_organization_id,'revision',r.revision));
 return to_jsonb(r);
end$$;

create function public.owner_bundle_requests(p_action text default 'list',p_details jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare r subscription_private.bundle_requests%rowtype; org uuid; plan jsonb; caps jsonb; price numeric; seats integer; until_at timestamptz;
begin
 if not public.owner_authorized() then raise exception 'PLATFORM_OWNER_REQUIRED';end if;
 if p_action='list' then return (select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select b.*,o.name organization_name from subscription_private.bundle_requests b join public.organizations o on o.id=b.organization_id order by b.created_at desc limit 100)t);end if;
 if length(trim(coalesce(p_details->>'reason',''))) not between 5 and 1000 then raise exception 'ADMIN_REASON_REQUIRED';end if;
 select organization_id into org from subscription_private.bundle_requests where id=(p_details->>'id')::uuid;
 if org is null then raise exception 'REQUEST_CONFLICT';end if;
 perform 1 from public.organizations where id=org for update;
 select * into r from subscription_private.bundle_requests where id=(p_details->>'id')::uuid for update;
 if r.revision is distinct from (p_details->>'revision')::integer then raise exception 'REQUEST_CONFLICT';end if;
 if p_action='offer' and r.status in ('pending','offered') then
  price:=(p_details->>'total')::numeric;seats:=(p_details->>'max_users')::integer;
  if price is null or price<0 or price>100000000 or price<>round(price,2) or seats is null or seats not between 1 and 100000 then raise exception 'PRICE_INVALID';end if;
  update subscription_private.bundle_requests set total=price,max_users=seats,status='offered' where id=r.id;
 elsif p_action='reject' and r.status in ('pending','offered','accepted') then
  update subscription_private.bundle_requests set status='rejected' where id=r.id;
 elsif p_action='activate' and r.status='accepted' then
  if coalesce((subscription_private.entitlement(org)->>'revision')::integer,0)<>r.subscription_revision then raise exception 'SUBSCRIPTION_CONFLICT';end if;
  select jsonb_agg('module:'||(v->>'key')) into caps from jsonb_array_elements(r.items)v;
  -- A private request-specific plan cannot leak into the public catalog or affect other agreements.
  plan:=public.owner_save_subscription_plan(jsonb_build_object('code','bundle_'||replace(r.id::text,'-',''),'family','custom','name_ar','باقة حسب الاحتياج','name_en','Custom module bundle','description_ar','باقة معتمدة حسب طلب المؤسسة','description_en','Organization-approved module bundle','price',r.total,'currency',r.currency,'interval',r.billing_interval,'max_users',r.max_users,'features',caps,'is_active',true,'is_published',false,'is_proposed',false),p_details->>'reason');
  until_at:=statement_timestamp()+case when r.billing_interval='monthly' then interval '1 month' else interval '1 year' end;
  perform public.owner_manage_trial('activate',p_details->>'reason',org,r.subscription_revision,null,until_at,(plan->>'id')::uuid,r.max_users);
  update subscription_private.bundle_requests set status='activated' where id=r.id;
 else raise exception 'REQUEST_CONFLICT';end if;
 update subscription_private.bundle_requests set reason=trim(p_details->>'reason'),revision=revision+1,updated_at=now() where id=r.id returning * into r;
 insert into public.platform_audit_events(actor_user_id,event_type,entity_type,entity_id,details) values(auth.uid(),'bundle.'||p_action,'bundle_request',r.id,jsonb_build_object('organization_id',org,'reason',r.reason,'revision',r.revision,'total',r.total,'max_users',r.max_users));
 return to_jsonb(r);
end$$;
revoke all on function public.subscription_bundle_catalog(boolean),public.owner_save_bundle_module(jsonb,text),public.subscription_bundle_requests(uuid,text,jsonb),public.owner_bundle_requests(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.subscription_bundle_catalog(boolean),public.owner_save_bundle_module(jsonb,text),public.subscription_bundle_requests(uuid,text,jsonb),public.owner_bundle_requests(text,jsonb) to authenticated;
commit;
