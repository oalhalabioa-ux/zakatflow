# Subscription design implementation — 2026-10-31

PR: https://github.com/oalhalabioa-ux/zakatflow/pull/321

## Delivered behavior

- Customer settings: current subscription from the real entitlement and saved quote; two published paid plan families, monthly/yearly switch, Latin digits in either language.
- Activation modal: selected institution, immutable server-priced plan, applicant from authenticated identity, phone and notes, manual activation; card method unavailable.
- Customer request history: status, owner response, cancellation and resubmission of requested information without replacing the saved quote.
- Owner workspace: institution register with actual metrics; subscription/members/history detail; activation-request inbox with search, filtering, pagination and approve/information/reject decisions; plan table and modal definition editor; payment readiness settings.
- System settings: theme-aware cards and an inline registration/address/invoice-unit dialog using existing VAT records, validation and APIs.
- Existing sidebar, separate account and permissions sections, Google authentication and financial calculations are retained.

## Security and compatibility

One additive migration adds private request and payment-readiness tables and guarded RPCs. Existing business rows, memberships, RLS policies and commercial subscriptions are not migrated or reactivated. Requests remain available after trial expiry. Every mutation checks current membership or live platform-owner authorization. The approval transaction locks plan, institution and request; rejects stale revisions/changed quotes; calls the existing subscription activation function and writes audit records. One open request per institution is enforced by both organization serialization and a partial unique index. Failed activation rolls back the complete decision. Card enablement is prohibited by a database constraint, with no payment-provider secrets, registration or charge.

## Validation

- Local TypeScript and unit regression suite.
- Observed-schema PostgreSQL reconstruction and request authorization/quote/approval/expiry tests, using synthetic records.
- Isolated Supabase Auth/PostgREST/API/Chromium workflow and canonical 220-migration bootstrap; evidence retained in GitHub Actions artifacts.
- Browser acceptance includes customer submission → owner approval → actual active-plan marker, native dialogs and all owner themes, real institution member details, system VAT profile save/reload, responsive Arabic/English pages.

Release verification results will be appended after all checks pass. No production financial writes or customer test activations are used for verification.

## Intentionally disabled / future work

Actual card processing, merchant credentials, payment collection, automatic billing and automatic renewal are not enabled. Readiness settings are metadata only; a future provider integration and explicit launch approval are required. ZATCA operational onboarding retains the existing simulation and production readiness restrictions.
