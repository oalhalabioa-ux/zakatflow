set lock_timeout='5s';
create function private.cancel_participation_movement(p_id uuid,p_reason text)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.participation_movements%rowtype;status text;flow uuid;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into m from public.participation_movements where id=p_id;
 if m.id is null or not public.financial_core_can(m.organization_id,'financial_core.view')or not public.financial_core_can(m.organization_id,'financial_core.create')or length(trim(coalesce(p_reason,'')))not between 15 and 500 then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(m.organization_id::text||'|PARTICIPATION_CONTRACT|'||m.contract_id,0));select * into m from public.participation_movements where id=p_id for update;
 if m.execution_state='CANCELLED'then return jsonb_build_object('id',m.id,'replay',true);end if;
 if m.execution_state<>'PREPARED'or exists(select 1 from public.financial_events where id in(m.recognition_event_id,m.cash_event_id)and status in('ACTUAL','REVERSED'))then raise exception 'POSTED_PARTICIPATION_REQUIRES_CORRECTION';end if;
 select e.status into status from public.financial_events e where e.id=m.recognition_event_id;
 if status<>'CANCELLED'then perform public.transition_financial_event(m.recognition_event_id,'CANCELLED',p_reason);end if;
 if m.cash_event_id is not null then select e.status into status from public.financial_events e where e.id=m.cash_event_id;if status<>'CANCELLED'then perform public.transition_financial_event(m.cash_event_id,'CANCELLED',p_reason);end if;end if;
 flow:=m.flow_id;update public.participation_movements set execution_state='CANCELLED',flow_id=null where id=m.id;
 if flow is not null then delete from public.financial_event_links where event_id in(m.recognition_event_id,m.cash_event_id)and target_module='liquidity_flows'and target_record_id=flow;delete from public.liquidity_flows where id=flow and settled_amount=0;end if;
 return jsonb_build_object('id',m.id,'status','CANCELLED');
end $$;
