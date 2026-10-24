# Phase 2 source-freeze QA compatibility — 2026-10-24

Target: **ZakatFlow Financial Core QA**, project `wtzgzmcgcqouziqzsfnl`, PostgreSQL **17.11**. Production and the separate FATOORA QA project were not modified. This is transaction-only compatibility evidence, not a deployed Phase 2 feature or ZATCA acceptance.

## Inspected current schema

- Invoice, line and connection tables enable RLS. Invoice/line edit policies use actual `vat.edit` permission checks; connection reads require organization administration.
- `amend_zatca_draft_atomic` is INVOKER. `issue_vat_einvoice` is SECURITY DEFINER, with its own `vat.issue` check and existing registration/accounting guards. Both are executable by authenticated/service_role, not PUBLIC.
- Current connection shape is one connection/EGS per organization/environment. The candidate uses that connection's saved primary key as unit ID.
- Existing explicit app-role default privileges mean a PUBLIC-only revoke is insufficient. The candidate permission adapter removes explicit private-schema/table/function grants, including TRUNCATE, then exposes only an organization-authorized boolean lookup.

The narrow boolean definer is not a replacement for authorization: it requires a current session subject and `vat.edit`/`vat.issue`, returns no ledger row/credentials, has a fixed search path and schema-qualified references, and is volatile for current post-wait state. Reservation/finalization functions remain inaccessible to authenticated users. The owner-only finalizer now rechecks current subject, locked active admin membership, `vat.issue`, saved source and immutable connection-reference provenance before artifact/head/audit storage. A future backend write boundary must perform complete authorization again.

## Actual QA test

Loaded the ledger/source-freeze candidates and optional permission adapter within one transaction with 2-second lock timeout and 45-second statement timeout. **Never loaded the disposable `auth.uid()`/source-shaped harness into Supabase.** Used an existing QA owner UUID only as a SQL-session subject and created a new synthetic organization, registered VAT profile, non-operational connection placeholder, two invoices and their lines. No real key, account or cloud/authority request was used.

21 checks passed (the original 13 compatibility checks plus 8 finalization checks):

1. Authenticated owner can edit an unreserved header.
2. Authenticated owner can edit an unreserved line.
3. Existing amendment RPC works for an unreserved draft.
4. Private ledger read/write/TRUNCATE and reservation execution are not granted; anonymous lookup execution is denied.
5. Exact saved relational snapshot can be reserved through the private owner-only candidate.
6. Authenticated frozen-header edits fail.
7. Authenticated frozen-line edits fail.
8. Existing amendment RPC cannot change the frozen invoice.
9. Existing SECURITY DEFINER issuer cannot bypass the freeze.
10. Existing issuer still issues the unreserved synthetic invoice.
11. Outsider subject cannot see invoices/lines/connections under actual RLS.
12. Outsider cannot probe the private freeze lookup.
13. Only one reservation exists; no accounting document, financial event or liquidity flow was created for the synthetic organization.

Additional finalization checks:

14. Revoked membership prevents finalization; no audit is created.
15. Changed saved key reference prevents finalization.
16. A wrong snapshot digest fails without an audit.
17. Authorized private finalization saves PREPARED plus actor audit and leaves the header DRAFT.
18. Exact finalization retry preserves the artifact/time/audit and advances the counter only once.
19. Finalization audit cannot be rewritten.
20. Reservation connection-reference provenance cannot be rewritten.
21. Legacy issuance still cannot issue the frozen source after PREPARED.

These finalization cases use an explicitly synthetic non-UBL storage payload, not an authority-approved signature. Native XMLSec verifies actual synthetic signed artifacts through the same finalizer separately in the disposable integration suite. Connection-reference checks do not establish certificate trust or detect secret-content/version rotation at the same ARN.

The transaction ended with **ROLLBACK**. A separate catalog/data query then verified:

- Candidate `zatca_preparation` schema absent.
- Temporary source-freeze triggers absent.
- Synthetic compatibility organizations remaining: **0**.

The final volatile/NULL-fail-closed adapter was retested successfully. These SQL-role/subject checks exercise actual database policies and RPCs, **not** JWT signature verification, a browser session, real AWS signing or authority acceptance. The earlier native XMLSec/relational signing test is separate cryptographic preparation evidence.

## Reproduction

Use the confirmed QA project only. In one management-SQL transaction load, in order:

1. `tests/fixtures/zatca-phase2-ledger.sql`
2. `tests/fixtures/zatca-source-freeze.sql`
3. `tests/fixtures/zatca-source-freeze-permissions.sql`
4. `tests/sql/zatca-phase2-qa-compatibility.sql`
5. `ROLLBACK` (never COMMIT)

The script selects an existing active owner without storing any personal identifier in the repository. Every business row it creates is synthetic and rolled back. Check catalog/fixture cleanup after execution. Do not run the auth/source-shaped harness against Supabase. The CI role regression runner uses only a disposable database and a minimal permission stub; it is not configured with Supabase credentials.

## Remaining gates

No persistent migration, public reservation endpoint or production route was enabled. Authenticated backend transport for the private reservation/finalization primitives, fresh certificate/secret-version/key binding, custom-role delegation, browser/JWT E2E, linked accounting/settlement behavior, recovery and batch performance still need implementation/verification before permanent QA rollout and later production activation.

Baseline security/performance advisors were read before the transaction. They contain existing grouped findings; this work does not claim they are cleared or change unrelated public permissions. Relevant reference: [Supabase definer-function advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
