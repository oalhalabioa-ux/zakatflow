# Yaqeen Business — Personal financial reports (Draft PR #360)

**Status:** Implemented initial **read-only personal register reporting**, not statutory statements or a separate posting engine. No schema migration, historical edit, opening reapproval, new user setup wizard, or Production deployment.

## Personal user experience

- The established global **شخصي / مؤسسي** selector keeps the user on `/financial-reports` and chooses an independent data source.
- `scope=PERSONAL`: no organization picker, subsidiary switch, branch or cost center. The report reads the signed-in user's personal `asset_accounts`, cash transactions, personal receivables/payables and contracts through the existing `financialRegister('PERSONAL', null, false)` service. Its existing owner-ID filters and database RLS remain in force. The new endpoint refuses arbitrary organization/group/scope parameters.
- `scope=ORGANIZATION`: unchanged institutional live source and existing organization/group filters; approval and permissions still apply. Neither scope may reuse the other's balances, journals or opening data.
- A small personal category chart is derived **only in memory** from existing recognized balances. It is not a second persisted chart or a one-sided/uncertified posting scheme. Personal accounts do not need the nine-step company setup wizard. Reporting parent numbers are reused where definitions match; unclassified valuables remain `P-OTHER`, not incorrectly forced into corporate PPE.
- The estimated position, per-account cash movement and personal classification can be exported to **CSV, XLSX or browser print/PDF**. Export re-reads the authenticated personal source, enforces the same scope/period and clearly identifies the result as **estimate, not audited**; pending personal income/expense statements cannot be exported as fictitious amounts. CSV uses spreadsheet-formula-safe escaping for source account names. The global sidebar and topbar remain untouched.

## Accounting boundaries

1. **Personal financial position:** current cash, receivables, personally held assets/investments, liabilities and net worth, **per currency**. Values are register/market-based estimates and not an audited balance sheet. All-zero new users have an empty-state, not fictitious opening capital. No group/subsidiary financial books flow into this report.
2. **Unreconciled legacy/unallocated balances:** withhold net-worth totals and show a reconciliation warning; never invent an offsetting entry.
3. **Cash account movement:** cash beginning, inflows, outflows, net and closing per account for the user-selected period, using existing actual movements and ignoring opening entries as period inflows. Two-sided transfers with matching persisted `transactions.transfer_id`, date, currency, opposite amounts, separate cash accounts and no reversal are now independently reconciled as verified internal cash movements. Unmatched movements remain unclassified; gross source rows are preserved. This is deliberately **not** an IAS 7 operating cash-flow statement.
4. **Income and expenses:** remain **not available** until the user-facing source records reliably distinguish earned income and personal expense from loans, investment capital, asset disposals, refunds and transfers. A bank deposit is not, by itself, revenue.
5. **Historical financial position:** current holdings are valued at the latest register date. Historical net-worth snapshots require a complete dated valuation and liability source; selecting a cash-movement period does not change today's net-worth valuation date.
6. **Private-company ownership:** show the person's ownership as a personal investment only when properly recognized and valued, not by duplicating the controlled company's underlying cash, assets or debts in the owner's personal report.

## Technical boundaries and next gates

- `lib/personal-financial-reports.ts`: deterministic, read-only mapping with strict `PERSONAL` scope checks and no mutation.
- `app/api/financial-reporting/personal/route.ts`: authenticated, no-store, strict dates, personal-only source, sanitized errors.
- `components/financial-reports/PersonalFinancialStatements.tsx`: responsive bilingual cards and cash account register using approved navy/gold styling, no global sidebar/topbar style changes.
- `lib/personal-financial-export.ts`: single-source bilingual export rows, separate currency positions, unreconciled-value suppression, no inferred income or FX totals.
- Next integration: an auditable categorized personal cash/income/expense event source, optional advanced account mapping without mandatory setup, effective-dated valuations, fully reconciled transfers and precision-safe base-currency translation if a user opts into consolidated currency reporting.
- A read-only **Financial Core QA** schema inspection on 2026-11-06 confirmed existing `personal_payables`, `personal_payable_payments`, `personal_financings`, `personal_debt_links` and `personal_debt_parties`, but **no dedicated personal income/expense classification table**. This is a data-contract/persistence gap, not a rendering bug: issuing a personal P&L without a classified recognized source would fabricate revenue or expense. New durable classification/recognition tables, RLS, migration, owner-facing editing and source-reconciliation acceptance must be designed and tested in an isolated DB before enabling that statement.
- Live QA with isolated users, private tenant boundaries, multi-currency, reversals, personal contracts and saved personal opening balances is required before merge/Production. Do not claim official audited statements from the current read-only reporting estimates.
