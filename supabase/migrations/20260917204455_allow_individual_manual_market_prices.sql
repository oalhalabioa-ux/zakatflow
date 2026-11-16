drop policy if exists prices_insert_restricted on public.market_prices;
create policy prices_insert_restricted
on public.market_prices
for insert
to authenticated
with check (
  auth.uid() is not null
  and exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('ADMIN','ACCOUNTANT','SHARIA_REVIEWER','INDIVIDUAL')
  )
);