create or replace function private.investment_draft_action(p_action text,p_id uuid,p_payload jsonb,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();c public.investment_contracts%rowtype;o public.investment_operations%rowtype;t jsonb;org uuid;base text;aid uuid;rid uuid;sid uuid;fid uuid;obid uuid;classid uuid;extraid uuid;v_amount numeric;fx numeric;dt date;kind text;lines jsonb;val numeric;cost numeric;book numeric;delta numeric;v record;terms_hash text;classcode text;classtype text;withheld numeric;replacement jsonb;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if p_action in('APPROVE','POST','RECOGNIZE','CANCEL_OPERATION')then select * into o from public.investment_operations where id=p_id for update;p_id:=o.contract_id;end if;
 select * into c from public.investment_contracts where id=p_id for update;
 if c.id is null or(c.organization_id is null and c.user_id<>uid)or(c.organization_id is not null and not public.has_organization_permission(c.organization_id,'assets.edit'))then raise exception 'INVESTMENT_ACCESS_DENIED';end if;
 t:=c.terms;org:=c.organization_id;base:=case when org is null then(select base_currency from public.profiles where id=c.user_id)else(select base_currency from public.organizations where id=org)end;
 if p_action='REPLACE'then
  select to_jsonb(n)into replacement from public.investment_contracts n where n.user_id=uid and n.request_id=p_request_id and n.supersedes_id=c.id;
  if replacement is not null then if replacement->'terms'<>p_payload then raise exception 'INVESTMENT_REQUEST_CONFLICT';end if;return replacement;end if;
  if nullif(p_payload->>'organization_id','')::uuid is distinct from org or p_payload->>'ownership_scope'<>t->>'ownership_scope'then raise exception 'INVESTMENT_SCOPE_INVALID';end if;
  perform private.investment_command('CANCEL',c.id,'{}',null);replacement:=private.investment_command('SAVE',null,p_payload,p_request_id);
  update public.investment_contracts set supersedes_id=c.id,version=c.version+1 where id=(replacement->>'id')::uuid returning to_jsonb(investment_contracts)into replacement;return replacement;
 elsif p_action='CANCEL' then
  if c.status<>'DRAFT' or exists(select 1 from public.investment_operations where contract_id=c.id and status<>'CANCELLED')then raise exception 'INVESTMENT_CANCEL_REQUIRES_EMPTY_DRAFT';end if;
  update public.investment_contracts set status='CANCELLED',updated_at=now()where id=c.id;
  update public.asset_accounts set metadata=metadata||jsonb_build_object('investment_status','CANCELLED','archived',true)where id=c.asset_account_id;return jsonb_build_object('status','CANCELLED');

 else raise exception 'INVESTMENT_ACTION_INVALID';end if;
end $$;
revoke all on function private.investment_draft_action(text,uuid,jsonb,uuid)from public,anon,authenticated;

create or replace function private.investment_approval_action(p_action text,p_id uuid,p_payload jsonb,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();c public.investment_contracts%rowtype;o public.investment_operations%rowtype;t jsonb;org uuid;base text;aid uuid;rid uuid;sid uuid;fid uuid;obid uuid;classid uuid;extraid uuid;v_amount numeric;fx numeric;dt date;kind text;lines jsonb;val numeric;cost numeric;book numeric;delta numeric;v record;terms_hash text;classcode text;classtype text;withheld numeric;replacement jsonb;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if p_action in('APPROVE','POST','RECOGNIZE','CANCEL_OPERATION')then select * into o from public.investment_operations where id=p_id for update;p_id:=o.contract_id;end if;
 select * into c from public.investment_contracts where id=p_id for update;
 if c.id is null or(c.organization_id is null and c.user_id<>uid)or(c.organization_id is not null and not public.has_organization_permission(c.organization_id,'assets.edit'))then raise exception 'INVESTMENT_ACCESS_DENIED';end if;
 t:=c.terms;org:=c.organization_id;base:=case when org is null then(select base_currency from public.profiles where id=c.user_id)else(select base_currency from public.organizations where id=org)end;
 if p_action='APPROVE'then
  if o.status in('APPROVED','POSTED')then return to_jsonb(o);end if;
  if o.status<>'PREPARED'then raise exception 'INVESTMENT_APPROVAL_REQUIRED';end if;
  if org is not null then
   if not public.financial_core_can(org,'financial_core.approve')then raise exception 'INVESTMENT_APPROVAL_DENIED';end if;
   if not public.financial_event_has_valid_approval(o.recognition_event_id)then perform public.approve_financial_event(o.recognition_event_id,'Investment operation approval');end if;
   if not public.financial_event_has_valid_approval(o.settlement_event_id)then perform public.approve_financial_event(o.settlement_event_id,'Investment cash operation approval');end if;
  end if;
  update public.investment_operations set status='APPROVED',approved_by=uid where id=o.id returning * into o;return to_jsonb(o);

 else raise exception 'INVESTMENT_ACTION_INVALID';end if;
end $$;
revoke all on function private.investment_approval_action(text,uuid,jsonb,uuid)from public,anon,authenticated;

create or replace function private.investment_recognition_action(p_action text,p_id uuid,p_payload jsonb,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();c public.investment_contracts%rowtype;o public.investment_operations%rowtype;t jsonb;org uuid;base text;aid uuid;rid uuid;sid uuid;fid uuid;obid uuid;classid uuid;extraid uuid;v_amount numeric;fx numeric;dt date;kind text;lines jsonb;val numeric;cost numeric;book numeric;delta numeric;v record;terms_hash text;classcode text;classtype text;withheld numeric;replacement jsonb;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if p_action in('APPROVE','POST','RECOGNIZE','CANCEL_OPERATION')then select * into o from public.investment_operations where id=p_id for update;p_id:=o.contract_id;end if;
 select * into c from public.investment_contracts where id=p_id for update;
 if c.id is null or(c.organization_id is null and c.user_id<>uid)or(c.organization_id is not null and not public.has_organization_permission(c.organization_id,'assets.edit'))then raise exception 'INVESTMENT_ACCESS_DENIED';end if;
 t:=c.terms;org:=c.organization_id;base:=case when org is null then(select base_currency from public.profiles where id=c.user_id)else(select base_currency from public.organizations where id=org)end;
 if p_action='RECOGNIZE'then
  if o.kind<>'INCOME'or org is null or o.status<>'APPROVED'or not public.financial_core_can(org,'financial_core.post')or not public.financial_event_has_valid_approval(o.recognition_event_id)then raise exception 'INVESTMENT_INCOME_RECOGNITION_DENIED';end if;
  if(select status from public.financial_events where id=o.recognition_event_id)='COMMITTED'then perform public.transition_financial_event(o.recognition_event_id,'ACTUAL','Investment income accrued; cash remains separate');end if;return to_jsonb(o);

 else raise exception 'INVESTMENT_ACTION_INVALID';end if;
end $$;
revoke all on function private.investment_recognition_action(text,uuid,jsonb,uuid)from public,anon,authenticated;

create or replace function private.investment_post_action(p_action text,p_id uuid,p_payload jsonb,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();c public.investment_contracts%rowtype;o public.investment_operations%rowtype;t jsonb;org uuid;base text;aid uuid;rid uuid;sid uuid;fid uuid;obid uuid;classid uuid;extraid uuid;v_amount numeric;fx numeric;dt date;kind text;lines jsonb;val numeric;cost numeric;book numeric;delta numeric;v record;terms_hash text;classcode text;classtype text;withheld numeric;replacement jsonb;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if p_action in('APPROVE','POST','RECOGNIZE','CANCEL_OPERATION')then select * into o from public.investment_operations where id=p_id for update;p_id:=o.contract_id;end if;
 select * into c from public.investment_contracts where id=p_id for update;
 if c.id is null or(c.organization_id is null and c.user_id<>uid)or(c.organization_id is not null and not public.has_organization_permission(c.organization_id,'assets.edit'))then raise exception 'INVESTMENT_ACCESS_DENIED';end if;
 t:=c.terms;org:=c.organization_id;base:=case when org is null then(select base_currency from public.profiles where id=c.user_id)else(select base_currency from public.organizations where id=org)end;
 if p_action='POST'then
  if o.status='POSTED'then return to_jsonb(o);end if;
  if o.status<>'APPROVED'then raise exception 'INVESTMENT_APPROVAL_REQUIRED';end if;
  if org is not null then
   if not public.financial_core_can(org,'financial_core.post')or not public.effective_organization_permission(org,'liquidity.settle',o.amount*o.exchange_rate,base)then raise exception 'INVESTMENT_CASH_POST_DENIED';end if;
   perform 1 from public.liquidity_accounts where id=o.account_id for update;
   if o.kind='FUND'and(select current_balance-restricted_balance-uncleared_balance from public.liquidity_accounts where id=o.account_id)<o.amount then raise exception 'INVESTMENT_INSUFFICIENT_FUNDS';end if;
   if not public.financial_event_has_valid_approval(o.recognition_event_id)or not public.financial_event_has_valid_approval(o.settlement_event_id)then raise exception 'INVESTMENT_APPROVAL_REQUIRED';end if;
   if(select status from public.financial_events where id=o.recognition_event_id)='COMMITTED'then perform public.transition_financial_event(o.recognition_event_id,'ACTUAL','Investment recognition');end if;
   select id into obid from public.financial_event_obligations where event_id=o.recognition_event_id and obligation_key='investment-cash';
   perform public.post_financial_settlement(o.settlement_event_id,o.account_id,case when o.kind='FUND'then 'OUTFLOW'else 'INFLOW'end,o.operation_date,o.amount,t->>'currency',o.exchange_rate,o.amount*o.exchange_rate,jsonb_build_array(jsonb_build_object('obligation_id',obid,'flow_id',o.flow_id,'amount',o.amount,'base_amount',o.amount*o.exchange_rate,'flow_amount',o.amount,'flow_currency',t->>'currency','flow_exchange_rate',o.exchange_rate)));
  else perform private.investment_apply_posted(o.id);end if;
  select * into o from public.investment_operations where id=o.id;return to_jsonb(o);

 else raise exception 'INVESTMENT_ACTION_INVALID';end if;
end $$;
revoke all on function private.investment_post_action(text,uuid,jsonb,uuid)from public,anon,authenticated;

create or replace function private.investment_cancel_operation_action(p_action text,p_id uuid,p_payload jsonb,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare uid uuid:=auth.uid();c public.investment_contracts%rowtype;o public.investment_operations%rowtype;t jsonb;org uuid;base text;aid uuid;rid uuid;sid uuid;fid uuid;obid uuid;classid uuid;extraid uuid;v_amount numeric;fx numeric;dt date;kind text;lines jsonb;val numeric;cost numeric;book numeric;delta numeric;v record;terms_hash text;classcode text;classtype text;withheld numeric;replacement jsonb;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if p_action in('APPROVE','POST','RECOGNIZE','CANCEL_OPERATION')then select * into o from public.investment_operations where id=p_id for update;p_id:=o.contract_id;end if;
 select * into c from public.investment_contracts where id=p_id for update;
 if c.id is null or(c.organization_id is null and c.user_id<>uid)or(c.organization_id is not null and not public.has_organization_permission(c.organization_id,'assets.edit'))then raise exception 'INVESTMENT_ACCESS_DENIED';end if;
 t:=c.terms;org:=c.organization_id;base:=case when org is null then(select base_currency from public.profiles where id=c.user_id)else(select base_currency from public.organizations where id=org)end;
 if p_action='CANCEL_OPERATION'then
  if o.status='POSTED'then raise exception 'INVESTMENT_POSTED_OPERATION_IMMUTABLE';end if;
  if org is not null then
   if(select status from public.financial_events where id=o.recognition_event_id)='ACTUAL'or exists(select 1 from public.liquidity_settlements where financial_event_id=o.settlement_event_id)then raise exception 'INVESTMENT_POSTED_OPERATION_IMMUTABLE';end if;
   if(select status from public.financial_events where id=o.recognition_event_id)<>'CANCELLED'then perform public.transition_financial_event(o.recognition_event_id,'CANCELLED','Investment cancelled');end if;
   if(select status from public.financial_events where id=o.settlement_event_id)<>'CANCELLED'then perform public.transition_financial_event(o.settlement_event_id,'CANCELLED','Investment cancelled');end if;
   delete from public.financial_event_links where event_id=o.recognition_event_id and link_type='CASH_FLOW'and target_record_id=o.flow_id;update public.investment_operations set flow_id=null where id=o.id;delete from public.liquidity_flows where id=o.flow_id and settled_amount=0;
  end if;
  update public.investment_operations set status='CANCELLED'where id=o.id returning * into o;perform private.investment_refresh_forecasts(c.id);return to_jsonb(o);
 end if;
end $$;
revoke all on function private.investment_cancel_operation_action(text,uuid,jsonb,uuid)from public,anon,authenticated;
create or replace function private.investment_action(p_action text,p_id uuid,p_payload jsonb,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 case p_action
 when 'REPLACE','CANCEL' then return private.investment_draft_action(p_action,p_id,p_payload,p_request_id);
 when 'APPROVE' then return private.investment_approval_action(p_action,p_id,p_payload,p_request_id);
 when 'RECOGNIZE' then return private.investment_recognition_action(p_action,p_id,p_payload,p_request_id);
 when 'POST' then return private.investment_post_action(p_action,p_id,p_payload,p_request_id);
 when 'CANCEL_OPERATION' then return private.investment_cancel_operation_action(p_action,p_id,p_payload,p_request_id);
 else raise exception 'INVESTMENT_ACTION_INVALID';end case;
end $$;
revoke all on function private.investment_action(text,uuid,jsonb,uuid)from public,anon,authenticated;
create or replace function private.investment_command(p_action text,p_id uuid,p_payload jsonb,p_request_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 if p_action='SAVE'then return private.investment_save(p_action,p_id,p_payload,p_request_id);
 elsif p_action='PREPARE'then return private.investment_prepare(p_action,p_id,p_payload,p_request_id);
 else return private.investment_action(p_action,p_id,p_payload,p_request_id);end if;
end $$;
revoke all on function private.investment_command(text,uuid,jsonb,uuid)from public,anon;
grant execute on function private.investment_command(text,uuid,jsonb,uuid)to authenticated;
create or replace function public.investment_command(p_action text,p_id uuid default null,p_payload jsonb default '{}',p_request_id uuid default null)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.investment_command($1,$2,$3,$4);$$;
revoke all on function public.investment_command(text,uuid,jsonb,uuid)from public,anon;
grant execute on function public.investment_command(text,uuid,jsonb,uuid)to authenticated;


