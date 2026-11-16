-- Financial corrections tested in the Production parity QA environment.
BEGIN;
ALTER VIEW public.liquidity_flow_settlement_reconciliation SET (security_invoker=true);
REVOKE ALL ON TABLE public.liquidity_flow_settlement_reconciliation FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.liquidity_flow_settlement_reconciliation TO authenticated;
ALTER VIEW public.liquidity_account_settlement_ledger_summary SET (security_invoker=true);
REVOKE ALL ON TABLE public.liquidity_account_settlement_ledger_summary FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.liquidity_account_settlement_ledger_summary TO authenticated;
ALTER VIEW public.financial_core_cash_event_flow_links SET (security_invoker=true);
REVOKE ALL ON TABLE public.financial_core_cash_event_flow_links FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.financial_core_cash_event_flow_links TO authenticated;
ALTER VIEW public.financial_core_cash_reconciliation SET (security_invoker=true);
REVOKE ALL ON TABLE public.financial_core_cash_reconciliation FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.financial_core_cash_reconciliation TO authenticated;
ALTER VIEW public.financial_core_event_cash_position SET (security_invoker=true);
REVOKE ALL ON TABLE public.financial_core_event_cash_position FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.financial_core_event_cash_position TO authenticated;
CREATE POLICY financial_classifications_org_insert ON public.financial_classifications FOR INSERT TO authenticated WITH CHECK (created_by=auth.uid() AND NOT is_system AND public.has_organization_permission(organization_id,'organization.edit'));

COMMIT;