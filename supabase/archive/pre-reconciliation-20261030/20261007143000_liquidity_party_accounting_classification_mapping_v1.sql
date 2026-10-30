-- Map counterparty types to the accounting treatments they are appropriate for.
alter table public.liquidity_party_types
add column if not exists allowed_financial_classifications text[] not null default array['OTHER']::text[];

alter table public.liquidity_party_types drop constraint if exists liquidity_party_types_allowed_financial_classifications_check;
alter table public.liquidity_party_types add constraint liquidity_party_types_allowed_financial_classifications_check
check (cardinality(allowed_financial_classifications)>0 and allowed_financial_classifications <@ array['REVENUE','OPEX','CAPEX','ASSET','LIABILITY','FINANCING','INVESTMENT','EQUITY','TAX','ZAKAT','RECEIVABLE','PAYABLE','TRANSFER','OTHER']::text[]);

insert into public.liquidity_party_types(organization_id,code,name_ar,name_en,is_system,active,created_by,allowed_financial_classifications)
select o.id,v.code,v.name_ar,v.name_en,true,true,null,v.allowed
from public.organizations o
cross join (values
 ('CUSTOMER','عميل','Customer',array['REVENUE','RECEIVABLE']::text[]),('SUPPLIER','مورد','Supplier',array['OPEX','PAYABLE']::text[]),
 ('BOTH','عميل ومورد','Customer & Supplier',array['REVENUE','RECEIVABLE','OPEX','PAYABLE']::text[]),('PERSON','فرد','Individual',array['REVENUE','RECEIVABLE','OPEX','PAYABLE','OTHER']::text[]),
 ('EMPLOYEE','موظف','Employee',array['OPEX','PAYABLE','RECEIVABLE']::text[]),('ASSET_SUPPLIER','مورد أصول','Asset Supplier',array['CAPEX','ASSET','PAYABLE']::text[]),
 ('INVESTMENT_COUNTERPARTY','جهة استثمار','Investment Counterparty',array['INVESTMENT','PAYABLE','RECEIVABLE']::text[]),('LENDER','ممول / بنك','Lender / Bank',array['FINANCING','LIABILITY','PAYABLE']::text[]),
 ('OWNER','مالك / مساهم','Owner / Shareholder',array['EQUITY']::text[]),('TAX_AUTHORITY','جهة ضريبية','Tax Authority',array['TAX','PAYABLE','RECEIVABLE']::text[]),
 ('ZAKAT_AUTHORITY','جهة زكوية','Zakat Authority',array['ZAKAT','PAYABLE']::text[]),('OTHER','أخرى','Other',array['OTHER']::text[])
) as v(code,name_ar,name_en,allowed)
where not exists(select 1 from public.liquidity_party_types t where t.organization_id=o.id and t.code=v.code);

update public.liquidity_party_types set allowed_financial_classifications=case code
 when 'CUSTOMER' then array['REVENUE','RECEIVABLE']::text[] when 'SUPPLIER' then array['OPEX','PAYABLE']::text[] when 'BOTH' then array['REVENUE','RECEIVABLE','OPEX','PAYABLE']::text[]
 when 'PERSON' then array['REVENUE','RECEIVABLE','OPEX','PAYABLE','OTHER']::text[] when 'EMPLOYEE' then array['OPEX','PAYABLE','RECEIVABLE']::text[]
 when 'ASSET_SUPPLIER' then array['CAPEX','ASSET','PAYABLE']::text[] when 'INVESTMENT_COUNTERPARTY' then array['INVESTMENT','PAYABLE','RECEIVABLE']::text[]
 when 'LENDER' then array['FINANCING','LIABILITY','PAYABLE']::text[] when 'OWNER' then array['EQUITY']::text[] when 'TAX_AUTHORITY' then array['TAX','PAYABLE','RECEIVABLE']::text[]
 when 'ZAKAT_AUTHORITY' then array['ZAKAT','PAYABLE']::text[] else allowed_financial_classifications end
where code in ('CUSTOMER','SUPPLIER','BOTH','PERSON','EMPLOYEE','ASSET_SUPPLIER','INVESTMENT_COUNTERPARTY','LENDER','OWNER','TAX_AUTHORITY','ZAKAT_AUTHORITY');