create or replace function private.ensure_asset_cash_forecast(p_event_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.financial_events%rowtype;o public.financial_event_obligations%rowtype;fid uuid;party text;
begin
 select * into e from public.financial_events where id=p_event_id;
 if auth.uid() is null or e.id is null or e.source_module not in('ASSETS_INTEGRATION','ASSET_LIFECYCLE') or e.status in('CANCELLED','REVERSED') or not public.has_organization_permission(e.organization_id,'assets.edit') or not public.has_organization_permission(e.organization_id,'liquidity.edit') then raise exception 'ASSET_EVENT_ACCESS_DENIED';end if;
 if e.source_module='ASSETS_INTEGRATION' and not exists(select 1 from public.transactions t join public.asset_accounts a on a.id=t.asset_account_id where t.id=e.source_record_id and t.organization_id=e.organization_id and a.organization_id=e.organization_id and t.transaction_type='PURCHASE') then raise exception 'ASSET_EVENT_SOURCE_MISMATCH';end if;
 if e.source_module='ASSET_LIFECYCLE' and not exists(select 1 from public.asset_lifecycle_commands c where c.id=e.source_record_id and c.organization_id=e.organization_id) then raise exception 'ASSET_EVENT_SOURCE_MISMATCH';end if;
 select * into o from public.financial_event_obligations where event_id=e.id limit 1;
 if o.id is null then return null;end if;
 select name into party from public.liquidity_counterparties where id=e.counterparty_id;
 select id into fid from public.liquidity_flows where organization_id=e.organization_id and source_event_key='asset-event:'||e.id||':cash-forecast' and source_module='ASSETS_INTEGRATION';
 if fid is null then
  insert into public.liquidity_flows(organization_id,entity_id,direction,flow_type,title,counterparty,counterparty_id,due_date,amount,currency,base_amount,status,source,reference,source_module,source_record_id,source_event_key)
  values(e.organization_id,e.entity_id,case when o.obligation_type='PAYABLE' then 'OUTFLOW' else 'INFLOW' end,'INVESTMENT',e.description,coalesce(party,''),e.counterparty_id,e.due_date,o.settleable_amount,o.currency,o.settleable_base_amount,'EXPECTED','INVOICE',e.description,'ASSETS_INTEGRATION',e.source_record_id,'asset-event:'||e.id||':cash-forecast') returning id into fid;
 end if;
 if not exists(select 1 from public.financial_event_links where event_id=e.id and link_type='CASH_FLOW' and target_module='liquidity_flows' and target_record_id=fid) then insert into public.financial_event_links(event_id,organization_id,link_type,target_module,target_record_id,metadata) values(e.id,e.organization_id,'CASH_FLOW','liquidity_flows',fid,jsonb_build_object('purpose','ASSET_DUE_FORECAST','asset_source_id',e.source_record_id));end if;
 return fid;
end $$;
-- Bounded forecast command; direct liquidity table writes remain revoked.
revoke all on function private.ensure_asset_cash_forecast(uuid) from public,anon,authenticated;
create or replace function public.ensure_asset_cash_forecast(p_event_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
 return private.ensure_asset_cash_forecast(p_event_id);
end $$;
revoke all on function public.ensure_asset_cash_forecast(uuid) from public,anon;
grant execute on function public.ensure_asset_cash_forecast(uuid) to authenticated;

drop policy if exists lots_self on public.lots;
create policy lots_self on public.lots for all to authenticated using(user_id=auth.uid() and exists(select 1 from public.asset_accounts a where a.id=asset_account_id and a.ownership_scope='PERSONAL')) with check(user_id=auth.uid() and exists(select 1 from public.asset_accounts a where a.id=asset_account_id and a.ownership_scope='PERSONAL'));
drop policy if exists transactions_self on public.transactions;
create policy transactions_self on public.transactions for all to authenticated using(user_id=auth.uid() and organization_id is null) with check(user_id=auth.uid() and organization_id is null and exists(select 1 from public.asset_accounts a where a.id=asset_account_id and a.ownership_scope='PERSONAL'));
create policy transactions_org_update on public.transactions for update to authenticated using(user_id=auth.uid() and public.has_organization_permission(organization_id,'assets.edit')) with check(user_id=auth.uid() and public.has_organization_permission(organization_id,'assets.edit') and exists(select 1 from public.asset_accounts a where a.id=asset_account_id and a.organization_id=transactions.organization_id));
-- Share enterprise lots through the existing asset permissions, never with personal zakat.
create policy lots_org_read on public.lots for select to authenticated using (exists(select 1 from public.asset_accounts a where a.id=asset_account_id and a.ownership_scope='ORGANIZATION' and public.has_organization_permission(a.organization_id,'assets.view')));
create policy lots_org_write on public.lots for all to authenticated using (exists(select 1 from public.asset_accounts a where a.id=asset_account_id and a.ownership_scope='ORGANIZATION' and public.has_organization_permission(a.organization_id,'assets.edit'))) with check (exists(select 1 from public.asset_accounts a where a.id=asset_account_id and a.ownership_scope='ORGANIZATION' and public.has_organization_permission(a.organization_id,'assets.edit')));
create policy transactions_org_read on public.transactions for select to authenticated using (organization_id is not null and public.has_organization_permission(organization_id,'assets.view'));
create policy transactions_org_write on public.transactions for insert to authenticated with check (user_id=auth.uid() and organization_id is not null and public.has_organization_permission(organization_id,'assets.edit') and exists(select 1 from public.asset_accounts a where a.id=asset_account_id and a.organization_id=transactions.organization_id));

create or replace function public.create_asset_with_acquisition(p_asset jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid();a public.asset_accounts%rowtype;fund public.asset_accounts%rowtype;m jsonb:=coalesce(p_asset->'metadata','{}'::jsonb);org uuid:=nullif(p_asset->>'organization_id','')::uuid;scope text:=coalesce(p_asset->>'ownership_scope','PERSONAL');base text;fx numeric;qty numeric;net numeric;vat numeric;recover numeric;cost numeric;dt date;mode text;tid uuid;wid uuid;eid uuid;cid uuid;taxid uuid;ft text;payload jsonb;lines jsonb;remaining numeric;take numeric;tq numeric;totalq numeric:=0;l record;fingerprint text:=md5(p_asset::text);
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if p_request_id is null then raise exception 'ASSET_REQUEST_ID_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text||p_request_id::text,0));
 select * into a from public.asset_accounts where user_id=uid and metadata->>'acquisition_request_id'=p_request_id::text;
 if a.id is not null then if a.metadata->>'acquisition_fingerprint'<>fingerprint then raise exception 'ASSET_REQUEST_CONFLICT';end if;return to_jsonb(a);end if;
 if scope='ORGANIZATION' then
  if org is null or not public.has_organization_permission(org,'assets.edit') then raise exception 'ASSET_ORGANIZATION_ACCESS_DENIED';end if;
  select base_currency into base from public.organizations where id=org;
  if p_asset->>'asset_type_code' is null then raise exception 'ASSET_CLASS_AND_TYPE_REQUIRED';end if;
 else
  if org is not null or scope<>'PERSONAL' then raise exception 'ASSET_OWNER_SCOPE_INVALID';end if;
  select base_currency into base from public.profiles where id=uid;
 end if;
 if p_asset->>'asset_type_code' is not null and not exists(select 1 from public.asset_types_v2 t where t.code=p_asset->>'asset_type_code' and t.class_code=p_asset->>'asset_class_code' and t.default_legacy_asset_type::text=p_asset->>'asset_type' and t.active) then raise exception 'ASSET_CLASS_TYPE_MISMATCH';end if;
 fx:=case when p_asset->>'currency'=base then 1 else (m->>'fx_rate')::numeric end;
 qty:=coalesce(nullif(m->>'quantity','')::numeric,1);net:=coalesce(nullif(m->>'purchase_value','')::numeric,nullif(m->>'opening_value','')::numeric,0);dt:=(m->>'purchase_date')::date;
 vat:=coalesce((m->>'vat_amount')::numeric,0);recover:=coalesce((m->>'recoverable_percent')::numeric,100);mode:=coalesce(m->>'acquisition_mode','OPENING_BALANCE');
 if base is null or fx is null or fx<=0 or qty<=0 or net<=0 or dt is null or vat<0 or recover<0 or recover>100 or mode not in('PURCHASE','OPENING_BALANCE') then raise exception 'ASSET_ACQUISITION_INVALID';end if;
 if mode='OPENING_BALANCE' and vat<>0 then raise exception 'OPENING_BALANCE_VAT_NOT_ALLOWED';end if;
 cost:=net+vat*(case when scope='PERSONAL' then 1 else 1-recover/100 end);
 m:=m||jsonb_build_object('fx_rate',fx,'acquisition_base_currency',base,'acquisition_cost_base',cost*fx,'acquisition_request_id',p_request_id,'acquisition_fingerprint',fingerprint);
 insert into public.asset_accounts(user_id,asset_type,name,currency,unit,is_zakatable,ownership_scope,organization_id,entity_id,cost_center_id,asset_class_code,asset_type_code,metadata)
 values(uid,(p_asset->>'asset_type')::public.asset_type,p_asset->>'name',p_asset->>'currency',coalesce(p_asset->>'unit','unit'),coalesce((p_asset->>'is_zakatable')::boolean,true),scope,org,nullif(p_asset->>'entity_id','')::uuid,nullif(p_asset->>'cost_center_id','')::uuid,p_asset->>'asset_class_code',p_asset->>'asset_type_code',m) returning * into a;
 insert into public.transactions(user_id,asset_account_id,organization_id,entity_id,transaction_type,transaction_date,quantity,unit_price,currency,gross_value,base_currency,base_value,reference,metadata,created_by)
 values(uid,a.id,org,a.entity_id,mode::public.transaction_type,dt,qty,net/qty,a.currency,net,base,net*fx,m->>'invoice_reference',m||jsonb_build_object('source','ATOMIC_ASSET_ACQUISITION'),uid) returning id into tid;
 insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)
 values(uid,a.id,tid,dt,qty,qty,cost*fx,cost*fx,'ACTIVE',jsonb_build_object('source','ATOMIC_ASSET_ACQUISITION','base_currency',base,'recognition_pending',scope='ORGANIZATION' and mode='PURCHASE'));
 if mode='PURCHASE' and scope='PERSONAL' then
  select * into fund from public.asset_accounts where id=nullif(m->>'funding_account_id','')::uuid and user_id=uid and ownership_scope='PERSONAL' and asset_type in('CASH','BANK') for update;
  if fund.id is null then raise exception 'PERSONAL_PURCHASE_FUNDING_ACCOUNT_INVALID';end if;
  if fund.currency<>a.currency then raise exception 'PERSONAL_PURCHASE_CURRENCY_MISMATCH';end if;
  perform 1 from public.lots where asset_account_id=fund.id and user_id=uid and remaining_quantity>0 order by acquisition_date,created_at,id for update;
  remaining:=(net+vat)*fx;
  if coalesce((select sum(remaining_value_base) from public.lots where asset_account_id=fund.id and user_id=uid and remaining_quantity>0 and acquisition_date<=dt),0)<remaining then raise exception 'PERSONAL_PURCHASE_INSUFFICIENT_FUNDS';end if;
  insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,metadata,created_by)
  values(uid,fund.id,'WITHDRAWAL',dt,0,fund.currency,net+vat,base,remaining,jsonb_build_object('source','ASSET_PURCHASE','purchase_transaction_id',tid,'fx_rate',fx),uid) returning id into wid;
  for l in select * from public.lots where asset_account_id=fund.id and user_id=uid and remaining_quantity>0 and remaining_value_base>0 and acquisition_date<=dt order by acquisition_date,created_at,id for update loop
   exit when remaining<=0;take:=least(remaining,l.remaining_value_base);tq:=case when take=l.remaining_value_base then l.remaining_quantity else l.remaining_quantity*take/l.remaining_value_base end;totalq:=totalq+tq;
   insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method) values(uid,wid,l.id,tq,take,'FIFO');
   update public.lots set remaining_quantity=greatest(0,remaining_quantity-tq),remaining_value_base=greatest(0,remaining_value_base-take),status=case when take=l.remaining_value_base then 'CLOSED'::public.lot_status else 'PARTIALLY_USED'::public.lot_status end where id=l.id;
   remaining:=remaining-take;
  end loop;
  if remaining>0 then raise exception 'PERSONAL_PURCHASE_INSUFFICIENT_FUNDS';end if;
  update public.transactions set quantity=totalq where id=wid;
 elsif mode='PURCHASE' then
  if nullif(m->>'counterparty_id','') is null or nullif(m->>'invoice_reference','') is null or nullif(m->>'due_date','') is null then raise exception 'ASSET_SUPPLIER_INVOICE_DUE_REQUIRED';end if;
  if (m->>'due_date')::date<dt then raise exception 'ASSET_DUE_BEFORE_PURCHASE';end if;
  if not exists(select 1 from public.liquidity_counterparties where id=(m->>'counterparty_id')::uuid and organization_id=org and party_type in('SUPPLIER','BOTH')) then raise exception 'ASSET_SUPPLIER_SCOPE_MISMATCH';end if;
  ft:=case when a.asset_class_code in('PPE','INTANGIBLE') then 'CAPEX' when a.asset_class_code='INVESTMENT' then 'INVESTMENT' else 'ASSET' end;
  select id into cid from public.financial_classifications where organization_id=org and classification_type=ft and active order by is_system desc limit 1;
  if cid is null then raise exception 'ASSET_FINANCIAL_CLASSIFICATION_REQUIRED';end if;
  lines:=jsonb_build_array(jsonb_build_object('line_number',1,'description',a.name,'classification_id',cid,'cost_center_id',a.cost_center_id,'amount',cost,'currency',a.currency,'exchange_rate',fx,'base_amount',cost*fx,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0));
  if vat*recover>0 then
   select id into taxid from public.financial_classifications where organization_id=org and classification_type='TAX' and active order by is_system desc limit 1;
   if taxid is null then raise exception 'ASSET_VAT_CLASSIFICATION_REQUIRED';end if;
   lines:=lines||jsonb_build_array(jsonb_build_object('line_number',2,'description','Recoverable VAT / '||a.name,'classification_id',taxid,'cost_center_id',a.cost_center_id,'amount',vat*recover/100,'currency',a.currency,'exchange_rate',fx,'base_amount',vat*recover/100*fx,'cash_direction','NON_CASH','vat_treatment','OUT_OF_SCOPE','vat_rate',0,'vat_amount',0));
  end if;
  payload:=jsonb_build_object('organization_id',org,'entity_id',a.entity_id,'counterparty_id',(m->>'counterparty_id')::uuid,'event_type','ASSET_PURCHASE','source_module','ASSETS_INTEGRATION','source_record_id',tid,'source_event_key','asset-purchase:'||tid,'event_date',dt,'due_date',(m->>'due_date')::date,'base_currency',base,'description','Asset purchase / '||a.name,'lines',lines,'obligations',jsonb_build_array(jsonb_build_object('obligation_key','asset-purchase-gross','obligation_type','PAYABLE','settleable_amount',net+vat,'currency',a.currency,'exchange_rate',fx,'base_currency',base,'settleable_base_amount',(net+vat)*fx)),'links',jsonb_build_array(jsonb_build_object('link_type','SOURCE','target_module','transactions','target_record_id',tid,'metadata','{}'::jsonb),jsonb_build_object('link_type','ASSET','target_module','asset_accounts','target_record_id',a.id,'metadata',jsonb_build_object('asset_class_code',a.asset_class_code))));
  eid:=public.create_financial_event_command(payload);
  perform public.ensure_asset_cash_forecast(eid);
  update public.transactions set metadata=metadata||jsonb_build_object('financial_event_id',eid,'financial_core_status','PENDING_APPROVAL','financial_core_intent',payload) where id=tid;
 end if;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(uid,'asset_account',a.id,'ATOMIC_ACQUISITION',jsonb_build_object('transaction_id',tid,'funding_transaction_id',wid,'financial_event_id',eid,'cost_base',cost*fx));
 return to_jsonb(a)||jsonb_build_object('acquisition_transaction_id',tid,'financial_event_id',eid);
