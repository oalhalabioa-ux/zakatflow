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

-- A single user lock serializes finalization and payment creation/edit/deletion.
-- Compute the complete desired ledger; unchanged allocation rows retain their IDs.
create or replace function public.reconcile_final_zakat_payments()
returns void language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();p record;c record;l record;d jsonb;desired jsonb:='[]';
 remaining numeric;cycle_open numeric;line_open numeric;take numeric;existing uuid;cycle_paid numeric;idx integer;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 perform 1 from public.zakat_hawl_cycles where user_id=uid order by cycle_no,id for update;
 perform 1 from public.zakat_payments where user_id=uid order by payment_date,created_at,id for update;
 -- Preserve previously posted allocations. Only an edited/deleted/backdated payment
 -- explicitly reflows the affected part of the ledger in write_zakat_payment.
 if exists(select 1 from public.zakat_payment_allocations pa join public.zakat_hawl_cycles vc on vc.id=pa.hawl_cycle_id where pa.user_id=uid and (pa.assessment_id is distinct from vc.final_assessment_id or vc.final_assessment_id is null)) then raise exception 'EXISTING_ALLOCATION_FINAL_BASIS_REQUIRES_REVIEW';end if;
 if exists(select 1 from public.zakat_payments vp where vp.user_id=uid and (select coalesce(sum(allocated_amount),0) from public.zakat_payment_allocations where payment_id=vp.id and user_id=uid)>vp.base_amount) then raise exception 'EXISTING_PAYMENT_OVERALLOCATED';end if;
 if exists(select 1 from public.zakat_hawl_cycles vc where vc.user_id=uid and (select coalesce(sum(allocated_amount),0) from public.zakat_payment_allocations where hawl_cycle_id=vc.id and user_id=uid)>vc.final_zakat_due) then raise exception 'EXISTING_CYCLE_OVERALLOCATED';end if;
 select coalesce(jsonb_agg(jsonb_build_object('payment',pa.payment_id,'cycle',pa.hawl_cycle_id,'assessment',pa.assessment_id,'line',pa.assessment_line_id,'lot',pa.lot_id,'asset',pa.asset_account_id,'due',pa.due_date,'amount',pa.allocated_amount,'allocation',pa.id)),'[]') into desired from public.zakat_payment_allocations pa where pa.user_id=uid;

 for p in select * from public.zakat_payments where user_id=uid order by payment_date,created_at,id loop
  select p.base_amount-coalesce(sum((x->>'amount')::numeric),0) into remaining from jsonb_array_elements(desired) x where x->>'payment'=p.id::text;
  for c in select * from public.zakat_hawl_cycles where user_id=uid and not coalesce((snapshot->>'historical_settled')::boolean,false) order by cycle_no,hawl_due_date,id loop
   exit when remaining<=0;
   -- Never skip an earlier cycle whose final liability is not established.
   exit when c.final_assessment_id is null or c.final_zakat_due is null;
   if not exists(select 1 from public.zakat_assessments a where a.id=c.final_assessment_id and a.user_id=uid and a.hawl_cycle_id=c.id and a.status::text not in ('DRAFT','CANCELLED') and a.zakat_due=c.final_zakat_due) then raise exception 'FINAL_BASIS_INVALID';end if;
   if (select coalesce(sum(zakat_amount),0) from public.zakat_assessment_lines where assessment_id=c.final_assessment_id) is distinct from c.final_zakat_due then raise exception 'FINAL_LINES_TOTAL_MISMATCH';end if;
   select greatest(0,c.final_zakat_due-coalesce(sum((x->>'amount')::numeric),0)) into cycle_open from jsonb_array_elements(desired) x where x->>'cycle'=c.id::text;
   for l in select al.id,al.lot_id,al.zakat_amount,lot.asset_account_id,coalesce(nullif(al.valuation_snapshot->>'hawlDueDate','')::date,c.hawl_due_date,lot.hawl_due_date) due_date from public.zakat_assessment_lines al left join public.lots lot on lot.id=al.lot_id and lot.user_id=uid where al.assessment_id=c.final_assessment_id and al.zakat_amount>0 order by coalesce(nullif(al.valuation_snapshot->>'hawlDueDate','')::date,c.hawl_due_date,lot.hawl_due_date),al.id loop
    exit when remaining<=0 or cycle_open<=0;
    select greatest(0,l.zakat_amount-coalesce(sum((x->>'amount')::numeric),0)) into line_open from jsonb_array_elements(desired) x where x->>'line'=l.id::text;
    take:=least(remaining,cycle_open,line_open);
    if take<=0 then continue;end if;
    select (ordinality-1)::integer into idx from jsonb_array_elements(desired) with ordinality x(value,ordinality) where value->>'payment'=p.id::text and value->>'line'=l.id::text limit 1;
    if idx is null then
     desired:=desired||jsonb_build_array(jsonb_build_object('payment',p.id,'cycle',c.id,'assessment',c.final_assessment_id,'line',l.id,'lot',l.lot_id,'asset',l.asset_account_id,'due',l.due_date,'amount',take));
    else
     desired:=jsonb_set(desired,array[idx::text,'amount'],to_jsonb((desired->idx->>'amount')::numeric+take));
    end if;
    remaining:=remaining-take;cycle_open:=cycle_open-take;
   end loop;
  end loop;
 end loop;
 for d in select value from jsonb_array_elements(desired) loop
  select id into existing from public.zakat_payment_allocations where user_id=uid and payment_id=(d->>'payment')::uuid and assessment_line_id=(d->>'line')::uuid order by created_at,id limit 1;
  if existing is null then
   insert into public.zakat_payment_allocations(user_id,payment_id,hawl_cycle_id,assessment_id,assessment_line_id,lot_id,asset_account_id,due_date,allocated_amount) values(uid,(d->>'payment')::uuid,(d->>'cycle')::uuid,(d->>'assessment')::uuid,(d->>'line')::uuid,(d->>'lot')::uuid,(d->>'asset')::uuid,(d->>'due')::date,(d->>'amount')::numeric) returning id into existing;
  else
   update public.zakat_payment_allocations set allocated_amount=(d->>'amount')::numeric,hawl_cycle_id=(d->>'cycle')::uuid,assessment_id=(d->>'assessment')::uuid where id=existing and (allocated_amount is distinct from (d->>'amount')::numeric or hawl_cycle_id is distinct from (d->>'cycle')::uuid or assessment_id is distinct from (d->>'assessment')::uuid);
  end if;
  d:=d||jsonb_build_object('allocation',existing);
  desired:=jsonb_set(desired,array[(select (ordinality-1)::text from jsonb_array_elements(desired) with ordinality x(value,ordinality) where value->>'payment'=d->>'payment' and value->>'line'=d->>'line' limit 1)],d);
 end loop;
 delete from public.zakat_payment_allocations pa where pa.user_id=uid and not exists(select 1 from jsonb_array_elements(desired) x where x->>'allocation'=pa.id::text);
 for c in select * from public.zakat_hawl_cycles where user_id=uid and final_assessment_id is not null and not coalesce((snapshot->>'historical_settled')::boolean,false) loop
  select coalesce(sum(allocated_amount),0) into cycle_paid from public.zakat_payment_allocations where user_id=uid and hawl_cycle_id=c.id;
  update public.zakat_hawl_cycles set status=case when cycle_paid>=final_zakat_due then 'PAID' else 'CLOSED' end where id=c.id and status is distinct from case when cycle_paid>=final_zakat_due then 'PAID' else 'CLOSED' end;
 end loop;
