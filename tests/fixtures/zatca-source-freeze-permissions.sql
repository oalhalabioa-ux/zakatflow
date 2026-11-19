-- Permission adapter candidate: QA transaction only, not a deployment migration.
-- A narrow private definer is necessary because source-writing app roles must not
-- read/write the private ledger. This is NOT a generic signing/ledger endpoint.
create or replace function zatca_preparation.source_is_frozen(p_org uuid,p_invoice uuid) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if (public.has_organization_permission(p_org,'vat.edit')
       or public.has_organization_permission(p_org,'vat.issue')) is not true then
    raise exception 'VAT_FREEZE_ACCESS_DENIED';
  end if;
  return exists(select 1 from zatca_preparation.entries where organization_id=p_org and document_id=p_invoice);
end $$;
-- Supabase default privileges can include explicit app-role grants. Revoking only
-- PUBLIC is insufficient, especially for TRUNCATE (which is not protected by RLS).
revoke all on schema zatca_preparation from anon,authenticated,service_role;
revoke all on all tables in schema zatca_preparation from public,anon,authenticated,service_role;
revoke all on all functions in schema zatca_preparation from public,anon,authenticated,service_role;
grant usage on schema zatca_preparation to authenticated;
grant execute on function zatca_preparation.source_is_frozen(uuid,uuid) to authenticated;
