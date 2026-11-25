-- Personal quotes are private. Existing organization and global readers keep their original table.
create table public.personal_fx_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  from_currency text not null references public.currencies(code),
  to_currency text not null references public.currencies(code),
  rate numeric(24,12) not null check (rate > 0 and rate <> 'NaN'::numeric),
  valuation_date date not null,
  source text not null,
  constraint personal_fx_distinct_currencies check (from_currency <> to_currency),
  constraint personal_fx_owner_pair_date_source unique
    (user_id, from_currency, to_currency, valuation_date, source)
);

alter table public.personal_fx_rates enable row level security;
revoke all on public.personal_fx_rates from public, anon, authenticated;
grant select, insert, update on public.personal_fx_rates to authenticated;

create policy personal_fx_read on public.personal_fx_rates
  for select to authenticated using (user_id = (select auth.uid()));
create policy personal_fx_insert on public.personal_fx_rates
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy personal_fx_update on public.personal_fx_rates
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Keep the existing atomic opening command and extend only its saved-rate lookup.
-- The command runs as a definer, so explicitly bind private rows to the authenticated owner.
do $migration$
declare
  definition text := pg_get_functiondef('private.manage_asset_opening(uuid,text,timestamptz,jsonb)'::regprocedure);
  old_source text := 'FROM public.fx_rates f';
  old_order text := 'ORDER BY (f.organization_id IS NOT NULL) DESC,f.valuation_date DESC,f.id DESC LIMIT 1';
begin
  if strpos(definition, old_source) = 0 or strpos(definition, old_order) = 0 then
    raise exception 'Unexpected manage_asset_opening FX lookup';
  end if;
  definition := replace(definition, old_source, $source$FROM (
     SELECT id, organization_id, from_currency, to_currency, rate, valuation_date, false AS personal
       FROM public.fx_rates
     UNION ALL
     SELECT id, NULL::uuid, from_currency, to_currency, rate, valuation_date, true
       FROM public.personal_fx_rates
       WHERE a.ownership_scope = 'PERSONAL' AND user_id = a.user_id AND user_id = auth.uid()
    ) f$source$);
  definition := replace(definition, old_order,
    'ORDER BY (f.organization_id IS NOT NULL OR f.personal) DESC,f.valuation_date DESC,f.id DESC LIMIT 1');
  execute definition;
end
$migration$;