end $$;
revoke all on function public.reconcile_final_zakat_payments() from public,anon;
grant execute on function public.reconcile_final_zakat_payments() to authenticated;

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

create or replace function public.write_zakat_payment(p_input jsonb,p_payment_id uuid default null,p_delete boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();old public.zakat_payments%rowtype;p public.zakat_payments%rowtype;c public.zakat_hawl_cycles%rowtype;curr text;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 if p_payment_id is not null then
  select * into old from public.zakat_payments where id=p_payment_id and user_id=uid for update;
  if old.id is null then raise exception 'PAYMENT_NOT_FOUND';end if;
 end if;
 if p_delete then
  if old.id is null then raise exception 'PAYMENT_ID_REQUIRED';end if;
  delete from public.zakat_payment_allocations pa using public.zakat_payments q where pa.payment_id=q.id and pa.user_id=uid and q.user_id=uid and q.payment_date>=old.payment_date;
  delete from public.zakat_payments where id=old.id and user_id=uid;
 else
  select * into c from public.zakat_hawl_cycles where id=(p_input->>'hawl_cycle_id')::uuid and user_id=uid;
  if c.id is null then raise exception 'PAYMENT_CYCLE_REQUIRED';end if;
  if c.final_assessment_id is null then raise exception 'CYCLE_NOT_FINALIZED';end if;
  if coalesce((c.snapshot->>'historical_settled')::boolean,false) then raise exception 'HISTORICAL_CYCLE_ALREADY_SETTLED';end if;
  if coalesce((p_input->>'amount')::numeric,0)<=0 or coalesce((p_input->>'base_amount')::numeric,0)<=0 or p_input->>'payment_date' is null then raise exception 'PAYMENT_AMOUNT_INVALID';end if;
  select base_currency into curr from public.profiles where id=uid;
  if length(p_input->>'currency')<>3 or ((p_input->>'currency')=curr and (p_input->>'amount')::numeric is distinct from (p_input->>'base_amount')::numeric) then raise exception 'PAYMENT_CURRENCY_INVALID';end if;
  -- Reflow later payments if chronology or amount changes. Earlier posted
  -- allocations remain untouched, including the user's original payment.
  delete from public.zakat_payment_allocations pa using public.zakat_payments q where pa.payment_id=q.id and pa.user_id=uid and q.user_id=uid and q.payment_date>=least(coalesce(old.payment_date,(p_input->>'payment_date')::date),(p_input->>'payment_date')::date);
  if old.id is null then
   insert into public.zakat_payments(user_id,assessment_id,hawl_cycle_id,payment_date,amount,currency,base_amount,beneficiary,reference,notes) values(uid,c.final_assessment_id,c.id,(p_input->>'payment_date')::date,(p_input->>'amount')::numeric,p_input->>'currency',(p_input->>'base_amount')::numeric,p_input->>'beneficiary',p_input->>'reference',p_input->>'notes') returning * into p;
  else
   update public.zakat_payments set assessment_id=c.final_assessment_id,hawl_cycle_id=c.id,payment_date=(p_input->>'payment_date')::date,amount=(p_input->>'amount')::numeric,currency=p_input->>'currency',base_amount=(p_input->>'base_amount')::numeric,beneficiary=p_input->>'beneficiary',reference=p_input->>'reference',notes=p_input->>'notes' where id=old.id and user_id=uid returning * into p;
  end if;
 end if;
 perform public.reconcile_final_zakat_payments();
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data) values(uid,'zakat_payment',coalesce(p.id,old.id),case when p_delete then 'DELETE_AND_REFLOW_FINAL_FIFO' when old.id is null then 'CREATE_FINAL_FIFO_WITH_CREDIT' else 'UPDATE_AND_REFLOW_FINAL_FIFO' end,case when old.id is not null then to_jsonb(old) end,case when not p_delete then to_jsonb(p) end);
 return case when p_delete then jsonb_build_object('ok',true,'id',old.id) else to_jsonb(p) end;
