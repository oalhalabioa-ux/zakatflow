# Platform Owner QA — acceptance and security checklist

**Dedicated QA Supabase:** `weucywfwbdnomtlkjurl`. **Branch:** `feature/platform-owner-dashboard-qa`.
**Important:** Prior revision of this document incorrectly named FATOORA QA `mbilbpaxnuxfgyweztsa` as the owner-dashboard target. That is obsolete and must NOT be used. Production, FATOORA QA and Financial Core QA must remain unchanged.

## Implemented in branch (not yet fully browser-tested)
- [x] Protected owner dashboard with user, organization and active subscription counts.
- [x] Owner-only paginated users and organizations read views.
- [x] Owner-only subscription summary.
- [x] Owner-only payments, analytics and settings routes; payments/settings remain read-only.
- [x] All six navigation links resolve to actual route files in source.
- [x] Platform Admin QA database has RLS enabled on all four platform tables (SQL inspected).
- [x] Reviewed owner RPC definitions: owner_list_users, owner_list_organizations, owner_subscription_summary call owner_authorized(), and use empty search_path.

## Must pass before final QA deployment
- [ ] TypeScript, lint, build and route checks.
- [ ] Browser tests: owner, regular user and anonymous; direct URLs for all six routes; RTL and mobile.
- [ ] RLS and RPC negative authorization tests; confirm no service-role secrets exposed.
- [ ] Payment ledger design: idempotency, verified provider events, refunds, chargebacks, currencies, reconciliation and audit trail.
- [ ] Subscription lifecycle: plans, trials, renewals, upgrades, downgrades, expiry and cancellation.
- [ ] Write-operation approval gates, least-privilege roles and audit history.
- [ ] Production reporting requires an explicitly approved safe read-only sync; QA currently does not represent live customer totals.
- [ ] Commit reproducible schema migration and automated security tests.
- [ ] Security advisors and final isolated QA smoke test.
- [ ] User approval before final QA deploy, main merge or any Production changes.

## Current constraints
Do not treat missing QA revenue as zero actual revenue. No real payment processing, Production data import, or Production sync is enabled. Never copy a production service-role key to QA. Preserve existing FATOORA QA migrations until a separate dependency audit and explicit approval.
