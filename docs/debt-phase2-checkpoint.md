# Debt and financing phase 2

Authorized scope: personal new loans and advances; refunds and source-managed reversals; loan rescheduling. Follow phase 1 debt workspace navigation and theme design. Phase 3 (aging/collection/payroll deduction) and phase 4 (advanced terms/FX/payroll integration) remain separate.

Baseline production main 1efbaf999355d42463649ab1944fb9fffa5031ac (PR197).
QA database wtzgzmcgcqouziqzsfnl, production ejpzcsfwqziqxwhvqnay.
No production financial fixtures. Implement and prove with transactional rollback tests on QA before release. Existing financial register and cash writers are the sources of truth; no duplicate principal or income/expense/VAT.

Review in progress: personal payable engine supports opening/PAY/reverse payment; personal receivable opening and collection exist. New funding must atomically create debt and cash once. Institutional debt contracts have immutable principal obligations and forecast flows. Rescheduling must preserve settled history and amounts and update all due-date consumers. Advance requests support RECORD/APPLY with approval; source-managed refund/reversal not yet exposed.

## Implemented / QA verified
- Institutional source requests: approved date rescheduling of unpaid/part-paid installments, advance refunds, reversal of posted ordinary repayments / advances / noncash applications / refunds. Submitted inputs immutable; bank and obligation rechecked under the existing org cash lock; replay-safe. No principal redistribution or financing fees added.
- Personal loans and advances: lending/borrowing/paid/received funding atomically updates the bank and the existing receivable/payable ledger once; base currency only. Personal paid advances preserve source lot Hawl lineage. Source reversal before consumption/settlements is atomic and prevents generic partial reversal/cancellation.
- Personal advances classified separately in register/statement totals without duplicating ordinary debt. Existing repayment/collection paths retained. Personal scope added to loans and advances routes using client scope events.
- Interfaces: theme-aware forms, icons, details/actions, filtered metrics; conditional module loading; request preparation separated from approval and execution notes. Institutional rescheduling changes dates, retains amounts and settled history.
- QA rollback SQL passed: debt-phase2-reschedule-qa.sql, debt-phase2-advances-qa.sql, personal-financing-phase2-qa.sql. Rescheduling tested after partial payment plus stale request/approval/replay guards. Both advance sides refund/reversal and noncash reversal tested. Four personal funding cases and source reversal tested.
- TypeScript and 450 unit/service/route tests passed. Supabase advisors: no findings for new functions/tables; prior unrelated warnings retained. New public functions are invoker wrappers, anon revoked; private writers check caller and source. No production fixtures.

Pending release: final QA build, production migrations, merge and production READY verification. Do not claim authenticated browser testing.

Institutional contract source reversal (both lending/borrowing, funded/opening) also passed QA rollback: cash restored, principal removed from actual open items, future installment flows removed, funding cash history retained. Reversal is blocked when settlement history or pending linked payment requests exist.
