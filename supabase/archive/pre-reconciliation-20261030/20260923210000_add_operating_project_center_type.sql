-- Add a project-operating classification without changing existing centers.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.organization_cost_centers'::regclass
      and conname = 'organization_cost_centers_center_type_check'
  ) then
    alter table public.organization_cost_centers
      drop constraint organization_cost_centers_center_type_check;
  end if;

  alter table public.organization_cost_centers
    add constraint organization_cost_centers_center_type_check
    check (center_type in ('ADMIN','OPERATING','PROJECT_OPERATING','INVESTMENT','TREASURY','FINANCING'));
end $$;
