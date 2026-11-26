-- Disposable PostgreSQL evidence for two purchase commands. All fixture writes roll back.
begin;
create temporary table purchase_fx_evidence(
 scenario text primary key, paid_usd numeric, posted_sar numeric,
 quantity_consumed_usd numeric, fifo_carrying_sar numeric, remaining_usd numeric,
 expected_lot_residue_usd numeric, expected_fifo_carrying_sar numeric,
 purchase_minus_expected_carrying_sar numeric, allocation_quantities_usd jsonb
);
grant insert on purchase_fx_evidence to authenticated;

do $fixture$
declare
 actor uuid:=gen_random_uuid();
 account jsonb;
 bank uuid;
 source_asset jsonb;
 acquired jsonb;
 purchase_id uuid;
 withdrawal public.transactions%rowtype;
 request uuid;
 payload jsonb;
 scenario record;
 quantity_used numeric;
 basis_used numeric;
 quantity_left numeric;
 expected_residue numeric;
 expected_basis numeric;
 allocated_quantities jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at)
 values(actor,actor||'@purchase-fx.invalid',now());
 update public.profiles set base_currency='SAR' where id=actor;
 set local role authenticated;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 for scenario in select * from (values
  ('same_rate_new',3.75::numeric,3.75::numeric,4::numeric,false),
  ('lower_purchase_rate_new',4,3.75,4,false),
  ('higher_purchase_rate_new',3.125,3.75,4,false),
  ('mixed_fifo_rates_existing',3.7,3.75,4,true)
 ) cases(name,first_rate,purchase_rate,second_rate,existing_asset) loop
  account:=public.create_asset_with_acquisition(jsonb_build_object(
   'name','USD funding '||scenario.name,'asset_type','BANK','currency','USD','ownership_scope','PERSONAL',
   'metadata',jsonb_build_object('quantity',case when scenario.existing_asset then 70 else 200 end,
    'purchase_value',case when scenario.existing_asset then 70 else 200 end,'purchase_date','2026-01-01',
    'acquisition_mode','OPENING_BALANCE','fx_rate',scenario.first_rate)),gen_random_uuid());
  bank:=(account->>'id')::uuid;
  if scenario.existing_asset then
   source_asset:=public.create_asset_with_acquisition(jsonb_build_object(
    'name','Synthetic proceeds source','asset_type','OTHER','currency','USD','ownership_scope','PERSONAL',
    'metadata',jsonb_build_object('quantity',1,'purchase_value',130,'purchase_date','2026-01-01',
     'acquisition_mode','OPENING_BALANCE','fx_rate',scenario.second_rate)),gen_random_uuid());
   perform public.post_sale_with_proceeds(actor,(source_asset->>'id')::uuid,bank,
    '2026-01-02',1,130,'USD','SAR',130*scenario.second_rate,null);
  end if;
  payload:=jsonb_build_object('name','USD purchase '||scenario.name,'asset_type','OTHER',
   'currency','USD','ownership_scope','PERSONAL',
   'metadata',jsonb_build_object('quantity',1,'purchase_value',100,'purchase_date','2026-02-01',
    'acquisition_mode','PURCHASE','fx_rate',scenario.purchase_rate,'funding_account_id',bank));
  request:=gen_random_uuid();
  if scenario.existing_asset then
   account:=public.create_asset_with_acquisition(jsonb_set(jsonb_set(payload,
    '{metadata,acquisition_mode}','"OPENING_BALANCE"'),'{metadata,purchase_value}','1'),gen_random_uuid());
   acquired:=public.purchase_existing_asset((account->>'id')::uuid,payload,request);
   purchase_id:=(acquired->>'id')::uuid;
   if (public.purchase_existing_asset((account->>'id')::uuid,payload,request)->>'id')::uuid is distinct from purchase_id then
    raise exception 'Existing purchase retry changed the voucher';
   end if;
  else
   acquired:=public.create_asset_with_acquisition(payload,request);
   purchase_id:=(acquired->>'acquisition_transaction_id')::uuid;
   if public.create_asset_with_acquisition(payload,request)->>'id' is distinct from acquired->>'id' then
    raise exception 'New purchase retry changed the asset';
   end if;
  end if;

  select * into strict withdrawal from public.transactions where asset_account_id=bank
   and transaction_type='WITHDRAWAL' and metadata->>'purchase_transaction_id'=purchase_id::text;
  if (select count(*) from public.transactions where asset_account_id=bank and transaction_type='WITHDRAWAL')<>1 then
   raise exception 'Purchase retry created more than one withdrawal in %',scenario.name;
  end if;
  select sum(a.quantity),sum(a.value_base),jsonb_agg(a.quantity order by l.acquisition_date,l.id)
   into quantity_used,basis_used,allocated_quantities
   from public.transaction_allocations a join public.lots l on l.id=a.lot_id
   where a.transaction_id=withdrawal.id;
  select sum(remaining_quantity) into quantity_left from public.lots where asset_account_id=bank;
  expected_residue:=200-withdrawal.gross_value;
  expected_basis:=case when scenario.existing_asset then 70*scenario.first_rate+30*scenario.second_rate
   else 100*scenario.first_rate end;
  if withdrawal.currency<>'USD' or withdrawal.gross_value<>100 or withdrawal.base_value<>375
     or withdrawal.quantity is distinct from quantity_used or 200-quantity_used is distinct from quantity_left then
   raise exception 'Unexpected baseline withdrawal or allocation in %',scenario.name;
  end if;
  insert into purchase_fx_evidence values(scenario.name,withdrawal.gross_value,withdrawal.base_value,
   quantity_used,basis_used,quantity_left,expected_residue,expected_basis,
   withdrawal.base_value-expected_basis,allocated_quantities);
 end loop;
end $fixture$;

reset role;
select jsonb_agg(to_jsonb(e) order by scenario) from purchase_fx_evidence e;
rollback;
