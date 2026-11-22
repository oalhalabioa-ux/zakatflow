begin;
grant execute on function public.gold_card_sale(uuid,date,jsonb) to authenticated;
grant execute on function public.reverse_grouped_gold_sale(uuid,uuid,integer,text) to authenticated;
commit;
