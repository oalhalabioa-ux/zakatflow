do $patch$
declare definition text;old_fragment text:='if c.product<>''PARTICIPATION''then perform private.assign_debt_category';new_fragment text:='if c.product<>''PARTICIPATION''and t->>''mode''<>''LINKED''then perform private.assign_debt_category';
begin
 select pg_get_functiondef('private.personal_contract_command(jsonb)'::regprocedure)into definition;
 if position(old_fragment in definition)>0 then execute replace(definition,old_fragment,new_fragment);
 elsif position(new_fragment in definition)=0 then raise exception 'PERSONAL_CONTRACT_CATEGORY_PATCH_MISMATCH';end if;
end $patch$;