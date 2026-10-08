-- The disposable pending bundle must also remove its unapproved command registry entry.
do $cleanup$ declare definition text; begin
 definition:=pg_get_functiondef('public.delete_unissued_zatca_draft_bundle(uuid)'::regprocedure);
 definition:=replace(definition,'delete from public.financial_events where id=v_event and organization_id=v_org;', 'delete from public.financial_event_command_registry where financial_event_id=v_event and organization_id=v_org; delete from public.financial_events where id=v_event and organization_id=v_org;');
 execute definition;
end $cleanup$;
