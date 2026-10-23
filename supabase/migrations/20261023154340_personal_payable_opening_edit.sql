-- Narrow owner-scoped edit path. It never creates a cash movement or rewrites
-- payments, financing sources, party identity or the original create fingerprint.
create or replace function private.edit_personal_payable(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); d public.personal_payables%rowtype; prior jsonb;
 amt numeric; dt date; due date; descr text; ref text;
begin
 if uid is null then raise exception 'UNAUTHORIZED';end if;
 if jsonb_typeof(p_payload) is distinct from 'object'
 or p_payload->>'action' is distinct from 'UPDATE'
 or not (p_payload ?& array['action','payable_id','description','amount','date','due_date','reference','category','expected'])
 or exists(select 1 from jsonb_object_keys(p_payload) k where k not in('action','payable_id','description','amount','date','due_date','reference','category','expected'))
 then raise exception 'VALIDATION_FAILED';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('personal-payable:'||uid::text,0));
 select * into d from public.personal_payables where id=(p_payload->>'payable_id')::uuid and user_id=uid for update;
 if d.id is null or d.cancelled_at is not null then raise exception 'PERSONAL_PAYABLE_ACCESS_DENIED';end if;
 prior:=jsonb_build_object('amount',d.amount,'date',d.event_date,'description',d.description,'due_date',d.due_date,'reference',d.reference);
 if p_payload->'expected' is distinct from prior then raise exception 'PERSONAL_PAYABLE_EDIT_CONFLICT';end if;
 amt:=(p_payload->>'amount')::numeric;dt:=(p_payload->>'date')::date;due:=nullif(p_payload->>'due_date','')::date;
 descr:=trim(p_payload->>'description');ref:=trim(p_payload->>'reference');
 if amt is null or amt<=0 or amt>1e12 or amt<>round(amt,4) or amt::text in('NaN','Infinity','-Infinity')
 or dt is null or dt>(now() at time zone 'Asia/Riyadh')::date or (due is not null and due<dt)
 or descr is null or length(descr) not between 3 and 500 or ref is null or length(ref)>120
 or p_payload->>'category' is null or p_payload->>'category' not in('P_AP_PERSON','P_AP_LOAN','P_AP_INSTALLMENT','P_AP_ACCRUAL','P_AP_OTHER')
 then raise exception 'VALIDATION_FAILED';end if;
 if (amt is distinct from d.amount or dt is distinct from d.event_date)
 and (exists(select 1 from public.personal_payable_payments where payable_id=d.id)
 or exists(select 1 from public.personal_financings where payable_id=d.id))
 then raise exception 'PERSONAL_PAYABLE_FINANCIAL_FIELDS_LOCKED';end if;
 if due is distinct from d.due_date and exists(select 1 from public.personal_financings where payable_id=d.id) then raise exception 'PERSONAL_FINANCING_USE_SOURCE';end if;
 update public.personal_payables set description=descr,amount=amt,event_date=dt,due_date=due,reference=ref where id=d.id and user_id=uid;
 perform private.assign_debt_category('PERSONAL_PAYABLE',d.id,p_payload->>'category');
 insert into public.audit_logs(user_id,entity_type,entity_id,action,old_data,new_data)
 values(uid,'personal_payable',d.id,'EDIT',prior,p_payload-'expected');
 return jsonb_build_object('id',d.id,'updated',true);
end $$;
revoke all on function private.edit_personal_payable(jsonb) from public,anon;
grant execute on function private.edit_personal_payable(jsonb) to authenticated;
create or replace function public.edit_personal_payable(p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.edit_personal_payable(p_payload);$$;
revoke all on function public.edit_personal_payable(jsonb) from public,anon;
grant execute on function public.edit_personal_payable(jsonb) to authenticated;
