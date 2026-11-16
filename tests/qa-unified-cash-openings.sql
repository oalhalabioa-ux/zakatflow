-- Disposable QA only. Every fixture is rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid();o uuid:=gen_random_uuid();other_org uuid:=gen_random_uuid();legacy uuid:=gen_random_uuid();cmd jsonb;bank jsonb;fresh jsonb;linked jsonb;before_count int;
begin
 insert into auth.users(id,email,email_confirmed_at) values(u,u||'@cash-qa.invalid',now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.organizations(id,owner_user_id,name) values(o,u,'QA January cash'),(other_org,u,'QA July cash');
 insert into public.organization_members(organization_id,user_id,role,status) values(o,u,'OWNER','ACTIVE'),(other_org,u,'OWNER','ACTIVE') on conflict(organization_id,user_id) do update set role='OWNER',status='ACTIVE';
 perform public.save_financial_fiscal_calendar(o,1,1,'3300',0,'QA January independent calendar');
 perform public.save_financial_fiscal_calendar(other_org,7,1,'3300',0,'QA July independent calendar');
 cmd:=jsonb_build_object('request_id',gen_random_uuid(),'scope','ORGANIZATION','organization_id',o,'entity_id',null,'type','BANK','name','QA explicit opening','currency','SAR','opening_balance',450000,'opening_date','2026-01-01','fx_rate',1,'notes','','balance_mode','OPENING');
 bank:=public.open_financial_account(cmd);
 if (public.open_financial_account(cmd)->>'id')<>bank->>'id' then raise exception 'Retry duplicated bank';end if;
 begin perform public.open_financial_account(cmd||'{"opening_balance":1}');raise exception 'Conflict was accepted';exception when raise_exception then if sqlerrm not like '%FINANCIAL_ACCOUNT_REQUEST_CONFLICT%' then raise;end if;end;
 fresh:=public.open_financial_account(cmd||jsonb_build_object('request_id',gen_random_uuid(),'name','QA new empty bank','balance_mode','NEW','opening_balance',0,'opening_date','2026-07-01'));
 if (fresh->>'current_balance')::numeric<>0 then raise exception 'NEW created money';end if;
 begin perform public.open_financial_account(cmd||jsonb_build_object('request_id',gen_random_uuid(),'balance_mode','NEW'));raise exception 'NEW nonzero accepted';exception when raise_exception then if sqlerrm not like '%FINANCIAL_ACCOUNT_INVALID%' then raise;end if;end;
 insert into public.liquidity_accounts(id,organization_id,name,account_type,currency,current_balance,current_balance_base,created_by,metadata) values(legacy,o,'QA legacy reconstruction','BANK','SAR',400000,400000,u,'{}');
 insert into public.liquidity_flows(organization_id,account_id,direction,flow_type,title,due_date,amount,currency,base_amount,status,source,created_by)
 values(o,legacy,'OUTFLOW','OTHER','QA actual movement','2026-10-15',50000,'SAR',50000,'ACTUAL','MANUAL',u),
 (o,legacy,'INFLOW','OTHER','QA forecast excluded','2026-10-15',999999,'SAR',999999,'EXPECTED','MANUAL',u);
 if private.financial_cash_opening_suggestions(o,'2026-01-01')->legacy::text->>'amount'<>'450000.0000' then raise exception 'January reconstruction wrong';end if;
 if private.financial_cash_opening_suggestions(o,'2026-07-01')->legacy::text->>'amount'<>'450000.0000' then raise exception 'July reconstruction wrong';end if;
 if private.financial_cash_opening_suggestions(other_org,'2026-07-01')?legacy::text then raise exception 'Cross-org source leakage';end if;
 linked:=public.link_financial_cash_accounts(o);select count(*) into before_count from public.financial_chart_custom_accounts where organization_id=o;
 perform public.link_financial_cash_accounts(o);
 if (select count(*) from public.financial_chart_custom_accounts where organization_id=o)<>before_count then raise exception 'Linking duplicated chart accounts';end if;
 if not linked?('cash:'||(bank->>'id')) then raise exception 'Bank has no automatic leaf';end if;
 if not exists(select 1 from jsonb_array_elements(public.financial_opening_workspace(o,'2026-01-01')->'source'->'rows') r where r->>'id'='cash:'||(bank->>'id') and (r->'vouchers'->0->>'debit')::numeric=450000) then raise exception 'Explicit fiscal-start opening missing';end if;
 if exists(select 1 from jsonb_array_elements(public.financial_opening_workspace(o,'2026-01-01')->'source'->'rows') r where r->>'id'='cash:'||(fresh->>'id') and jsonb_array_length(r->'vouchers')>0) then raise exception 'In-year NEW became fiscal opening';end if;
 if not exists(select 1 from jsonb_array_elements(public.financial_opening_candidates(o,'2026-01-01')) c where c->>'sourceId'=legacy::text and c->>'suggestedAmount'='450000.0000') then raise exception 'Unapproved suggestion not exposed';end if;
 -- A second institution has a July start and its own chart namespace.
 fresh:=public.open_financial_account(cmd||jsonb_build_object('request_id',gen_random_uuid(),'organization_id',other_org,'name','QA July opening','opening_date','2026-07-01','opening_balance',750));
 if not exists(select 1 from jsonb_array_elements(public.financial_opening_workspace(other_org,'2026-07-01')->'source'->'rows') r where r->>'id'='cash:'||(fresh->>'id') and (r->'vouchers'->0->>'debit')::numeric=750) then raise exception 'Independent July opening missing';end if;
 -- Removing membership must also remove write access, even for the org's owner record.
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin perform public.link_financial_cash_accounts(o);raise exception 'Unprivileged link accepted';exception when raise_exception then if sqlerrm not like '%FISCAL_WRITE_DENIED%' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub',(select owner_user_id::text from public.organizations where name='QA January cash' limit 1),true);
set local role authenticated;
select public.open_financial_account(jsonb_build_object('request_id',gen_random_uuid(),'scope','ORGANIZATION','organization_id',(select id from public.organizations where name='QA January cash' limit 1),'type','BANK','name','QA authenticated command','currency','SAR','balance_mode','NEW','opening_balance',0,'opening_date','2026-01-01','fx_rate',1,'notes','Real authenticated role, not superuser'));
reset role;
select 'PASS unified cash openings: typed creation, retry/conflict, January/July, forecast exclusion, isolation, automatic links, no in-year opening promotion' result;
rollback;
