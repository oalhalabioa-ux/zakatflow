-- Linked credit notes may reduce a paid invoice and create a separate refund
-- obligation. Other adjustment commands keep the existing unsettled-only rule.
do $guard$ declare definition text; begin
 if to_regprocedure('public.financial_core_guard_obligation_posting()') is not null then
  definition:=pg_get_functiondef('public.financial_core_guard_obligation_posting()'::regprocedure);
  definition:=replace(definition,'if v_due<v_paid then raise exception ''CREDIT_ADJUSTMENT_EXCEEDS_UNSETTLED_BALANCE'';', 'if v_due<0 or (v_due<v_paid and not exists(select 1 from public.financial_vat_source_bindings note_binding where note_binding.event_id=new.id and note_binding.organization_id=new.organization_id and note_binding.document_kind=''CREDIT_NOTE'' and note_binding.canonical_payload->>''adapter''=''LINKED_NOTE_V1'')) then raise exception ''CREDIT_ADJUSTMENT_EXCEEDS_UNSETTLED_BALANCE'';');
  execute definition;
 end if;
end $guard$;
