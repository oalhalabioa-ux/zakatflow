set lock_timeout='5s';
create function private.post_participation_movement(p_id uuid)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare m public.participation_movements%rowtype;c public.participation_contracts%rowtype;e public.financial_events%rowtype;cash public.financial_events%rowtype;ob uuid;flow uuid;r jsonb;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into m from public.participation_movements where id=p_id;
 if m.id is null or not public.financial_core_can(m.organization_id,'financial_core.view')or not public.financial_core_can(m.organization_id,'financial_core.post')then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(m.organization_id::text||'|PARTICIPATION_CONTRACT|'||m.contract_id,0));
 select * into m from public.participation_movements where id=p_id for update;select * into c from public.participation_contracts where id=m.contract_id;
 if m.execution_state='POSTED'then return jsonb_build_object('id',m.id,'replay',true);end if;
 if c.state in('CANCELLED','CLOSED')or m.execution_state<>'PREPARED'then raise exception 'PARTICIPATION_MOVEMENT_STATE_INVALID';end if;
 select * into e from public.financial_events where id=m.recognition_event_id for update;
 if e.status<>'COMMITTED'or not public.financial_event_has_valid_approval(e.id)then raise exception 'VALID_APPROVAL_REQUIRED';end if;
 if m.cash_event_id is not null then select * into cash from public.financial_events where id=m.cash_event_id for update;if cash.status<>'COMMITTED'or not public.financial_event_has_valid_approval(cash.id)then raise exception 'VALID_APPROVAL_REQUIRED';end if;end if;
 if exists(select 1 from public.participation_movements a join public.financial_events ae on ae.id=a.recognition_event_id where a.contract_id=c.id and ae.status='ACTUAL'and a.event_date>m.event_date)then raise exception 'PARTICIPATION_MOVEMENT_CHRONOLOGY';end if;
 update public.participation_movements set execution_state='POSTING'where id=m.id;
 perform public.transition_financial_event(e.id,'ACTUAL','Approved participation recognition');
 if m.kind='CAPITAL_RECEIPT'then
  r:=public.post_financial_nonallocating_cash(m.cash_event_id,m.recognition_event_id,m.flow_id,m.account_id,'INFLOW',m.event_date,m.amount,c.currency,c.exchange_rate,round(m.amount*c.exchange_rate,4),c.capital_treatment);
 elsif m.kind in('CAPITAL_RETURN','PROFIT')then
  select id into ob from public.financial_event_obligations where event_id=m.recognition_event_id and adjusts_obligation_id is null;
  flow:=private.ensure_debt_flow(ob);
  update public.participation_movements set flow_id=flow where id=m.id;
 end if;
 update public.participation_movements set execution_state='POSTED'where id=m.id;update public.participation_contracts set state='ACTIVE'where id=c.id and state='DRAFT';return jsonb_build_object('id',m.id,'status','POSTED');
end $$;
revoke all on function private.post_participation_movement(uuid)from public,anon;grant execute on function private.post_participation_movement(uuid)to authenticated;
create function public.post_participation_movement(p_id uuid)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.post_participation_movement(p_id);$$;
revoke all on function public.post_participation_movement(uuid)from public,anon;grant execute on function public.post_participation_movement(uuid)to authenticated;

