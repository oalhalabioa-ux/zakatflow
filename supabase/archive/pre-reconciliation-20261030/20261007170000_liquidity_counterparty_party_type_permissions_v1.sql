-- Keep counterparty writes column-scoped while allowing the accounting party taxonomy field.
revoke insert, update on public.liquidity_counterparties from authenticated;
grant insert (organization_id, name, party_type, party_type_id, contact_name, phone, email, notes, active)
  on public.liquidity_counterparties to authenticated;
grant update (name, party_type, party_type_id, contact_name, phone, email, notes, active, updated_at)
  on public.liquidity_counterparties to authenticated;
