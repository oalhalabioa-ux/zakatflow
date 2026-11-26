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

## Work 03 — source reconciliation for #397 and #398

| Component | Persisted source | Effective date | Currency | Reconciliation and coverage |
| --- | --- | --- | --- | --- |
| Cash and bank balances | Personal `asset_accounts`, linked `transactions` including opening entries and id-linked reversals | Transaction date, including reversal on its own date | Stored movement base currency | Posted movement sums tie to each account before cutoff aggregation. Mismatches withhold the currency's cash amount. |
| Receivables and loan principal | Personal receivable asset, dated movements, finance contracts and saved installment rows | Opening/funding, collection or dated reversal | Stored receivable/contract currency | Reconcile each source receivable to its current balance, including split installment rows. Principal stays outside income. |
| Payables and loan principal | `personal_payables`, `personal_payable_payments`, linked cash reversal, dated contract movements and schedules | Recorded obligation, payment, adjustment or reversal date | Stored payable/contract currency | Reconcile each source liability. An opening-value/date edit or a cancellation after cutoff can withhold historical liabilities in the affected currency until dated evidence is available. |
| Advances paid and received | `personal_financings` with recorded `ADVANCE` classification, related receivable/payable movements | Dated funding/settlement and linked reversal | Stored movement currency | Reconcile each source separately from ordinary receivables and liabilities. Do not treat principal as earned income. |
| Nonmonetary assets | Asset statement journal and lots/allocations, matched to saved valuation metadata | Exact cutoff date of both the statement and the quote | Base currency recorded on the statement | Partial asset-by-asset coverage. Requires an owned, reconciled asset and a same-day stored unit valuation in the statement currency. Newer quotes and later reversals do not change an earlier result. |
| Investment income and principal | Posted `investment_operations`, linked personal cash transaction | Posted operation date | Expense/receipt in the document currency, cash activity at recorded base value | Interest or other investment income received is reported separately. Funding and redemption go to investing cash activity. Unmatched contracts or movements stay unresolved. |
| Contract finance and participation | `personal_contract_movements`, linked receivable opening or payable obligation | Charge/profit date and its persisted reversal date | Contract currency | Match document identity, date and amount. Reversal appears only in its own period. |
| General income and expenses | Owner-scoped, persisted classification on the source document required from the accounting stream | Pending source contract | Pending source amount and currency fields | Open in #397. Untagged deposits, withdrawals, transfers, capital and loans do not establish income or expense. |
| Internal transfers | Two distinct personal cash account movements with the same `transfer_id` | Matching transaction date | Matching stored movement currency | Eliminated only from classified external activity when both recorded sides match. The cash statement still lists the original movements. |
| Asset purchase funding | Linked purchase, FIFO withdrawal and reversal from released #531 | Purchase/withdrawal date and recorded reversal date | Payment in account currency, cost and FX in stored base currency | One cash movement at carrying value, one funding detail in the report and export. FX is shown separately from net cash flow. |
| Historical net worth | All of the dated evidence above plus complete holdings and liabilities | Selected cutoff | By reconciled currency | Open in #398. An asset valuation subset and monetary totals cannot certify full historical net worth. |

### Work 02 source contract integration

The isolated integration branch also reads the draft V2 source contract from #535.
The source classifications supplement the existing personal register and never
replace purchase funding, transfer matching or the other dated movements.

| Component | V2 record | Effective date | Currency | Isolated reconciliation |
| --- | --- | --- | --- | --- |
| General income and expenses | `personal_income_expense_documents` and its exact owner transaction; `read_personal_income_expense` supplies both identifiers | Original entry date or the reversal's own date | Transaction currency and stored base amount/currency | One classified 25 SAR receipt matched the register and appeared once in both export languages. The unclassified 28 SAR remained a cash receipt outside income. The SQL fixture preserved March when reversing the 25 SAR receipt later. |
| Basic receivables | Owned receivables and posted register movements through `read_personal_debts_at_cutoff` | Dated opening, movement or reversal up to the cutoff | Stored receivable base currency | 80 SAR at 31 March. Export identifies the native source and record ID separately. |
| Basic payables | `personal_payables`, dated payments and their source transactions | Dated obligation, payment or reversal up to the cutoff | Stored payable currency | 70 SAR at 31 March and 50 SAR after the 1 April payment in the native source. The earlier amount was retained in the report evidence. |
| Assets and specialized contracts | Owner assets, statement journal, saved dated valuations, specialized contracts and investments | Statement cutoff and demonstrably effective valuation or contract record | Saved statement or contract currency | Asset valuation remains partial. Native basic debt coverage does not certify all investments, specialized contracts or historical changes to the original opening. Historical net worth remains incomplete. |

Verification used the #535 synthetic ledger fixture over 309 canonical migrations in
a disposable database, and passed the resulting ledger, document and debt snapshots
to the existing report compilers. The scenario also used a registered two-company
group with SAR functional currency. On 31 March the company's USD loan revaluation
added 15 SAR to its debt and the group worksheet profit. After the exact 1 April
reversal the result was zero, while group cash was unchanged. This proves a
non-cash foreign-denominated item on a same-functional-currency worksheet.
Translation of a foreign-functional-currency member and exact hosted browser
acceptance remain pending.
