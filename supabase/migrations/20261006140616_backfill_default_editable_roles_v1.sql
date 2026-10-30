-- Backfill editable default roles for existing organizations without changing existing custom roles.
with owners as (
 select distinct on (organization_id) organization_id,user_id from public.organization_members where status='ACTIVE' and role='OWNER' order by organization_id,created_at
), templates(role_key,name,description,permissions) as (values
 ('CFO','CFO / Finance Manager','Finance leadership and approval',array['organization.view','financial_core.view','financial_core.create','financial_core.submit','financial_core.approve','financial_core.post','financial_core.reverse','liquidity.view','liquidity.edit','liquidity.settle','vat.view','vat.edit','vat.issue','assets.view','assets.edit','budget.view','budget.edit','budget.submit','budget.approve','zakat.view','zakat.edit']::text[]),
 ('ACCOUNTANT','Accountant','Day-to-day accounting preparation and submission',array['organization.view','financial_core.view','financial_core.create','financial_core.submit','liquidity.view','liquidity.edit','vat.view','vat.edit','vat.issue','assets.view','assets.edit','budget.view','budget.edit','zakat.view','zakat.edit']::text[]),
 ('DATA_ENTRY','Junior Accountant / Data Entry','Preparation and data entry without approval or settlement',array['organization.view','financial_core.view','financial_core.create','liquidity.view','vat.view','vat.edit','assets.view','assets.edit','budget.view','budget.edit','zakat.view']::text[]),
 ('TREASURY','Treasury','Cash and settlement operations',array['organization.view','financial_core.view','liquidity.view','liquidity.edit','liquidity.settle']::text[]),
 ('FPA','FP&A / Budget','Planning, budgeting and analysis',array['organization.view','financial_core.view','liquidity.view','budget.view','budget.edit','budget.submit']::text[]),
 ('TAX_ZAKAT','Tax & Zakat','VAT, tax and zakat operations',array['organization.view','financial_core.view','vat.view','vat.edit','vat.issue','zakat.view','zakat.edit']::text[]),
 ('INTERNAL_AUDITOR','Internal Auditor','Read-only audit and control review',array['organization.view','financial_core.view','liquidity.view','vat.view','assets.view','budget.view','zakat.view','audit.view']::text[]),
 ('VIEWER','Viewer','Read-only business visibility',array['organization.view','financial_core.view','liquidity.view','vat.view','assets.view','budget.view','zakat.view']::text[])
)
insert into public.organization_roles(organization_id,name,description,permissions,created_by,role_key,is_system_template,is_editable,amount_limits)
select o.organization_id,t.name,t.description,t.permissions,o.user_id,t.role_key,true,true,'{}'::jsonb from owners o cross join templates t
on conflict(organization_id,role_key) where role_key is not null do update set is_system_template=true,is_editable=true;