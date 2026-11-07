-- Disposable Production-schema QA only: creates temporary financial fixture
-- rows inside ROLLBACK. Never execute against hosted Production or customer QA.
--
-- This is a NEGATIVE permissions acceptance test. It proves that assets.view
-- plus financial_core.view does not imply visibility of OTHER users' inventory
-- allocation rows, so a standalone client-side RLS query cannot certify SALE
-- cost basis. Do not grant broad table SELECT to "fix" this accounting gap.
begin;

insert into auth.users(id,email,email_confirmed_at)
values
 ('c1000000-0000-4000-8000-000000000101','qa-finance-owner@financial-parity.invalid',now()),
 ('c1000000-0000-4000-8000-000000000102','qa-asset-operator@financial-parity.invalid',now());
insert into public.profiles(id,name)
values
 ('c1000000-0000-4000-8000-000000000101','QA finance owner'),
 ('c1000000-0000-4000-8000-000000000102','QA asset operator')
on conflict (id) do nothing;
-- Existing subscription guard accepts org creation only for the authenticated,
-- email-verified owner. Do not bypass the guard in the temporary fixture.
select set_config('request.jwt.claim.sub',
 'c1000000-0000-4000-8000-000000000101',true);
insert into public.organizations(id,owner_user_id,name,base_currency)
values('c1000000-0000-4000-8000-000000000103',
 'c1000000-0000-4000-8000-000000000101','RLS asset allocation parity fixture','SAR');
insert into public.organization_members(organization_id,user_id,role,status)
values('c1000000-0000-4000-8000-000000000103',
 'c1000000-0000-4000-8000-000000000101','OWNER','ACTIVE');
insert into public.asset_accounts(id,user_id,asset_type,name,currency,organization_id,ownership_scope)
values('c1000000-0000-4000-8000-000000000104',
 'c1000000-0000-4000-8000-000000000102','GOLD','QA inventory','SAR',
 'c1000000-0000-4000-8000-000000000103','ORGANIZATION');
insert into public.transactions(id,user_id,asset_account_id,transaction_type,transaction_date,
 quantity,unit_price,currency,gross_value,base_currency,base_value,organization_id,metadata)
values
 ('c1000000-0000-4000-8000-000000000105',
  'c1000000-0000-4000-8000-000000000102',
  'c1000000-0000-4000-8000-000000000104','PURCHASE','2026-03-01',
  1,400,'SAR',400,'SAR',400,'c1000000-0000-4000-8000-000000000103','{}'::jsonb),
 ('c1000000-0000-4000-8000-000000000106',
  'c1000000-0000-4000-8000-000000000102',
  'c1000000-0000-4000-8000-000000000104','SALE','2026-03-02',
  1,750,'SAR',750,'SAR',750,'c1000000-0000-4000-8000-000000000103','{}'::jsonb);
insert into public.lots(id,user_id,asset_account_id,source_transaction_id,acquisition_date,
 original_quantity,remaining_quantity,original_value_base,remaining_value_base,organization_id)
values('c1000000-0000-4000-8000-000000000107',
 'c1000000-0000-4000-8000-000000000102',
 'c1000000-0000-4000-8000-000000000104',
 'c1000000-0000-4000-8000-000000000105','2026-03-01',1,0,400,0,
 'c1000000-0000-4000-8000-000000000103');
insert into public.transaction_allocations(id,user_id,transaction_id,lot_id,quantity,value_base,allocation_method)
values('c1000000-0000-4000-8000-000000000108',
 'c1000000-0000-4000-8000-000000000102',
 'c1000000-0000-4000-8000-000000000106',
 'c1000000-0000-4000-8000-000000000107',1,400,'FIFO');

do $$ begin
 if (select count(*) from public.transaction_allocations
     where transaction_id='c1000000-0000-4000-8000-000000000106')<>1
 then raise exception 'PARITY_RLS_ALLOCATION_FIXTURE_MISSING';end if;
end $$;

select set_config('request.jwt.claim.sub',
 'c1000000-0000-4000-8000-000000000101',true);
set local role authenticated;

do $$
declare
 org uuid:='c1000000-0000-4000-8000-000000000103';
 sale uuid:='c1000000-0000-4000-8000-000000000106';
begin
 if public.financial_core_can(org,'financial_core.view') is distinct from true
 then raise exception 'PARITY_RLS_FINANCIAL_VIEW_PERMISSION_MISSING';end if;
 if not public.has_organization_permission(org,'assets.view')
 then raise exception 'PARITY_RLS_ASSET_VIEW_PERMISSION_MISSING';end if;
 if (select count(*) from public.transactions where id=sale and organization_id=org)<>1
 then raise exception 'PARITY_RLS_ASSET_TRANSACTION_HIDDEN';end if;
 if (select count(*) from public.transaction_allocations where transaction_id=sale)<>0
 then raise exception 'PARITY_RLS_ALLOCATION_LEAK_OR_POLICY_DRIFT';end if;
 -- Visibility of the SALE row together with zero visible allocations is
 -- NOT evidence of zero cost. A trusted server verifier is mandatory.
end $$;

reset role;
rollback;
