create or replace function private.personal_contract_installment_snapshot()returns trigger language plpgsql security invoker set search_path='' as $$begin
 if new.status='POSTED'and old.status='EXECUTING'and not exists(select 1 from public.personal_contract_installments where contract_id=new.id)then
  insert into public.personal_contract_installments(user_id,contract_id,number,amount,due_date)select new.user_id,new.id,v.ordinality,(v.value->>'amount')::numeric,(v.value->>'due_date')::date from jsonb_array_elements(new.terms->'schedule')with ordinality as v(value,ordinality);
 end if;return new;
end$$;
revoke all on function private.personal_contract_installment_snapshot()from public,anon,authenticated;
do $patch$
declare definition text;old_fragment text:='and c.product in(''QARD'',''FINANCING'')';new_fragment text:='and(c.product in(''QARD'',''FINANCING'')or(c.product=''PARTICIPATION''and c.side=''PAYABLE''))';
begin
 select pg_get_functiondef('private.record_debt_followup(jsonb)'::regprocedure)into definition;
 if position(old_fragment in definition)>0 then execute replace(definition,old_fragment,new_fragment);
 elsif position(new_fragment in definition)=0 then raise exception 'PERSONAL_PARTICIPATION_FOLLOWUP_PATCH_MISMATCH';end if;
end $patch$;