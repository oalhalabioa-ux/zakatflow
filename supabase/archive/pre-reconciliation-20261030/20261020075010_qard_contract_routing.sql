alter table public.financing_contract_terms add column product text not null default 'FINANCING'check(product in('FINANCING','QARD'));
create function private.create_qard_contract(p jsonb)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare r jsonb;plan jsonb:='[]';item jsonb;i int:=0;balance numeric:=(p->>'principal')::numeric;prior public.financing_contract_terms%rowtype;
begin
 if auth.uid()is null then raise exception 'UNAUTHORIZED';end if;
 if p->>'kind'is distinct from 'LOAN'then raise exception 'QARD_CONTRACT_REQUIRED';end if;
 r:=private.create_debt_contract(p);select * into prior from public.financing_contract_terms where id=(r->>'id')::uuid;
 if prior.id is not null then if prior.product<>'QARD'then raise exception 'EXISTING_CONTRACT_CANNOT_BE_RECLASSIFIED';end if;return r;end if;
 if coalesce((r->>'replay')::boolean,false)then raise exception 'EXISTING_CONTRACT_CANNOT_BE_RECLASSIFIED';end if;
 for item in select value from jsonb_array_elements(p->'schedule')loop i:=i+1;plan:=plan||jsonb_build_array(jsonb_build_object('number',i,'due_date',item->>'due_date','principal',(item->>'amount')::numeric,'finance',0,'total',(item->>'amount')::numeric,'opening',balance,'closing',balance-(item->>'amount')::numeric));balance:=balance-(item->>'amount')::numeric;end loop;
 insert into public.financing_contract_terms(id,organization_id,terms,plan,payload_fingerprint,product)values((r->>'id')::uuid,(p->>'organization_id')::uuid,jsonb_build_object('annualRate',0),plan,md5(p::text),'QARD');return r;
end $$;
revoke all on function private.create_qard_contract(jsonb)from public,anon;grant execute on function private.create_qard_contract(jsonb)to authenticated;
create function public.create_qard_contract(p_payload jsonb)returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$select private.create_qard_contract(p_payload);$$;
revoke all on function public.create_qard_contract(jsonb)from public,anon;grant execute on function public.create_qard_contract(jsonb)to authenticated;
create or replace function private.guard_finance_contract_operation()returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if new.kind in('RESCHEDULE','REVERSE')and exists(select 1 from public.financing_contract_terms t join public.debt_contracts c on c.id=t.id where t.product='FINANCING'and c.organization_id=new.organization_id and(new.target_id=c.id or new.target_id=c.financial_event_id))then raise exception 'STRUCTURED_FINANCING_REQUIRES_CONTRACT_AMENDMENT';end if;return new;
end $$;
