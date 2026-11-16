# Personal loan, financing and participation contracts

Personal scope uses owner-controlled drafts and explicit execution, without organizational approval chains. All amounts for new writes are in the profile base currency. Changing that currency blocks subsequent contract writes until the original ledger currency is reviewed; reports retain the contract currency.

## Products and execution

- QARD: granted/received principal, editable saved schedule, monthly/quarterly/semiannual/annual generation. Settlements distribute oldest first.
- FINANCING: the same principal ledger plus the shared contractual financing engine. Expected costs never become liabilities automatically. Each ended period is recognized separately, then collected/paid independently. Early principal repayment is refused when it exceeds matured installments; amendments are a future workflow.
- PARTICIPATION: outgoing investment asset or incoming investor capital liability. Declared actual project profit is multiplied by the contractual share. Recognized profit, cash distributions, capital returns and noncash capital losses remain separate. A full capital loss is reversible.

NEW executes one funding movement. OPENING creates no bank movement. LINKED binds an existing unallocated loan debt at its current remaining balance; it does not replay earlier funding/payments or overwrite explicit category assignments. Linking participation assets is intentionally unavailable because legacy valuations require separate reconciliation. Old loan funding records remain under Previous transfers; linked records move under their controlling contract.

## Sources and reports

`personal_contracts` stores terms and control state, not balances. `personal_contract_movements` stores audit/source IDs. Canonical balances remain asset lots and personal payables/payments. Stable, owner-scoped installment snapshots project loan/incoming capital balances into AR/AP, aging, follow-up, the overview and dashboard. Movement statements retain their original amounts; separate installment allocations drive collection performance. Incoming participation losses appear as dated adjustments instead of retroactively reducing the original capital receipt.

Outgoing capital is an investment asset once in the financial position. Its future returns are labeled estimates in the dashboard. Recognized profits/costs are separate actual debts. No contract amount is added again to AR/AP or asset totals. Contract detail provides schedule and movement PDF/CSV exports; personal investment portfolio includes outgoing participation contracts.

## Integrity

Only `personal_contract_command` can write contract-controlled source records. The public wrapper is invoker, the checked writer lives in `private`, and all tables use owner RLS with authenticated SELECT only. Commands serialize per owner, validate canonical remaining balances, reject request conflicts and cross-owner sources, and optimistically check draft revisions. Transaction/asset/lot/payable guards reject generic bypasses. The transient EXECUTING state is transaction-local through an uncommitted row update and cannot be acquired by browser/table grants. Reversals run latest first, use today's ledger date and refuse consumed source lots. Cancellation preserves draft history.

## Verification

- TypeScript plus the complete unit suite, including shared register/statement projection and hosted-origin checks.
- `tests/sql/personal-contracts-rollback.sql`: all 12 product/direction/new-or-opening combinations, settlement and replay, cost/profit recognition and settlement, full loss and reversal, funding reversal and cash reconciliation.
- `tests/sql/personal-contracts-security-rollback.sql`: both linked directions, prior payment preservation, revision conflict, installment follow-up and overpromise, generic write bypass, owner RLS/definer isolation, future cost and early financing rejection.
- SQL fixtures use disposable synthetic users and roll back completely. No customer vouchers are posted for testing. Production migration versions in this repository match the applied history. ZATCA QA branches/databases are untouched.
- `/design-review/personal-contracts` is available only in preview/development, uses synthetic data, and disables financial execution/save. Production returns 404.
