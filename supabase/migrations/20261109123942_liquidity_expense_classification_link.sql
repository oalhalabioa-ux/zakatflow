-- Optional detail mapping for manual operating expense categories.
-- Existing categories, financial events and policies keep their stored values.
alter table public.liquidity_flow_categories
  add column expense_classification_id uuid references public.financial_classifications(id);

grant insert (expense_classification_id)
  on public.liquidity_flow_categories to authenticated;

create function private.validate_liquidity_expense_classification()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.expense_classification_id is not null and (
    new.financial_classification_type is distinct from 'OPEX'
    or not exists (
      select 1 from public.financial_classifications c
      where c.id = new.expense_classification_id
        and c.organization_id = new.organization_id
        and c.classification_type = 'OPEX'
        and c.active
    )
  ) then
    raise exception 'LIQUIDITY_EXPENSE_CLASSIFICATION_INVALID';
  end if;
  return new;
end;
$$;

create trigger validate_liquidity_expense_classification
  before insert or update of expense_classification_id, organization_id, financial_classification_type
  on public.liquidity_flow_categories for each row
  execute function private.validate_liquidity_expense_classification();

revoke all on function private.validate_liquidity_expense_classification() from public, anon, authenticated;
-- An explicit liquidity detail must never become a generic fallback in VAT
-- invoice recognition, invoice amendments, or asset disposal losses.
do $$
declare signature text; definition text; needle text; replacement text;
begin
  for signature, needle, replacement in values
    ('public.prepare_vat_financial_event(text,uuid,uuid,date,uuid,uuid)',
     $old$classification_type='OPEX' and active order by is_system desc limit 1$old$,
     $new$classification_type='OPEX' and code='OPEX' and active limit 1$new$),
    ('public.amend_unsettled_purchase_invoice(uuid,text,date,date,uuid,text,text,text,numeric,numeric,numeric,numeric,numeric,jsonb,text)',
     $old$classification_type='OPEX' and active=true limit 1$old$,
     $new$classification_type='OPEX' and code='OPEX' and active=true limit 1$new$),
    ('public.prepare_asset_lifecycle(uuid,jsonb,uuid)',
     $old$classification_type=case when gain>0 then 'REVENUE' else 'OPEX' end and active order by is_system desc limit 1$old$,
     $new$classification_type=case when gain>0 then 'REVENUE' else 'OPEX' end and (gain>0 or code='OPEX') and active order by is_system desc limit 1$new$)
  loop
    definition := pg_get_functiondef(signature::regprocedure);
    if strpos(definition,needle)=0 then
      raise exception 'LIQUIDITY_OPEX_SOURCE_SIGNATURE_CHANGED %', signature;
    end if;
    execute replace(definition,needle,replacement);
  end loop;
end;
$$;
notify pgrst, 'reload schema';