end $$;
revoke all on function public.create_asset_with_acquisition(jsonb,uuid) from public,anon;
grant execute on function public.create_asset_with_acquisition(jsonb,uuid) to authenticated;

-- Lifecycle commands use the existing Financial Core approval path. No stock or
-- book value changes until its event reaches ACTUAL; cash settlement is separate.
create table public.asset_lifecycle_commands(
 id uuid primary key default gen_random_uuid(),asset_account_id uuid not null references public.asset_accounts(id),organization_id uuid not null references public.organizations(id),created_by uuid not null default auth.uid(),request_id uuid not null,payload_fingerprint text not null,
 operation text not null check(operation in('DEPRECIATION','SALE','DISPOSAL')),operation_date date not null,quantity numeric not null,amount numeric not null,expected_quantity numeric not null,expected_book_value numeric not null,book_effect numeric not null,vat_amount numeric not null default 0,financial_event_id uuid unique references public.financial_events(id),transaction_id uuid references public.transactions(id),lot_states jsonb not null default '[]',applied_at timestamptz,created_at timestamptz not null default now(),unique(created_by,request_id)
);
alter table public.asset_lifecycle_commands enable row level security;
create policy asset_lifecycle_read on public.asset_lifecycle_commands for select to authenticated using(public.has_organization_permission(organization_id,'assets.view'));
create policy asset_lifecycle_insert on public.asset_lifecycle_commands for insert to authenticated with check(created_by=auth.uid() and public.has_organization_permission(organization_id,'assets.edit') and exists(select 1 from public.asset_accounts a where a.id=asset_account_id and a.organization_id=asset_lifecycle_commands.organization_id));
grant select,insert on public.asset_lifecycle_commands to authenticated;
revoke update,delete on public.asset_lifecycle_commands from authenticated,anon;
create index asset_lifecycle_asset_index on public.asset_lifecycle_commands(asset_account_id,created_at);

