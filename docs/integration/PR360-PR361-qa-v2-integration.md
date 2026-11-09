# PR #360 + PR #361 — isolated QA V2 integration snapshot

Date: 2026-11-09. This is a reviewable **integration snapshot**, not a PR merger, not a release, and not approval to change Production.

## Exact sources
- PR #360 HEAD: `55bbabbb47181bffe13849f588c0b25f3d089ad2` — native settings, UI, financial setup, billing, reporting.
- PR #361 HEAD: `dd79028af813e1f4c3be5828e392c1b2f1b88c51` — independent feasibility studies, project establishment, collaborator controls, preliminary internal review.
- Integration branch parents: PR #360 HEAD only. The content changes of the 38 files from PR #361 are incorporated, but #361 is **not merged as commit ancestry**. This snapshot must not be promoted before full review.
- This branch did not update `main`, either PR branch, Vercel Production, Hostinger, or a database.

## Two manual conflict resolutions
1. `components/CorporateShell.tsx`: retain PR #360's settings sidebar and theme event handling; insert ONLY PR #361's feature-gated feasibility nav link immediately before navigationExtension.
2. `components/subscriptions/PlanEditor.tsx`: retain PR #360's expanded plan editor default (`open={!plan}`) and styling; retain PR #361's opt-in feasibility feature gate. Do not preselect feasibility in existing plans.

## High-risk semantic integration
- **Independent pricing**: PR #360 bundled-plan UI and RPC require assets/liquidity and an organization. PR #361's feasibility grants are per-user and can exist without an organization. A separate saleable offering/entitlement is still required. Avoid silently changing bundled accounting plan rules or marketing feasibility-only as already purchasable.
- **Transition to an organization**: feasibility's company setup route must be tested against PR #360's real organization setup wizard and authoritative membership. Study inputs are forecasts; they MUST NOT become journal entries, opening balances or approved budgets without an explicit V2 adapter and approval.
- **QA**: use ONLY Vercel project `yaqeen-financial-core-v2-qa` and Supabase `ubotbpjngtfvolthpfec`. Do not use legacy `wtzgzmcgcqouziqzsfnl` or Production/Hostinger.
- **Schema history**: QA-only feasibility schema files remain under `docs/feasibility/`; they must not be added to Production's canonical migration history or re-run on V2 QA if already applied.
- **Security**: independently validate grants, sharing invitation/cancel/revoke, draft revision conflicts, immutable preliminary review snapshots and RLS against an unauthorized second user.
- **Feature gates**: keep studies, cloud, sharing, V2 handoff and billing flags OFF outside specifically approved QA preview.

## Required acceptance for Work
1. Pin and recheck both PR HEADs; rebuild this snapshot when #360 or #361 changes. Do not blindly overwrite newer edits.
2. Typecheck, full unit test, Next build, settings native UI, isolated billing, financial opening/reporting, assets, and canonical-migrations acceptance on the **combined code**.
3. Verify Arabic RTL, mobile/desktop, approved navy/gold/green/pearl palette and icons; protect existing global sidebar, topbar, subscription tabs, organization setup and reporting views.
4. Verify study lifecycle: project list, feasibility model, funding, sensitivity, legal review, tasks, approvals, invitations (invite / accept / reject / revoke), participant membership, versioned cloud backups, read-only expiry, and distinct organization setup flow.
5. Verify no ledger/opening/production writes. Record QA evidence, screenshots, and pass/fail per case.
6. Keep PR #360 and #361 as Draft. Do not merge or Production-deploy without new explicit approval.

This snapshot is temporary integration evidence only.
