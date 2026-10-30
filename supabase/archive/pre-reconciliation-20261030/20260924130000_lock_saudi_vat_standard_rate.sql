alter table public.vat_profiles
  drop constraint if exists vat_profiles_standard_rate_check;

alter table public.vat_profiles
  add constraint vat_profiles_standard_rate_check
  check (standard_rate = 15.00);
