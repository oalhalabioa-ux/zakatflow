-- Dispatch the new note adapter to its own projection and avoid PL/pgSQL record aliases.
do $dispatch$ declare definition text; begin
 if to_regprocedure('private.phase2c_expected_integrity()') is not null then
  definition:=pg_get_functiondef('private.phase2c_expected_integrity()'::regprocedure);
  definition:=replace(definition,'financial_vat_source_bindings b where b.organization_id=new.organization_id and b.source_record_id=new.source_record_id and b.canonical_payload', 'financial_vat_source_bindings note_binding where note_binding.organization_id=new.organization_id and note_binding.source_record_id=new.source_record_id and note_binding.canonical_payload');
  definition:=replace(definition,'financial_vat_source_bindings b on b.source_record_id=n.id and b.organization_id=n.organization_id join public.financial_events e on e.id=b.event_id where n.preceding_document_id=new.source_record_id and n.organization_id=new.organization_id and e.status=''ACTUAL'' and b.canonical_payload', 'financial_vat_source_bindings note_binding on note_binding.source_record_id=n.id and note_binding.organization_id=n.organization_id join public.financial_events note_event on note_event.id=note_binding.event_id where n.preceding_document_id=new.source_record_id and n.organization_id=new.organization_id and note_event.status=''ACTUAL'' and note_binding.canonical_payload');
  execute definition;
 end if;
 if to_regprocedure('private.phase2c_sync_expected()') is not null then
  definition:=pg_get_functiondef('private.phase2c_sync_expected()'::regprocedure);
  definition:=replace(definition,'if not found then return new; end if;', 'if not found then return new; end if; if b.canonical_payload->>''adapter''=''LINKED_NOTE_V1'' then return new; end if;');
  execute definition;
 end if;
end $dispatch$;
