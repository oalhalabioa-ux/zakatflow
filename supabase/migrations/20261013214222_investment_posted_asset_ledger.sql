create or replace function private.investment_apply_posted(p_operation_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare o public.investment_operations%rowtype;c public.investment_contracts%rowtype;m jsonb;base text;fx numeric;cost numeric;assetcost numeric;tid uuid;banktid uuid;transfer uuid:=gen_random_uuid();remaining numeric;take numeric;tq numeric;l record;gain numeric;
begin
 select * into o from public.investment_operations where id=p_operation_id for update;
 select * into c from public.investment_contracts where id=o.contract_id for update;
 if auth.uid() is null or c.id is null or(c.organization_id is null and c.user_id<>auth.uid())or(c.organization_id is not null and not public.has_organization_permission(c.organization_id,'assets.edit')) then raise exception 'INVESTMENT_ACCESS_DENIED';end if;
 if o.status='POSTED' then return;end if;
 if o.status<>'APPROVED' then raise exception 'INVESTMENT_APPROVAL_REQUIRED';end if;
 m:=c.terms;fx:=o.exchange_rate;base:=case when c.organization_id is null then(select base_currency from public.profiles where id=c.user_id)else(select base_currency from public.organizations where id=c.organization_id)end;
 cost:=(m->>'principal')::numeric+(m->>'fees')::numeric;assetcost:=case when m->>'instrument'='DEPOSIT' then(m->>'principal')::numeric else cost end;
 if c.organization_id is not null then
  if not exists(select 1 from public.financial_events e join public.liquidity_settlements s on s.financial_event_id=e.id where e.id=o.settlement_event_id and e.status='ACTUAL' and s.status='POSTED' and s.organization_id=c.organization_id and s.account_id=o.account_id and s.amount=o.amount and s.exchange_rate=o.exchange_rate and s.currency=m->>'currency'and s.settlement_date=o.operation_date and s.direction=case when o.kind='FUND'then 'OUTFLOW'else 'INFLOW'end and exists(select 1 from public.financial_event_obligation_allocations al join public.financial_event_obligations ob on ob.id=al.obligation_id where al.application_event_id=o.settlement_event_id and ob.event_id=o.recognition_event_id and al.base_amount=o.amount*o.exchange_rate)) then raise exception 'INVESTMENT_CASH_POST_REQUIRED';end if;
  if o.kind='FUND'and(select current_balance-restricted_balance-uncleared_balance from public.liquidity_accounts where id=o.account_id)<0 then raise exception 'INVESTMENT_INSUFFICIENT_FUNDS';end if;
 else
  if o.approved_by<>auth.uid() then raise exception 'INVESTMENT_APPROVAL_REQUIRED';end if;
  perform 1 from public.asset_accounts a where a.id=o.account_id and a.user_id=c.user_id and a.ownership_scope='PERSONAL' and a.asset_type in('BANK','CASH') and a.currency=m->>'currency' for update;
  if not found then raise exception 'INVESTMENT_BANK_SCOPE_MISMATCH';end if;
  if o.kind='FUND' then
   perform 1 from public.lots where asset_account_id=o.account_id and remaining_value_base>0 order by id for update;
   remaining:=o.amount*fx;
   if coalesce((select sum(remaining_value_base)from public.lots where asset_account_id=o.account_id and user_id=c.user_id and acquisition_date<=o.operation_date and remaining_quantity>0),0)<remaining then raise exception 'INVESTMENT_INSUFFICIENT_FUNDS';end if;
   insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,transfer_id,metadata,created_by)
   values(c.user_id,o.account_id,'TRANSFER_OUT',o.operation_date,0,m->>'currency',o.amount,base,o.amount*fx,transfer,jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id,'investment_id',c.id,'fx_rate',fx),auth.uid()) returning id into banktid;
  else
   insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,transfer_id,metadata,created_by)
   values(c.user_id,o.account_id,case when o.kind='INCOME' then 'ADD'::public.transaction_type else 'TRANSFER_IN'::public.transaction_type end,o.operation_date,o.amount,m->>'currency',o.amount,base,o.amount*fx,transfer,jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id,'investment_id',c.id,'fx_rate',fx),auth.uid()) returning id into banktid;
   if o.kind='INCOME' then
    insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,origin_hawl_start_date,zakatable_pool_entered_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)
    values(c.user_id,o.account_id,banktid,o.operation_date,o.operation_date,o.operation_date,o.operation_date,o.amount,o.amount,o.amount*fx,o.amount*fx,'ACTIVE',jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id));
   end if;
  end if;
 end if;
 if o.kind='FUND' then
  if c.status<>'DRAFT' then raise exception 'INVESTMENT_ALREADY_FUNDED';end if;
  insert into public.transactions(user_id,asset_account_id,organization_id,entity_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,transfer_id,reference,metadata,created_by)
  values(c.user_id,c.asset_account_id,c.organization_id,nullif(m->>'entity_id','')::uuid,case when m->>'instrument'='DEPOSIT' then 'TRANSFER_IN'::public.transaction_type else 'PURCHASE'::public.transaction_type end,o.operation_date,1,m->>'currency',assetcost,base,assetcost*fx,transfer,m->>'reference',jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id,'investment_id',c.id,'fx_rate',fx,'asset_effect_base',assetcost*fx),auth.uid())returning id into tid;
  if c.organization_id is null then
   for l in select * from public.lots where asset_account_id=o.account_id and user_id=c.user_id and remaining_quantity>0 and remaining_value_base>0 and acquisition_date<=o.operation_date order by acquisition_date,created_at,id for update loop
    exit when remaining<=0;take:=least(remaining,l.remaining_value_base);tq:=l.remaining_quantity*take/l.remaining_value_base;
    insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method)values(c.user_id,banktid,l.id,tq,take,'FIFO');
    update public.lots set remaining_quantity=greatest(0,remaining_quantity-tq),remaining_value_base=greatest(0,remaining_value_base-take),status=case when take=l.remaining_value_base then 'CLOSED'::public.lot_status else 'PARTIALLY_USED'::public.lot_status end where id=l.id;
    insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,origin_hawl_start_date,zakatable_pool_entered_date,hawl_continuity_source_lot_id,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)
    values(c.user_id,c.asset_account_id,tid,o.operation_date,l.hawl_start_date,coalesce(l.origin_hawl_start_date,l.hawl_start_date),l.zakatable_pool_entered_date,l.id,take/(o.amount*fx),take/(o.amount*fx),take*assetcost/cost,take*assetcost/cost,'ACTIVE',jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id,'base_currency',base));
    remaining:=remaining-take;
   end loop;
   if remaining>0 then raise exception 'INVESTMENT_INSUFFICIENT_FUNDS';end if;
   update public.transactions set quantity=(select sum(quantity)from public.transaction_allocations where transaction_id=banktid)where id=banktid;
  else
   insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)
   values(c.user_id,c.asset_account_id,tid,o.operation_date,1,1,assetcost*fx,assetcost*fx,'ACTIVE',jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id,'base_currency',base));
  end if;
  update public.investment_contracts set status='ACTIVE',updated_at=now()where id=c.id;
  update public.asset_accounts set metadata=metadata||jsonb_build_object('investment_status','ACTIVE')where id=c.asset_account_id;
 elsif o.kind='REDEEM' then
  if c.status<>'ACTIVE' then raise exception 'INVESTMENT_NOT_ACTIVE';end if;
  perform 1 from public.lots where asset_account_id=c.asset_account_id order by id for update;
  gain:=o.amount*fx-coalesce((select sum(remaining_value_base)from public.lots where asset_account_id=c.asset_account_id),0);
  insert into public.transactions(user_id,asset_account_id,organization_id,entity_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,transfer_id,metadata,created_by)
  values(c.user_id,c.asset_account_id,c.organization_id,nullif(m->>'entity_id','')::uuid,'TRANSFER_OUT',o.operation_date,1,m->>'currency',o.amount,base,o.amount*fx,transfer,jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id,'investment_id',c.id,'asset_effect_base',-coalesce((select sum(remaining_value_base)from public.lots where asset_account_id=c.asset_account_id),0),'realized_gain_base',gain,'fx_rate',fx),auth.uid())returning id into tid;
  for l in select * from public.lots where asset_account_id=c.asset_account_id and remaining_quantity>0 for update loop
   insert into public.transaction_allocations(user_id,transaction_id,lot_id,quantity,value_base,allocation_method)values(c.user_id,tid,l.id,l.remaining_quantity,l.remaining_value_base,'FIFO');
   if c.organization_id is null then
    insert into public.lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,origin_hawl_start_date,zakatable_pool_entered_date,hawl_continuity_source_lot_id,original_quantity,remaining_quantity,original_value_base,remaining_value_base,status,metadata)
    values(c.user_id,o.account_id,banktid,o.operation_date,l.hawl_start_date,coalesce(l.origin_hawl_start_date,l.hawl_start_date),l.zakatable_pool_entered_date,l.id,o.amount*l.remaining_quantity,o.amount*l.remaining_quantity,o.amount*fx*l.remaining_quantity,o.amount*fx*l.remaining_quantity,'ACTIVE',jsonb_build_object('source','INVESTMENTS','investment_operation_id',o.id));
   end if;
   update public.lots set remaining_quantity=0,remaining_value_base=0,status='CLOSED'where id=l.id;
  end loop;
  update public.investment_contracts set status='CLOSED',updated_at=now()where id=c.id;
  update public.asset_accounts set metadata=metadata||jsonb_build_object('investment_status','CLOSED')where id=c.asset_account_id;
 end if;
 if c.organization_id is not null then update public.liquidity_flows set status='ACTUAL'where id=o.flow_id;end if;
 update public.investment_operations set status='POSTED',posted_by=auth.uid(),posted_at=now()where id=o.id;
 perform private.investment_refresh_forecasts(c.id);
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data)values(auth.uid(),'investment',c.id,'INVESTMENT_'||o.kind,jsonb_build_object('operation_id',o.id,'amount',o.amount,'currency',m->>'currency','date',o.operation_date));
end $$;
revoke all on function private.investment_apply_posted(uuid) from public,anon,authenticated;


