-- Cancel an unused open assessment atomically. Valuation snapshots and lines remain
-- intact for audit; an older superseded estimate is never silently reactivated.
create or replace function public.cancel_open_zakat_assessment(p_assessment_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();a public.zakat_assessments%rowtype;c public.zakat_hawl_cycles%rowtype;was_current boolean:=false;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 select * into a from public.zakat_assessments where id=p_assessment_id and user_id=uid;
 if a.id is null then raise exception 'ASSESSMENT_NOT_FOUND';end if;
 if a.hawl_cycle_id is not null then
  select * into c from public.zakat_hawl_cycles where id=a.hawl_cycle_id and user_id=uid for update;
  if c.id is null or c.status not in ('OPEN','ACTIVE') or c.final_assessment_id is not null or c.final_zakat_due is not null then raise exception 'ASSESSMENT_PROTECTED';end if;
 end if;
 select * into a from public.zakat_assessments where id=p_assessment_id and user_id=uid for update;
 if a.assessment_kind='FINAL' or exists(select 1 from public.zakat_hawl_cycles where user_id=uid and final_assessment_id=a.id)
  or exists(select 1 from public.zakat_payments where user_id=uid and assessment_id=a.id)
  or exists(select 1 from public.zakat_payment_allocations where user_id=uid and assessment_id=a.id)
 then raise exception 'ASSESSMENT_PROTECTED';end if;
 if a.status::text='CANCELLED' then return jsonb_build_object('ok',true,'id',a.id,'already_cancelled',true);end if;
 was_current:=c.assessment_id=a.id;
 update public.zakat_assessments set status='CANCELLED' where id=a.id and user_id=uid;
 if was_current then update public.zakat_hawl_cycles set assessment_id=null where id=c.id and user_id=uid;end if;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data)
 values(uid,'zakat_assessment',a.id,'CANCEL_OPEN_ASSESSMENT',to_jsonb(a),jsonb_build_object('status','CANCELLED','requires_recalculation',coalesce(was_current,false),'snapshots_preserved',true));
 return jsonb_build_object('ok',true,'id',a.id,'requires_recalculation',coalesce(was_current,false));
end $$;
revoke all on function public.cancel_open_zakat_assessment(uuid) from public,anon;
grant execute on function public.cancel_open_zakat_assessment(uuid) to authenticated;
