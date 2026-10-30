create function private.finish_participation_contract(p_id uuid,p_action text,p_reason text)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.participation_contracts%rowtype;net numeric;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 select * into c from public.participation_contracts where id=p_id;
 if c.id is null or not public.financial_core_can(c.organization_id,'financial_core.view')or not public.financial_core_can(c.organization_id,'financial_core.post')or p_action is null or p_action not in('CLOSE','CANCEL')or length(trim(coalesce(p_reason,'')))not between 15 and 500 then raise exception 'PARTICIPATION_ACCESS_DENIED';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.organization_id::text||'|PARTICIPATION_CONTRACT|'||c.id,0));select * into c from public.participation_contracts where id=p_id for update;
 if c.state=(case when p_action='CLOSE'then 'CLOSED'else 'CANCELLED'end)then return jsonb_build_object('id',c.id,'replay',true);end if;
 if c.state in('CANCELLED','CLOSED')then raise exception 'PARTICIPATION_CONTRACT_CLOSED';end if;
 if exists(select 1 from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id and e.status in('DRAFT','PLANNED','COMMITTED'))then raise exception 'PARTICIPATION_PENDING_MOVEMENTS';end if;
 if p_action='CANCEL'and exists(select 1 from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id and e.status='ACTUAL')then raise exception 'PARTICIPATION_HAS_POSTED_MOVEMENTS';end if;
 if p_action='CLOSE'then
  select coalesce(sum(case when m.kind='CAPITAL_RECEIPT'then m.amount when m.kind in('CAPITAL_RETURN','LOSS')then -m.amount else 0 end),0)into net from public.participation_movements m join public.financial_events e on e.id=m.recognition_event_id where m.contract_id=c.id and e.status='ACTUAL';
  if net<>0 or exists(select 1 from public.participation_movements m join public.financial_event_obligation_balances b on b.event_id=m.recognition_event_id where m.contract_id=c.id and b.outstanding_base_amount>0)then raise exception 'PARTICIPATION_OPEN_CAPITAL_OR_DISTRIBUTIONS';end if;
 end if;
 update public.participation_contracts set state=case when p_action='CLOSE'then 'CLOSED'else 'CANCELLED'end where id=c.id;
 insert into public.audit_logs(user_id,organization_id,entity_type,entity_id,action,new_data)values(auth.uid(),c.organization_id,'participation_contract',c.id,p_action,jsonb_build_object('reason',p_reason));return jsonb_build_object('id',c.id,'state',case when p_action='CLOSE'then 'CLOSED'else 'CANCELLED'end);
end $$;
revoke all on function private.finish_participation_contract(uuid,text,text)from public,anon;grant execute on function private.finish_participation_contract(uuid,text,text)to authenticated;
create function public.finish_participation_contract(p_id uuid,p_action text,p_reason text)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.finish_participation_contract(p_id,p_action,p_reason);$$;
revoke all on function public.finish_participation_contract(uuid,text,text)from public,anon;grant execute on function public.finish_participation_contract(uuid,text,text)to authenticated;
