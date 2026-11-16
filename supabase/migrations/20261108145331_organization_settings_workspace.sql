-- Optional organization profile fields. Preserve existing rows and accounting
-- currency, postings, openings, RLS, grants and subscription write guards.
-- This additive migration must precede deployment of the settings workspace.
alter table public.organizations
 add column activity text,
 add column contact_email text,
 add column contact_phone text,
 add column registered_city text,
 add column registered_region text,
 add column registered_postal_code text,
 add column registration_authority text,
 add column registration_expires_on date;
