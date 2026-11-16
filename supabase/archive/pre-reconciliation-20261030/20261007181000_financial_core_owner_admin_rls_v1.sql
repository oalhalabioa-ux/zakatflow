-- Financial Core owner/admin authorization baseline.
-- RLS controls tenant scope; accounting immutability remains enforced by constraints/triggers/RPCs.
do $$
declare t text;
begin
  foreach t in array array[
    'financial_events','financial_event_lines','financial_event_obligations',
    'financial_event_obligation_allocations','financial_event_links','financial_event_status_history'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_owner_admin_all',t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_organization_admin(organization_id)) with check (public.is_organization_admin(organization_id))',
      t||'_owner_admin_all',t
    );
  end loop;
end $$;
