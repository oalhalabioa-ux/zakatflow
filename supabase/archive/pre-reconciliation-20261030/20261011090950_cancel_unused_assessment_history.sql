-- Also allow unused historical previews in a closed cycle to be archived.
-- The final assessment, current closed-cycle pointer, payments and prices stay protected.
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
  if c.id is null then raise exception 'ASSESSMENT_PROTECTED';end if;
 end if;
 select * into a from public.zakat_assessments where id=p_assessment_id and user_id=uid for update;
 if a.assessment_kind='FINAL' or a.status::text in ('CONFIRMED','PARTIALLY_PAID','PAID') or exists(select 1 from public.zakat_hawl_cycles where user_id=uid and final_assessment_id=a.id)
  or exists(select 1 from public.zakat_payments where user_id=uid and assessment_id=a.id)
  or exists(select 1 from public.zakat_payment_allocations where user_id=uid and assessment_id=a.id)
 then raise exception 'ASSESSMENT_PROTECTED';end if;
 if a.status::text='CANCELLED' then return jsonb_build_object('ok',true,'id',a.id,'already_cancelled',true);end if;
 was_current:=coalesce(c.assessment_id=a.id,false);
 if c.id is not null and (c.status not in ('OPEN','ACTIVE') or c.final_assessment_id is not null or c.final_zakat_due is not null) and was_current then raise exception 'ASSESSMENT_PROTECTED';end if;
 update public.zakat_assessments set status='CANCELLED' where id=a.id and user_id=uid;
 if was_current then update public.zakat_hawl_cycles set assessment_id=null where id=c.id and user_id=uid;end if;
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data)
 values(uid,'zakat_assessment',a.id,'CANCEL_UNUSED_ASSESSMENT',to_jsonb(a),jsonb_build_object('status','CANCELLED','requires_recalculation',coalesce(was_current,false),'snapshots_preserved',true));
 return jsonb_build_object('ok',true,'id',a.id,'requires_recalculation',coalesce(was_current,false));
end $$;
revoke all on function public.cancel_open_zakat_assessment(uuid) from public,anon;
grant execute on function public.cancel_open_zakat_assessment(uuid) to authenticated;

-- A closed cycle freezes financial snapshots, but an unused preview can be hidden.
-- This exception changes only status; direct edits to prices, amounts or links stay blocked.
create or replace function public.guard_zakat_assessment_snapshot()
returns trigger language plpgsql security invoker set search_path='' as $$
declare closed boolean;locked boolean;unused_preview boolean;
begin
 select exists(select 1 from public.zakat_hawl_cycles c where c.id=old.hawl_cycle_id and c.status in ('CLOSED','PAID')) into closed;
 locked:=closed or coalesce((old.calculation_snapshot->>'schemaVersion')::integer,0)>=2;
 if tg_op='DELETE' then
  if locked then raise exception 'ASSESSMENT_SNAPSHOT_LOCKED';end if;return old;
 end if;
 unused_preview:=new.status::text='CANCELLED' and old.status::text in ('DRAFT','CALCULATED')
  and old.assessment_kind is distinct from 'FINAL'
  and (to_jsonb(new)-'status') is not distinct from (to_jsonb(old)-'status')
  and not exists(select 1 from public.zakat_hawl_cycles c where c.final_assessment_id=old.id or c.assessment_id=old.id)
  and not exists(select 1 from public.zakat_payments p where p.assessment_id=old.id)
  and not exists(select 1 from public.zakat_payment_allocations p where p.assessment_id=old.id);
 if closed and (new.status is distinct from old.status or new.superseded_by is distinct from old.superseded_by) and not unused_preview then raise exception 'CLOSED_CYCLE_ASSESSMENT_LOCKED';end if;
 if locked and (to_jsonb(new)-array['status','assessment_kind','superseded_by']) is distinct from (to_jsonb(old)-array['status','assessment_kind','superseded_by']) then
  raise exception 'ASSESSMENT_SNAPSHOT_LOCKED';
 end if;
 if new.status::text='CANCELLED' and exists(select 1 from public.zakat_payment_allocations where assessment_id=old.id) then raise exception 'ASSESSMENT_HAS_PAYMENTS';end if;
 return new;
end $$;
