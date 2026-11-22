do $$
begin
  if has_function_privilege('anon','public.gold_card_sale(uuid,date,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.gold_card_sale(uuid,date,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.reverse_grouped_gold_sale(uuid,uuid,integer,text)','EXECUTE')
    or has_function_privilege('authenticated','public.post_personal_gold_lot_sale(uuid,integer,uuid,date,numeric,numeric,text,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.apply_personal_sale_lots(uuid,uuid[],text,jsonb)','EXECUTE')
    or has_table_privilege('authenticated','private.grouped_sale_reversals','INSERT')
    or not (select relrowsecurity from pg_class where oid='private.grouped_sale_reversals'::regclass)
  then raise exception 'GOLD_RELEASE_PRIVILEGE_DRIFT'; end if;
end $$;