end $$;
revoke all on function public.write_zakat_payment(jsonb,uuid,boolean) from public,anon;
grant execute on function public.write_zakat_payment(jsonb,uuid,boolean) to authenticated;

create or replace function public.close_zakat_cycle(p_cycle_id uuid,p_final_assessment_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid();c public.zakat_hawl_cycles%rowtype;a public.zakat_assessments%rowtype;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 perform pg_advisory_xact_lock(hashtextextended('zakat-snapshot:'||uid::text,0));
 select * into c from public.zakat_hawl_cycles where id=p_cycle_id and user_id=uid for update;
 if c.id is null or c.status not in ('OPEN','ACTIVE') or c.final_assessment_id is not null then raise exception 'ACTIVE_CYCLE_NOT_FOUND';end if;
 select * into a from public.zakat_assessments where id=p_final_assessment_id and user_id=uid and hawl_cycle_id=c.id;
 if a.id is null or a.status::text in ('DRAFT','CANCELLED') or a.superseded_by is not null or c.assessment_id is distinct from a.id then raise exception 'FINAL_ASSESSMENT_NOT_IN_CYCLE';end if;
 if c.final_zakat_due is not null and c.final_zakat_due is distinct from a.zakat_due then raise exception 'RECORDED_FINAL_BASIS_REQUIRES_REVIEW';end if;
 update public.zakat_assessments set assessment_kind='FINAL' where id=a.id and user_id=uid;
 update public.zakat_hawl_cycles set status='CLOSED',final_assessment_id=a.id,final_zakat_due=a.zakat_due,closed_at=now(),assessment_id=a.id,snapshot=coalesce(snapshot,'{}')||jsonb_build_object('finalValuation',a.calculation_snapshot) where id=c.id and user_id=uid;
 perform public.reconcile_final_zakat_payments();
 insert into public.audit_logs(user_id,entity_type,entity_id,action,new_data) values(uid,'zakat_hawl_cycle',c.id,'FINALIZE_AND_APPLY_CARRIED_CREDIT',jsonb_build_object('final_assessment_id',a.id,'final_zakat_due',a.zakat_due));
 return c.id;
end $$;
revoke all on function public.close_zakat_cycle(uuid,uuid) from public,anon;
grant execute on function public.close_zakat_cycle(uuid,uuid) to authenticated;
