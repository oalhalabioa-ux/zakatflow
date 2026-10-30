-- Default editable organization roles V1
create or replace function public.seed_default_organization_roles(p_org uuid)
returns void language plpgsql security definer set search_path='pg_catalog','public' as $$
declare u uuid:=auth.uid();
begin
 if u is null or not exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=u and m.status='ACTIVE' and m.role='OWNER') then raise exception 'OWNER_REQUIRED_TO_SEED_ROLES'; end if;
 insert into public.organization_roles(organization_id,name,description,permissions,created_by,role_key,is_system_template,is_editable,amount_limits)
 values
 (p_org,'CFO / Finance Manager','Finance leadership and approval',
  array['organization.view','financial_core.view','financial_core.create','financial_core.submit','financial_core.approve','financial_core.post','financial_core.reverse','liquidity.view','liquidity.edit','liquidity.settle','vat.view','vat.edit','vat.issue','assets.view','assets.edit','budget.view','budget.edit','budget.submit','budget.approve','zakat.view','zakat.edit'],u,'CFO',true,true,'{}'),
 (p_org,'Accountant','Day-to-day accounting preparation and submission',
  array['organization.view','financial_core.view','financial_core.create','financial_core.submit','liquidity.view','liquidity.edit','vat.view','vat.edit','vat.issue','assets.view','assets.edit','budget.view','budget.edit','zakat.view','zakat.edit'],u,'ACCOUNTANT',true,true,'{}'),
 (p_org,'Junior Accountant / Data Entry','Preparation and data entry without approval or settlement',
  array['organization.view','financial_core.view','financial_core.create','liquidity.view','vat.view','vat.edit','assets.view','assets.edit','budget.view','budget.edit','zakat.view'],u,'DATA_ENTRY',true,true,'{}'),
 (p_org,'Treasury','Cash and settlement operations',
  array['organization.view','financial_core.view','liquidity.view','liquidity.edit','liquidity.settle'],u,'TREASURY',true,true,'{}'),
 (p_org,'FP&A / Budget','Planning, budgeting and analysis',
  array['organization.view','financial_core.view','liquidity.view','budget.view','budget.edit','budget.submit'],u,'FPA',true,true,'{}'),
 (p_org,'Tax & Zakat','VAT, tax and zakat operations',
  array['organization.view','financial_core.view','vat.view','vat.edit','vat.issue','zakat.view','zakat.edit'],u,'TAX_ZAKAT',true,true,'{}'),
 (p_org,'Internal Auditor','Read-only audit and control review',
  array['organization.view','financial_core.view','liquidity.view','vat.view','assets.view','budget.view','zakat.view','audit.view'],u,'INTERNAL_AUDITOR',true,true,'{}'),
 (p_org,'Viewer','Read-only business visibility',
  array['organization.view','financial_core.view','liquidity.view','vat.view','assets.view','budget.view','zakat.view'],u,'VIEWER',true,true,'{}')
 on conflict (organization_id,role_key) where role_key is not null do update set
 name=excluded.name,description=excluded.description,is_system_template=true,is_editable=true,updated_at=now();
end $$;
