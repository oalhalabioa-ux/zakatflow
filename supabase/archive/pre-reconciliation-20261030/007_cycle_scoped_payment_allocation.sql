create or replace function public.allocate_zakat_payment_fifo(p_payment_id uuid)
returns table(assessment_line_id uuid, asset_account_id uuid, allocated_amount numeric, due_date date)
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_remaining numeric;
  v_payment_assessment uuid;
  v_payment_cycle uuid;
  v_payment_date date;
  r record;
  v_open numeric;
  v_take numeric;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select base_amount,assessment_id,hawl_cycle_id,payment_date into v_remaining,v_payment_assessment,v_payment_cycle,v_payment_date
  from public.zakat_payments where id=p_payment_id and user_id=v_user;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_payment_cycle is null then raise exception 'PAYMENT_CYCLE_REQUIRED'; end if;
  if v_payment_assessment is null then raise exception 'PAYMENT_ASSESSMENT_REQUIRED'; end if;
  if not exists(select 1 from public.zakat_assessments a where a.id=v_payment_assessment and a.user_id=v_user and a.hawl_cycle_id=v_payment_cycle and a.status not in ('CANCELLED','DRAFT')) then raise exception 'ASSESSMENT_NOT_IN_PAYMENT_CYCLE'; end if;
  delete from public.zakat_payment_allocations where payment_id=p_payment_id and user_id=v_user;
  for r in
    select l.id line_id,l.assessment_id,l.lot_id,l.zakat_amount,lots.asset_account_id,coalesce(lots.hawl_due_date,a.assessment_date) line_due_date,
      coalesce((select sum(pa.allocated_amount) from public.zakat_payment_allocations pa where pa.assessment_line_id=l.id and pa.hawl_cycle_id=v_payment_cycle),0) already_paid
    from public.zakat_assessment_lines l
    join public.zakat_assessments a on a.id=l.assessment_id and a.user_id=v_user and a.hawl_cycle_id=v_payment_cycle
    left join public.lots lots on lots.id=l.lot_id and lots.user_id=v_user
    where l.assessment_id=v_payment_assessment and l.zakat_amount>0 and a.status not in ('CANCELLED','DRAFT') and coalesce(lots.hawl_due_date,a.assessment_date)<=v_payment_date
    order by coalesce(lots.hawl_due_date,a.assessment_date),l.id
  loop
    exit when v_remaining<=0;
    v_open:=greatest(0,r.zakat_amount-r.already_paid); if v_open<=0 then continue; end if;
    v_take:=least(v_remaining,v_open);
    insert into public.zakat_payment_allocations(user_id,payment_id,assessment_id,assessment_line_id,lot_id,asset_account_id,allocated_amount,due_date,hawl_cycle_id)
    values(v_user,p_payment_id,r.assessment_id,r.line_id,r.lot_id,r.asset_account_id,v_take,r.line_due_date,v_payment_cycle);
    v_remaining:=v_remaining-v_take;
  end loop;
  return query select pa.assessment_line_id,pa.asset_account_id,pa.allocated_amount,pa.due_date from public.zakat_payment_allocations pa where pa.payment_id=p_payment_id and pa.hawl_cycle_id=v_payment_cycle order by pa.due_date,pa.created_at;
end $$;
grant execute on function public.allocate_zakat_payment_fifo(uuid) to authenticated;
