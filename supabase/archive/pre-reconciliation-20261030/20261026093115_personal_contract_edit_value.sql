do $patch$
declare definition text;old_fragment text:='terms=t,principal=personal_contract_command.principal,currency=base';new_fragment text:='terms=t,principal=(t->>''principal'')::numeric,currency=base';
begin
 select pg_get_functiondef('private.personal_contract_command(jsonb)'::regprocedure)into definition;
 if position(old_fragment in definition)>0 then execute replace(definition,old_fragment,new_fragment);
 elsif position(new_fragment in definition)=0 then raise exception 'PERSONAL_CONTRACT_EDIT_PATCH_MISMATCH';end if;
end $patch$;