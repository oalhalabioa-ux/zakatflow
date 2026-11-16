-- Forward-only source identity. Opening debts do not invent an income/equity
-- counterpart, and new loan funding cannot pick an unrelated ASSET/LIABILITY.
do $$
declare definition text;
 classification_needle constant text:=$n$and classification_type=(case when side='RECEIVABLE' then 'ASSET' else 'LIABILITY' end) and active order by id limit 1$n$;
 line_needle constant text:=$n$'line_number',1,'classification_id',cls$n$;
begin
 definition:=pg_get_functiondef('private.create_debt_contract(jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,classification_needle,'')))/length(classification_needle)<>1
  or (length(definition)-length(replace(definition,line_needle,'')))/length(line_needle)<>1 then
  raise exception 'DEBT_PRINCIPAL_SOURCE_SIGNATURE_CHANGED';end if;
 definition:=replace(definition,classification_needle,$n$and classification_type=(case when side='RECEIVABLE' then 'ASSET' else 'LIABILITY' end)
  and code=(case when side='RECEIVABLE' then 'DEBT_PRINCIPAL_ASSET' else 'DEBT_PRINCIPAL_LIABILITY' end) and active$n$);
 definition:=replace(definition,line_needle,$n$'line_number',1,'metadata',jsonb_build_object('source_role',case when mode='OPENING' then 'DEBT_OPENING_' else 'DEBT_FUNDED_' end||cat),'classification_id',cls$n$);
 execute definition;
end $$;
