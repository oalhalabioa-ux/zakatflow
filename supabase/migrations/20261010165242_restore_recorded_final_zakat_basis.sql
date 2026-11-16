-- Preserve recorded financial amounts; repair only an unambiguous legacy final basis
-- already supported by a payment against an assessment with the same frozen due.
do $$
declare c record;a public.zakat_assessments%rowtype; n integer;
begin
 for c in select * from public.zakat_hawl_cycles where final_assessment_id is null and final_zakat_due is not null and status in ('OPEN','ACTIVE') loop
  select count(*) into n from public.zakat_assessments x where x.user_id=c.user_id and x.hawl_cycle_id=c.id and x.zakat_due=c.final_zakat_due and x.status::text not in ('DRAFT','CANCELLED') and exists(select 1 from public.zakat_payments p where p.user_id=c.user_id and p.hawl_cycle_id=c.id and p.assessment_id=x.id);
  if n<>1 then continue;end if;
  select * into a from public.zakat_assessments x where x.user_id=c.user_id and x.hawl_cycle_id=c.id and x.zakat_due=c.final_zakat_due and x.status::text not in ('DRAFT','CANCELLED') and exists(select 1 from public.zakat_payments p where p.user_id=c.user_id and p.hawl_cycle_id=c.id and p.assessment_id=x.id);
  update public.zakat_assessments set assessment_kind='FINAL' where id=a.id;
  update public.zakat_hawl_cycles set final_assessment_id=a.id,assessment_id=a.id,status='CLOSED',closed_at=coalesce(closed_at,now()),snapshot=coalesce(snapshot,'{}')||jsonb_build_object('finalValuation',a.calculation_snapshot,'legacyFinalBasisRestored',true,'retainedLatestAssessmentId',c.assessment_id) where id=c.id;
  insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data) values(c.user_id,'zakat_hawl_cycle',c.id,'RESTORE_RECORDED_FINAL_BASIS',to_jsonb(c),jsonb_build_object('final_assessment_id',a.id,'final_zakat_due',c.final_zakat_due,'payment_amounts_unchanged',true));
 end loop;
end $$;

create or replace function public.allocate_zakat_payment_fifo(p_payment_id uuid)
returns table(assessment_line_id uuid,asset_account_id uuid,allocated_amount numeric,due_date date)
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'UNAUTHORIZED';end if;
 if not exists(select 1 from public.zakat_payments where id=p_payment_id and user_id=auth.uid()) then raise exception 'PAYMENT_NOT_FOUND';end if;
 perform public.reconcile_final_zakat_payments();
 return query select pa.assessment_line_id,pa.asset_account_id,pa.allocated_amount,pa.due_date from public.zakat_payment_allocations pa where pa.payment_id=p_payment_id and pa.user_id=auth.uid() order by pa.due_date,pa.created_at;
end $$;
revoke all on function public.allocate_zakat_payment_fifo(uuid) from public,anon;
grant execute on function public.allocate_zakat_payment_fifo(uuid) to authenticated;

