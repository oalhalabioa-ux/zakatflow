alter table public.liquidity_flow_categories
  add column if not exists financial_classification_type text;

alter table public.liquidity_flow_categories
  drop constraint if exists liquidity_flow_categories_financial_classification_type_check;
alter table public.liquidity_flow_categories
  add constraint liquidity_flow_categories_financial_classification_type_check
  check (financial_classification_type is null or financial_classification_type in
    ('REVENUE','OPEX','CAPEX','ASSET','LIABILITY','RECEIVABLE','PAYABLE','FINANCING','INVESTMENT','EQUITY','TAX','ZAKAT','TRANSFER','OTHER'));

update public.liquidity_flow_categories
set financial_classification_type = case
  when flow_group='PAYROLL' then 'OPEX'
  when flow_group='TAX' then 'TAX'
  when flow_group='FINANCING' then 'FINANCING'
  when flow_group='INVESTMENT' then 'INVESTMENT'
  when flow_group='OPERATING' and allowed_direction='INFLOW' then 'REVENUE'
  when flow_group='OPERATING' and allowed_direction='OUTFLOW' then 'OPEX'
  else financial_classification_type
end
where financial_classification_type is null;