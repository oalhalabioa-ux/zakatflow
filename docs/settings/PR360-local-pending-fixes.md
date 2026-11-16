# Pending local settings fixes — 2026-11-09

User instruction: do not push or deploy until an explicit preview-upload request.
Use one stable QA alias on the next authorized deployment. No alias changed yet.

## Cash and banks
The register stylesheet now loads with FinancialRegisterWorkspace rather than
relying on first visiting the standalone register route. Local direct-entry
AR/EN desktop/mobile checks passed, with bounded heading icons and no page overflow.

## Fiscal setup lock
Setup-only posting policies no longer prevent calendar/retained-account changes.
The server supplies the configuration lock reason; older servers retain the
conservative UI lock until the additive migration is applied.
Changing dates supersedes active policy versions and creates unapproved drafts
for the new dates. Existing drafts take precedence over older approved rules.
Original records and full before-images remain auditable. Retained-only edits
preserve policy identities and approvals. No automatic approval or year close.

Actual/reversed canonical events and legacy reporting activity prevent editing.
Existing opening workspaces/source assignments, linked budgets and closure
history remain protected review dependencies, including opening/budget drafts;
this change does not silently relocate their amounts or dates.

Migration 20261109090210 is prepared locally only. No hosted schema/data changes,
GitHub pushes, CI runs or Vercel deployments were made for this batch.

## Validation
Passed: local PostgreSQL/WASM procedure execution (isolated minimal schema),
setup edits, retained-only preservation, January/July rebasing, draft/history
preservation, activity/opening/budget refusal, atomic rejection, stale revision,
invalid retained account, foreign tenant and private helper privileges.
Passed: 11 targeted unit/service tests, TypeScript and canonical file digests.
Passed: local mocked-API AR/EN browser save/reload, editable fields and activity
lock separated from OPEN year state, at desktop/mobile sizes.

Added an actual Auth/API/browser regression to the full-schema acceptance script.
That full-schema regression has not run in this local batch; run it before the
next authorized preview release. No hosted signed-in fiscal UAT is claimed.

## Detailed posting rules
The settings table has search and status/module filters, a side editor, and a
debit/credit preview. Fixed legs require an active posting leaf for detailed
approval. Receipt and payment cash legs use the voucher's linked bank or
cashbox. The balance sheet groups the resolved bank amounts under 1000.

The migration records resolved legs for canonical postings under an approved
detailed policy. It snapshots earlier covered postings before switching a
policy and uses the same stored legs for statements and the closing trial.
The old approval mode remains available for legacy API consumers until a
detailed policy is activated. Two-cash-leg transfer routing is separate.
The native full-schema acceptance scenario now exercises two different banks.
It is prepared locally and has not run in hosted QA. Local PostgreSQL/WASM
verified the new migration against the exact patched baseline function
definitions with isolated source fixtures. Local browser fixture checks passed
in Arabic and English at desktop and mobile widths.
