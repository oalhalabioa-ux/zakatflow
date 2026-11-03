begin;
create temporary table opening_source_checks(name text,passed boolean);
do $$
declare u uuid:=gen_random_uuid();o uuid:=gen_random_uuid();asset uuid:=gen_random_uuid();bank uuid:=gen_random_uuid();cp uuid:=gen_random_uuid();root uuid:=gen_random_uuid();application uuid:=gen_random_uuid();ob uuid:=gen_random_uuid();book jsonb;s jsonb;w jsonb;e jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,'opening-sources-'||u||'@example.invalid',now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.organizations(id,owner_user_id,name) values(o,u,'Opening source rollback QA');
 insert into public.organization_members(organization_id,user_id,role,status) values(o,u,'OWNER','ACTIVE') on conflict(organization_id,user_id) do update set role='OWNER',status='ACTIVE';
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.asset_accounts(id,user_id,organization_id,ownership_scope,asset_type,name,currency,metadata)
 values(asset,u,o,'ORGANIZATION','OTHER','Cost source QA','SAR','{"acquisition_mode":"OPENING_BALANCE","market_value":999999999}');
 insert into public.transactions(user_id,organization_id,asset_account_id,transaction_type,transaction_date,quantity,currency,base_currency,base_value,gross_value,metadata)
 values(u,o,asset,'OPENING_BALANCE','2025-01-01',10,'SAR','SAR',1000,1000,'{}'),
 (u,o,asset,'ADJUSTMENT','2025-06-01',0,'SAR','SAR',100,100,'{"reason":"DEPRECIATION","cost_basis_base":100}'),
 (u,o,asset,'SALE','2025-07-01',2,'SAR','SAR',300,300,'{"cost_basis_base":180}');
 book:=private.financial_opening_asset_book(o,asset,'2025-12-31');
 if book->>'gross'<>'800.0000' or book->>'depreciation'<>'80.0000' or book->>'issue' is not null then raise exception 'cost reconstruction %',book;end if;
 insert into opening_source_checks values('Historical cost and accumulated depreciation survive a partial sale; market quote ignored',true);
 book:=private.financial_opening_asset_book(o,asset,'2025-05-31');
 if book->>'gross'<>'1000.0000' or book->>'depreciation'<>'0.0000' then raise exception 'cutoff cost invalid';end if;
 insert into opening_source_checks values('Asset book balances respect the selected cutoff',true);
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata)
 values(bank,o,'Cash history QA','BANK','SAR',600,600,u,'{"opening_date":"2025-01-01","opening_balance":500,"opening_fx_rate":1}');
 insert into public.liquidity_flows(organization_id,account_id,direction,flow_type,title,due_date,amount,currency,base_amount,status,source,created_by)
 values(o,bank,'INFLOW','OPERATING','After cutoff receipt','2026-01-02',100,'SAR',100,'ACTUAL','MANUAL',u);
 s:=public.financial_opening_workspace(o,'2026-01-01');
 if (select r->'vouchers'->0->>'debit' from jsonb_array_elements(s->'source'->'rows') r where r->>'id'='cash:'||bank)<>'500.0000' then raise exception 'cash rolled back incorrectly';end if;
 insert into opening_source_checks values('Cash at cutoff backs out later actual movements',true);
 e:=jsonb_build_object('equity:3100',jsonb_build_object('amount','1220','side','CREDIT'),'equity:3200',jsonb_build_object('amount','0','side','CREDIT'),'equity:3300',jsonb_build_object('amount','0','side','CREDIT'));
 w:=public.save_financial_opening(o,'2026-01-01',0,s->'source'->>'revision',e,'');
 update public.transactions set base_value=1100,gross_value=1100 where asset_account_id=asset and transaction_type='OPENING_BALANCE';
 begin perform public.approve_financial_opening((w->>'id')::uuid,1);raise exception 'stale approval accepted';exception when others then if sqlerrm<>'OPENING_SOURCE_CHANGED' then raise;end if;end;
 insert into opening_source_checks values('Changing an original voucher invalidates a saved approval candidate',true);
 -- No balancing equity is ever auto-generated.
 update public.transactions set base_value=1000,gross_value=1000 where asset_account_id=asset and transaction_type='OPENING_BALANCE';
 e:=jsonb_set(e,'{equity:3100,amount}','"1221"');
 s:=public.financial_opening_workspace(o,'2026-01-01');
 w:=public.save_financial_opening(o,'2026-01-01',1,s->'source'->>'revision',e,'');
 begin perform public.approve_financial_opening((w->>'id')::uuid,2);raise exception 'unbalanced accepted';exception when others then if sqlerrm<>'OPENING_UNBALANCED' then raise;end if;end;
 insert into opening_source_checks values('An unbalanced opening is rejected without a suspense or equity plug',true);
end $$;
select * from opening_source_checks order by name;
rollback;
