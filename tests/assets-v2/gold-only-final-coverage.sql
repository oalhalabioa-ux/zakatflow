-- Run on isolated QA with candidate schema installed. All fixture rows roll back.
begin;
do $$ declare u uuid:=gen_random_uuid(); g uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); lot uuid; t uuid; m uuid; c uuid; a uuid; receipt uuid; i int; due date; sale jsonb; begin
insert into auth.users(id) values(u);insert into profiles(id,base_currency) values(u,'SAR') on conflict(id) do nothing;
insert into user_settings(user_id,zakatable_conversion_continuity) values(u,true) on conflict(user_id) do update set zakatable_conversion_continuity=true;
perform set_config('request.jwt.claim.sub',u::text,true);
insert into asset_accounts(id,user_id,asset_type,name,currency,unit,metadata,is_zakatable) values(g,u,'GOLD','QA','SAR','g','{"karat":18}',true),(b,u,'BANK','QA','SAR','SAR','{}',true);
insert into transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value) values(u,g,'PURCHASE','2024-06-01',10,'SAR','SAR',4000) returning id into t;
insert into lots(user_id,asset_account_id,source_transaction_id,acquisition_date,hawl_start_date,original_quantity,remaining_quantity,original_value_base,remaining_value_base) values(u,g,t,'2024-06-01','2024-06-01',10,10,4000,4000) returning id into lot;
insert into zakat_methods(code,name_ar,name_en,calendar_type,zakat_rate) values(u::text,'QA','QA','GREGORIAN',.025) returning id into m;
for i in 1..2 loop
due:=make_date(2024+i,6,1);
insert into zakat_hawl_cycles(user_id,cycle_no,nisab_standard,nisab_reached_date,hawl_start_date,hawl_due_date,status) values(u,i,'SILVER',due-365,due-365,due,'ACTIVE') returning id into c;
insert into zakat_assessments(user_id,assessment_date,valuation_date,method_id,nisab_standard,nisab_quantity,nisab_value_base,zakat_rate,zakat_due,currency,status,assessment_kind,hawl_cycle_id,calculation_snapshot) values(u,due,due,m,'SILVER',595,595,.025,60,'SAR','CALCULATED','RECALCULATION',c,'{"hawlPeriodPolicy":"FINAL_COVERAGE_V1"}') returning id into a;
insert into zakat_assessment_lines(assessment_id,lot_id,quantity,eligibility_status,explanation,zakat_amount,valuation_snapshot) values(a,lot,case i when 1 then 10 else 8 end,'ELIGIBLE','QA',60,jsonb_build_object('hawlDueDate',due));
update zakat_hawl_cycles set assessment_id=a where id=c;
perform close_zakat_cycle(c,a);
if i=1 then sale:=post_sale_with_proceeds(u,g,b,'2026-02-10',2,900,'SAR','SAR',900);receipt:=(sale->>'proceeds_transaction_id')::uuid;end if;
end loop;
if (select hawl_due_date from zakat_lot_hawl_periods('GREGORIAN') where lot_id=lot) is distinct from date '2027-06-01' then raise exception 'gold coverage mismatch';end if;
if (select period_due from gold_receipt_assessment_periods(receipt,'GREGORIAN') where remaining_base=900) is distinct from date '2026-06-01' then raise exception 'cash coverage mismatch';end if;end $$;
rollback;
