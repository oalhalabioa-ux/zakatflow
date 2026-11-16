-- Keep legacy budget-line rows for audit/recovery, but expose one active row
-- per plan and canonical line. This prevents duplicated totals without deleting
-- any user-entered budget or actual values.
alter table public.budget_lines
  add column if not exists active boolean not null default true;

with ranked as (
  select
    id,
    row_number() over (
      partition by plan_id, category, line_type, sort_order, name
      order by
        updated_at desc nulls last,
        (select coalesce(sum(abs(value)), 0) from unnest(monthly_budget) as value) desc,
        created_at desc,
        id desc
    ) as row_number
  from public.budget_lines
  where active = true
)
update public.budget_lines line
set active = false,
    updated_at = now()
from ranked
where ranked.id = line.id
  and ranked.row_number > 1;

create unique index if not exists idx_budget_lines_active_identity
  on public.budget_lines(plan_id, category, line_type, sort_order, name)
  where active = true;

grant select, insert, update, delete on public.budget_lines to authenticated;
