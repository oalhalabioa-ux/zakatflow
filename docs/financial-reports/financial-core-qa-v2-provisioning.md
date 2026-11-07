# Yaqeen Financial Core QA V2 — staged provisioning and cutover
Date: 2026-11-07. Status: **PROJECT CREATION WAITING FOR EXPLICIT $10/MONTH COST CONFIRMATION**.

## 1. Nonnegotiable safeguards
- Production project ID: `ejpzcsfwqziqxwhvqnay`. **READ ONLY** (metadata comparison only). No migration, API changes, schema mutation, customer-data export, or deployment against Production.
- Retained legacy Financial Core QA project: `wtzgzmcgcqouziqzsfnl`. No schema changes, resets, migration-history repairs, fixture deletion, or renaming until acceptance and backup. It is **not** a valid canonical release gate.
- Target organization: `Obada` (`tckuzqohfjilqfdudclh`), the **only** Supabase organization visible to the connected account.
- Target project: `Yaqeen Financial Core QA V2`, region `eu-central-1` (same as Production). Keep project isolated and **do not connect any production domain, provider webhook, cron, payment gateway, Resend outbound sender, ZATCA live endpoint, or live customer account.**
- Quoted Supabase project charge from live `get_cost`: **USD 10 monthly**, not yet approved **after the price was quoted**. `create_project` without confirmation ID was rejected by the service (`This client needs a cost confirmation ID`); no project was provisioned in this attempt. Before retrying, obtain explicit agreement to this amount, then call `confirm_cost` and `create_project`.
- Prefer **schema-only rebuild**, NOT `Restore to a New Project` from physical backups. Supabase documents that physical restore copies **customer data, auth users, hashed passwords, permissions, etc.**, and could activate external integrations. That is inappropriate for a synthetic-data QA environment without a separately approved, strong de-identification and external-side-effect isolation plan.
- All 246 Production migration IDs are in PR #360 canonical `supabase/migration-history.json` (249 total); branch is at/after Production Vercel Git commit `939cc6cfe2cdbb0d430a10d2228dc8bb0109512c`.

## 2. Provisioning sequence (after paid-project approval only)
1. Reconfirm Production deployment SHA and migration/structure inventory are unchanged. If they changed, refresh the baseline rather than assuming 246.
2. Use the Supabase `create_project` connector with cost-confirmation ID and target organization/region above. Record project ref and verify `ACTIVE_HEALTHY`.
3. **On the NEW V2 project only:** apply the canonical migration files (in `supabase/migration-history.json`) in ascending version order using migration-controlled DDL, verifying the exact file SHA256 and previously applied migration version ID before each application. If using the connector `apply_migration`, inspect what migration version ID it records: do not assume it preserves historical IDs; validate the final schema and maintain an explicit mapping. An authenticated, protected CLI migration deployment with the correct baseline is preferable if authorized.
4. Reconcile metadata fingerprints with the live Production **schema baseline** via `scripts/financial-reports/schema-parity-manifest.sql` and `compare-production-core-schema.mjs`. The 246-migration stage must not miss any Production runtime table, column, function, trigger, constraint, grant or policy. Diagnostic-only metadata (`private_budget_backups`, `qa_legacy`) can be excluded explicitly from the runtime parity gate, but NEVER silently ignore differences in business tables.
5. Apply the three additional **unmerged** PR #360 migrations in order:
   - `20261106154742_financial_group_control_evidence_v1.sql`
   - `20261107010000_financial_branch_opening_distribution.sql`
   - `20261107113000_financial_legacy_source_attestation.sql`.
6. Repeat baseline comparison with only these **explicitly expected additive PR deltas** allowed; review any changed pre-existing function/guard instead of broadly accepting drift. Re-run the complete canonical migration / QA SQL suite already exercised in disposable CI.
7. Configure **QA-only Auth, API URLs, redirect allowlists, test-email disable/guard, synthetic users, strict RLS, no production secrets**; use separate environment variables, never replace Vercel Production settings. Validate roles, org/branch isolation, VAT/asset and ZATCA test-only behavior.
8. Seed **synthetic** company / personal / HQ / 2 branches / approved and zero opening / payment & subscription / year-close data. Do not copy customer or Auth user records.
9. Validate real PostgREST and browser UAT, fiscal opening/close, tenant RLS, source-line completeness, branch group consolidation, double-count prevention, bank flows, Asset FIFO, and each of the nine finance report layouts. Require successful repeatable evidence.
10. Switch only the **development/test** endpoints to V2 after acceptance, confirm rollback path, preserve old QA until safe archive, then separately approve pause/deletion to stop redundant charges.
11. Production release remains **BLOCKED** until real authenticated-source and accounting report certification, restore rehearsal, security review and explicit merge/release approval.

## 3. Current state / evidence
- [x] Production and legacy QA live read-only SQL inventory and migration version comparison completed.
- [x] Existing code branch inspected: PR #360 is based on the latest observed Vercel Production `main` commit, without newer main commits missing.
- [x] Structural inventory exporter, strict comparator and 4 Vitest cases committed on PR #360. All 6 disposable GitHub workflows had succeeded on the earlier audit commit; recheck current SHA before any release.
- [x] Single correct organization and same AWS EU region verified.
- [x] Pricing returned `USD 10 monthly`. Cost-confirmation workflow identified.
- [ ] Explicit **post-quote cost acceptance** from owner.
- [ ] New project created and verified.
- [ ] Schema-only migration replay and baseline parity.
- [ ] PR-only migrations rehearsed and reviewed.
- [ ] QA-only synthetic fixtures and external-services isolation.
- [ ] Hosted E2E/report/tenant certification.
- [ ] Cutover of QA endpoints; archive and eventual deletion of previous QA after separate approval.

Official reference: https://supabase.com/docs/guides/platform/clone-project (warning: physical restore includes data and auth).
