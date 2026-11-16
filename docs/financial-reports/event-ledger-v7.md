# V7 — explicit event-to-ledger compiler, not live statement integration

The existing positive-only event lines do not identify both sides of a journal. Cash/debt register openings do not establish a complete opening trial balance. This change prepares a **pure local compiler**, without database changes, API wiring, UI changes or deployment.

`lib/financial-event-ledger.ts` accepts normalized canonical events, a complete fiscal opening trial balance with source identity, scoped ledger accounts and explicitly approved posting rules. It produces balanced journal lines and passes those same journals to `projectFinancialStatements`. It stores no balances and adds no second source of financial numbers.

Approval metadata is a required input contract, **not proof of authorization**. A future server adapter must independently load approved, versioned policy under the genuine caller's RLS/effective permissions; assert complete coverage for the requested organization/entity/period; verify the opening source; and recheck permissions after reads. Do not accept these objects from a browser as an approved accounting policy.

## Required account decisions

The following are synthetic test roles, not proposed account codes or an approved customer chart of accounts.

| Canonical component | Explicit debit | Explicit credit | Source amount |
| --- | --- | --- | --- |
| Expense recognition | Operating expense | Payable | Net expense 100 |
| Recoverable VAT component | Recoverable VAT asset | Payable | VAT 15 |
| Gross supplier settlement | Payable | Bank, operating activity | Settlement 115 |
| Revenue recognition | Receivable | Revenue | Revenue 200 |
| Customer collection | Bank, operating activity | Receivable | Collection 200 |

Opening: bank debit 500 and equity credit 500. Known answers: profit 100; operating cash movement 85; closing cash 585; assets 600 = liabilities 0 + equity 600. Settlement never recognizes expense or revenue a second time. These are test fixtures, not real organization figures.

## Fail-closed behavior

- Every eligible event line needs exactly one effective-dated rule matching event type, producing module, classification and original cash direction. No inferred counter-account or fallback/suspense account.
- Scope mismatch, duplicate event/source-module key/line, missing approval/opening provenance, ambiguous rule, unknown account, invalid amount/date and incorrect cash direction are rejected.
- Four decimal amounts use decimal arithmetic. Negative recognition uses an explicit canonical sign and swaps the approved accounts; it never relies on floating point or a guessed sign.
- Draft/planned/committed and future events are excluded. A reversed original remains recognized before the linked reversal date. Full reversals must match the original accounts/amounts exactly and cannot be applied twice.
- Cash activity is explicit for transactions crossing the cash boundary. Internal cash transfers do not inflate cash flow. Opening balance, journal, financial position and cash reconciliation are checked by the shared engine.
- Source event/line/rule lineage, policy version identity and opening identity are returned with the projection.

## Remaining integration gates

No live formal statements, profit cards or real-account export have been enabled. Canonical event adapters, complete source coverage and authoritative approved account/opening mappings are still required. Entity, cost-center and multicurrency selection must be enforced by that future adapter; this compiler only handles one organization/base currency per call. Partial reversals, recoverability allocations and mixed-purpose tax classifications require explicit approved normalization/rules before use; the compiler does not infer them.

The source API and its genuine Auth/PostgREST acceptance tests from V6 are unchanged. New unit tests verify compiler accounting and scope contracts, **not database RLS or customer accounting acceptance**. No new screenshot is claimed: this stage changes no visible page or sidebar. Full visual acceptance remains governed by the existing reference comparisons.

Reproduce: `npx vitest run tests/financial-event-ledger.test.ts tests/financial-statement-engine.test.ts` and `npm run typecheck`.
