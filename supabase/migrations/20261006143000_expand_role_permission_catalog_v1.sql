-- Expand role permission catalog while preserving allow-list validation
alter table public.organization_roles drop constraint if exists organization_roles_permissions_check;
alter table public.organization_roles add constraint organization_roles_permissions_check check (permissions <@ array[
'organization.view','organization.edit',
'financial_core.view','financial_core.create','financial_core.submit','financial_core.approve','financial_core.post','financial_core.reverse','financial_core.self_approve',
'liquidity.view','liquidity.edit','liquidity.settle',
'vat.view','vat.edit','vat.issue',
'assets.view','assets.edit',
'budget.view','budget.edit','budget.submit','budget.approve',
'zakat.view','zakat.edit','audit.view'
]::text[]);