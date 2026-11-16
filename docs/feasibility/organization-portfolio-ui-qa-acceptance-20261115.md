# QA V2 — Institutional feasibility portfolio UI integration checkpoint

## Scope
Staged exclusively on PR #418 and Supabase QA V2. The legacy per-user personal cache key `yaqeen-feasibility-drafts-v1:<userId>` remains unchanged. No personal study is copied to an organization automatically. No Production/main/Financial Core V1 operations.

## Implemented under default-OFF gates
- The global personal/institutional topbar determines the portfolio display; selected organization comes from global banner selection, not a duplicate selector in Feasibility.
- Company state is **in-memory only** and separate from personal browser-local drafts. Changing account, company or scope resets company state and ignores late reads/saves for the previous identity.
- Authenticated company GET uses `/api/feasibility/organization-projects?organization=<uuid>` with no-store; server returns `{studies,canWrite}`. Validation rejects bad study/ownership/organization/revision metadata before display.
- Active members can view. UI allows create/save only with a server-confirmed canWrite, while the API/RLS independently enforce active membership, role, user feasibility license, origin and revision. New corporate studies are saved immediately on POST; edits require explicit PATCH using the last confirmed revision; GET reload prompts when there are unsaved changes.
- Corporate creator user is provenance, NOT owner. Corporate owner principal is the selected institution and is immutable. Personal CREATE/GET/PATCH/DELETE remain personal-only and separate from the new company API.
- Company study editor reuses the existing calculation engine, fields and report tabs, without Financial Core V1 references.
- No corporate delete, ownership transfer, cross-tenant invitation or automated email is active. Cross-institution sharing and fine-grained editor permissions remain #411.

## Inactive access gates (must not change automatically)
- QA V2 database migration `feasibility_institutional_ownership_qa_v2_20261115` applied once, with private database rollout switch OFF.
- Vercel server-only `FEASIBILITY_ORG_QA` is not configured; the institutional API returns 404. No direct PostgREST bypass because database switch is independently OFF.
- Production Feasibility and billing activation remain disabled.

## Acceptance required BEFORE enabling the QA switch
1. Exact-head TypeScript, unit/API and Next build pass.
2. Browser sign-in as company OWNER and separate VIEWER against real QA V2. Owner can create, edit, save and reopen a company study. Viewer can read, but cannot create or modify it via UI or direct API.
3. Switch PERSONAL ↔ ORGANIZATION repeatedly; original browser-local dairy draft stays intact, company records never enter personal storage or exports.
4. Switch between two unrelated organizations; a company study never appears in the other, and late network replies must not overwrite a newly selected tenant's portfolio.
5. Refresh/restore/JSON validation, version conflict 409 and cross-origin/malformed payload enforcement.
6. Current RLS transaction regression verifies default OFF, org-owner, licensed foreign user, VIEWER read but write denied, ADMIN write allowed, SUSPENDED denied and immutable ownership. Run again after future changes.
7. If enabling for QA only, authorize both independent switches explicitly, verify real browser results, then turn them OFF until signoff. Record deployment SHA and no residual synthetic data.

## Release rule
Passing automated tests or seeing a READY preview does **not** imply an approved production feature. Keep PR #418 Draft, do not merge main or update production Supabase. Cross-organization invitation/role flow and subscriptions are separate gates under #411/#416.
