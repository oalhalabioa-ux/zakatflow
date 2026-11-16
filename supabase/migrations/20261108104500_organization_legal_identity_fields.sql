-- Additive, tenant-owned organization legal identity master fields.
-- Existing entities remain valid with NULLs until their owners complete setup.
-- The registered legal address is distinct from the VAT invoice seller address.
-- Existing organizations RLS policies restrict writes to the authorized owner.
alter table public.organizations
 add column country_code text,
 add column commercial_registration_number text,
 add column registered_address text;
