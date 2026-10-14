-- QA fixture only. All balances, movements and audit rows are rolled back.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','f10bd630-6e35-4513-a9b3-4908d1b00c3c',true);
do $$
declare a jsonb;b jsonb;d jsonb;p jsonb;r jsonb;v numeric;before_events bigint;before_settlements bigint;bad boolean;req uuid:=gen_random_uuid();uid uuid:=auth.uid();
begin
 select count(*) into before_events from public.financial_events;
 select count(*) into before_settlements from public.liquidity_settlements;
 p:=jsonb_build_object('request_id',req,'scope','PERSONAL','type','BANK','name','QA ephemeral bank','currency','SAR','opening_balance',1000,'opening_date','2026-10-01','hawl_start_date','2026-01-01','fx_rate',1,'notes','QA rollback');
 a:=public.open_financial_account(p);
 r:=public.open_financial_account(p);
 if a->>'id'<>r->>'id' then raise exception 'ASSERT opening replay duplicate';end if;
 if (select count(*) from public.transactions where asset_account_id=(a->>'id')::uuid)<>1 then raise exception 'ASSERT duplicate opening transaction';end if;
 if (select min(origin_hawl_start_date) from public.lots where asset_account_id=(a->>'id')::uuid)<>'2026-01-01'::date then raise exception 'ASSERT original hawl missing';end if;
 bad:=false;begin perform public.open_financial_account(p||'{"opening_balance":999}'::jsonb);exception when others then if sqlerrm='FINANCIAL_ACCOUNT_REQUEST_CONFLICT' then bad:=true;else raise;end if;end;if not bad then raise exception 'ASSERT opening conflict accepted';end if;
 b:=public.open_financial_account(p||jsonb_build_object('request_id',gen_random_uuid(),'name','QA empty destination','type','CASH','opening_balance',0));
 if exists(select 1 from public.lots where asset_account_id=(b->>'id')::uuid) then raise exception 'ASSERT zero opening manufactured lot';end if;
 p:=jsonb_build_object('action','TRANSFER','request_id',gen_random_uuid(),'source_id',a->>'id','destination_id',b->>'id','amount',250,'date','2026-10-02','notes','QA transfer');
 r:=public.transfer_personal_financial_account(p);
 if (public.transfer_personal_financial_account(p))->>'transfer_id'<>r->>'transfer_id' then raise exception 'ASSERT transfer replay';end if;
 select sum(remaining_value_base) into v from public.lots where asset_account_id=(a->>'id')::uuid;
 if v<>750 then raise exception 'ASSERT source balance %',v;end if;
 select sum(remaining_value_base) into v from public.lots where asset_account_id=(b->>'id')::uuid;
 if v<>250 then raise exception 'ASSERT destination balance %',v;end if;
 if exists(select 1 from public.lots where asset_account_id=(b->>'id')::uuid and (origin_hawl_start_date<>'2026-01-01'::date or hawl_continuity_source_lot_id is null)) then raise exception 'ASSERT transfer broke hawl';end if;
 bad:=false;begin perform public.transfer_personal_financial_account(p||jsonb_build_object('request_id',gen_random_uuid(),'amount',751));exception when others then if sqlerrm='CASH_INSUFFICIENT_BALANCE' then bad:=true;else raise;end if;end;if not bad then raise exception 'ASSERT overdraft accepted';end if;
 d:=public.open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','PERSONAL','type','RECEIVABLE','name','QA debtor','currency','SAR','opening_balance',600,'opening_date','2026-10-01','hawl_start_date','2026-01-01','due_date','2026-10-03','fx_rate',1));
 perform public.transfer_personal_financial_account(jsonb_build_object('action','COLLECT','request_id',gen_random_uuid(),'source_id',d->>'id','destination_id',b->>'id','amount',200,'date','2026-10-04','notes','QA collection'));
 select sum(remaining_value_base) into v from public.lots where asset_account_id in((a->>'id')::uuid,(b->>'id')::uuid,(d->>'id')::uuid);
 if v<>1600 then raise exception 'ASSERT collection duplicated wealth %',v;end if;
 if (select sum(remaining_value_base) from public.lots where asset_account_id=(d->>'id')::uuid)<>400 then raise exception 'ASSERT collection did not reduce receivable';end if;
 -- Previous opening convention: one quantity unit representing an entire balance.
 update public.lots set original_quantity=1,remaining_quantity=1 where asset_account_id=(d->>'id')::uuid;
 perform public.transfer_personal_financial_account(jsonb_build_object('action','COLLECT','request_id',gen_random_uuid(),'source_id',d->>'id','destination_id',b->>'id','amount',100,'date','2026-10-05','notes','QA legacy unit collection'));
 if (select sum(remaining_value_base) from public.lots where asset_account_id=(d->>'id')::uuid)<>300 then raise exception 'ASSERT legacy quantity conversion';end if;
 bad:=false;begin insert into public.transactions(user_id,asset_account_id,transaction_type,transaction_date,quantity,currency,gross_value,base_currency,base_value,created_by) values(uid,(a->>'id')::uuid,'PURCHASE','2026-10-02',1,'SAR',10,'SAR',10,uid);exception when others then if sqlerrm='USE_CASH_ACCOUNT_OPENING' then bad:=true;else raise;end if;end;if not bad then raise exception 'ASSERT cash purchase accepted';end if;
 p:=jsonb_build_object('request_id',gen_random_uuid(),'scope','ORGANIZATION','organization_id','85acbac0-e8b4-434c-a22b-3ec13b55e1a7','entity_id','d3c2ef65-d8b4-4ac9-9267-d91c9dfc4cbe','type','BANK','name','QA corporate opening','currency','USD','opening_balance',100,'opening_date','2026-10-01','fx_rate',3.75);
 r:=public.open_financial_account(p);
 if (r->>'current_balance')::numeric<>100 or (r->>'current_balance_base')::numeric<>375 then raise exception 'ASSERT corporate opening FX';end if;
 if (public.open_financial_account(p))->>'id'<>r->>'id' then raise exception 'ASSERT corporate opening replay';end if;
 if (select count(*) from public.financial_events)<>before_events or (select count(*) from public.liquidity_settlements)<>before_settlements then raise exception 'ASSERT opening or collection manufactured corporate revenue/cash';end if;
end $$;
select set_config('request.jwt.claim.sub','8ec4c7f9-83b4-4307-9d5e-de7590fa121b',true);
do $$declare bad boolean:=false;begin
 begin perform public.open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','ORGANIZATION','organization_id','85acbac0-e8b4-434c-a22b-3ec13b55e1a7','type','BANK','name','QA denied','currency','SAR','opening_balance',1,'opening_date','2026-10-01','fx_rate',1));exception when others then if sqlerrm='FINANCIAL_ACCOUNT_ACCESS_DENIED' then bad:=true;else raise;end if;end;
 if not bad then raise exception 'ASSERT viewer may open corporate account';end if;
end $$;
rollback;
