-- Assets V2 database integrity hardening (QA first).
-- Mirrors application validation so invalid ownership/classification scope
-- cannot be inserted by another write path.

alter table public.asset_accounts
 add constraint asset_accounts_class_type_pair_check
 check (
   (asset_class_code is null and asset_type_code is null)
   or (asset_class_code is not null and asset_type_code is not null)
 );

create or replace function public.validate_asset_v2_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_class text;
begin
  if new.asset_type_code is not null then
    select class_code into v_class
    from public.asset_types_v2
    where code = new.asset_type_code and active = true;

    if v_class is null or v_class <> new.asset_class_code then
      raise exception 'ASSET_CLASS_TYPE_MISMATCH';
    end if;
  end if;

  if new.entity_id is not null
     and not exists (
       select 1 from public.organization_entities e
       where e.id = new.entity_id
         and e.organization_id = new.organization_id
     ) then
    raise exception 'ASSET_ENTITY_SCOPE_MISMATCH';
  end if;

  if new.cost_center_id is not null
     and not exists (
       select 1 from public.organization_cost_centers c
       where c.id = new.cost_center_id
         and c.organization_id = new.organization_id
     ) then
    raise exception 'ASSET_COST_CENTER_SCOPE_MISMATCH';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_asset_v2_scope on public.asset_accounts;
create trigger trg_validate_asset_v2_scope
before insert or update of
  ownership_scope,
  organization_id,
  entity_id,
  cost_center_id,
  asset_class_code,
  asset_type_code
on public.asset_accounts
for each row execute function public.validate_asset_v2_scope();
