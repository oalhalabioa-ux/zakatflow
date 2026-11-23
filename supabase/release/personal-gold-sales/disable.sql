begin;
revoke execute on function public.gold_card_sale(uuid,date,jsonb) from authenticated;
revoke execute on function public.reverse_grouped_gold_sale(uuid,uuid,integer,text) from authenticated;
commit;
