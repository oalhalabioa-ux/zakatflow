create or replace function private.can_write_liquidity(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='pg_catalog','public' as $$
  select public.is_organization_admin(p_organization_id) or public.has_organization_permission(p_organization_id,'liquidity.edit');
$$;
revoke insert, update on public.liquidity_flows from authenticated;
grant insert (organization_id,entity_id,account_id,direction,flow_type,title,counterparty,counterparty_id,due_date,amount,currency,base_amount,status,source,reference,notes,category_id,source_module,source_record_id,source_event_key,budget_line_id) on public.liquidity_flows to authenticated;
grant update (entity_id,account_id,direction,flow_type,title,counterparty,counterparty_id,due_date,amount,currency,base_amount,status,source,reference,notes,category_id,source_module,source_record_id,source_event_key,budget_line_id,updated_at) on public.liquidity_flows to authenticated;
revoke insert, update on public.liquidity_counterparties from authenticated;
grant insert (organization_id,name,party_type,party_type_id,contact_name,phone,email,notes,active) on public.liquidity_counterparties to authenticated;
grant update (name,party_type,party_type_id,contact_name,phone,email,notes,active,updated_at) on public.liquidity_counterparties to authenticated;