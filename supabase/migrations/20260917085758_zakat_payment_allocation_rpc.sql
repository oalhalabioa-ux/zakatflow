create or replace function public.allocate_zakat_payment_fifo(p_payment_id uuid)
returns table(assessment_line_id uuid, asset_account_id uuid, allocated_amount numeric, due_date date)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_remaining numeric;
  v_payment_assessment uuid;
  r record;
  v_open numeric;
  v_take numeric;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select base_amount, assessment_id into v_remaining, v_payment_assessment
  from public.zakat_payments where id=p_payment_id and user_id=v_user;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;

  delete from public.zakat_payment_allocations where payment_id=p_payment_id and user_id=v_user;

  for r in
    select l.id line_id,l.assessment_id,l.lot_id,l.zakat_amount,
           lots.asset_account_id,
           coalesce(lots.hawl_due_date,a.assessment_date) as line_due_date,
           coalesce((select sum(pa.allocated_amount) from public.zakat_payment_allocations pa where pa.assessment_line_id=l.id),0) as already_paid
    from public.zakat_assessment_lines l
    join public.zakat_assessments a on a.id=l.assessment_id and a.user_id=v_user
    left join public.lots lots on lots.id=l.lot_id and lots.user_id=v_user
    where l.zakat_amount>0 and a.status<>'CANCELLED'
      and (a.assessment_date <= (select payment_date from public.zakat_payments where id=p_payment_id))
    order by coalesce(lots.hawl_due_date,a.assessment_date), a.assessment_date, l.id
  loop
    exit when v_remaining<=0;
    v_open := greatest(0, r.zakat_amount-r.already_paid);
    if v_open<=0 then continue; end if;
    v_take := least(v_remaining,v_open);
    insert into public.zakat_payment_allocations(user_id,payment_id,assessment_id,assessment_line_id,lot_id,asset_account_id,allocated_amount,due_date)
    values(v_user,p_payment_id,r.assessment_id,r.line_id,r.lot_id,r.asset_account_id,v_take,r.line_due_date);
    v_remaining := v_remaining-v_take;
  end loop;

  return query select pa.assessment_line_id,pa.asset_account_id,pa.allocated_amount,pa.due_date
  from public.zakat_payment_allocations pa where pa.payment_id=p_payment_id order by pa.due_date,pa.created_at;
end $$;
revoke all on function public.allocate_zakat_payment_fifo(uuid) from public;
grant execute on function public.allocate_zakat_payment_fifo(uuid) to authenticated;