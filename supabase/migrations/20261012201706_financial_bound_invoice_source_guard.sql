BEGIN;
CREATE OR REPLACE FUNCTION private.accounting_invoice_binding_state(p_org uuid,p_document uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='pg_catalog','public' AS $$
DECLARE linked boolean; recognized boolean;BEGIN
 IF auth.uid() IS NULL OR NOT (public.has_organization_permission(p_org,'vat.edit') OR public.has_organization_permission(p_org,'financial_core.view')) THEN RAISE EXCEPTION 'INVOICE_BINDING_SCOPE_DENIED';END IF;
 SELECT count(*)>0,coalesce(bool_or(e.status IN('ACTUAL','REVERSED')),false) INTO linked,recognized FROM public.financial_events e WHERE e.organization_id=p_org AND (EXISTS(SELECT 1 FROM public.financial_event_links l WHERE l.event_id=e.id AND l.organization_id=p_org AND l.target_module='vat_documents' AND l.target_record_id=p_document AND l.link_type='SOURCE') OR EXISTS(SELECT 1 FROM public.financial_vat_source_bindings b WHERE b.event_id=e.id AND b.organization_id=p_org AND b.source_table='vat_documents' AND b.source_record_id=p_document));
 RETURN jsonb_build_object('bound',linked,'posted',recognized);
END $$;
REVOKE ALL ON FUNCTION private.accounting_invoice_binding_state(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.accounting_invoice_binding_state(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION private.guard_accounting_invoice_source() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='pg_catalog','public' AS $$
DECLARE bound boolean; posted boolean;
BEGIN
 IF OLD.document_kind<>'INVOICE' THEN IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'zatca_status'-'notes') IS NOT DISTINCT FROM (to_jsonb(OLD)-'zatca_status'-'notes') THEN RETURN NEW;END IF;
 SELECT (x->>'bound')::boolean,(x->>'posted')::boolean INTO bound,posted FROM (SELECT private.accounting_invoice_binding_state(OLD.organization_id,OLD.id) x) q;
 IF bound AND (posted OR current_user NOT IN('postgres','supabase_admin')) THEN RAISE EXCEPTION 'VAT_BOUND_INVOICE_REQUIRES_CORRECTION';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_accounting_invoice_source BEFORE UPDATE OR DELETE ON public.vat_documents FOR EACH ROW EXECUTE FUNCTION private.guard_accounting_invoice_source();
REVOKE ALL ON FUNCTION private.guard_accounting_invoice_source() FROM PUBLIC,anon,authenticated;

COMMIT;