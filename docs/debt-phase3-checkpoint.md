# Debt phase 3 — collections and employee payroll offsets

Entry: `/ar/debt-collection?scope=ORGANIZATION` (or `PERSONAL`). Available from debt navigation and the sidebar. Shared topbar selects company and company/subsidiaries. Payroll offsets deliberately require one selected company.

## Delivered

- Filtered worklist, owner assignment, append-only follow-up history, next contact and dated/valued payment promises.
- Aging by counterparty, direction, company and currency; undated debts remain explicit.
- Monthly due-date list for actual outstanding obligations. Existing obligation-linked due dates/forecasts are reused.
- Per-currency outstanding, overdue and next-seven-day indicators, period settlements and on-time settlement percentage where evidence supports it. Reversed personal settlements suppress the percentage rather than infer their original timing.
- PDF/CSV exports use current filters; promises never change principal, due dates or cash.
- Source-managed noncash payroll deductions join an employee-advance installment to a posted employee payable of the same company, counterparty, entity, currency and recorded FX rate. Both balances and existing forecasts reduce once; no salary expense, revenue, VAT or bank movement is created.
- Independent approval policy, amount permissions, request replay, duplicate payroll reference protection, serialization with cash settlement and revalidation at execution. Cancellation and approved reversal are available.

## Verification

TypeScript and 473 tests across 102 files pass. New unit/service/route coverage includes aging boundaries, separate currencies/directions, target ownership, over-promises, dates, CSRF, permissions, posted settlement reporting and noncash payroll schema.

QA rollback suites passed for loan funding/partial repayment/reversal, advances, personal financing, rescheduling, new follow-ups and payroll deductions/reversal. Payroll tests include two competing approved requests: execution of the later request is blocked after the first consumes the balance. Tests leave no follow-up or payroll request rows.

New public RPC wrappers are SECURITY INVOKER; authenticated writers are isolated in private functions with auth and permission checks. New tables expose SELECT only under RLS; anonymous execution is revoked. Supabase advisors report no new findings for phase 3. Existing unrelated advisor findings remain outside this change ([advisor guidance](https://supabase.com/docs/guides/database/database-linter)).

No authenticated browser test was performed: no browser executable is installed. Deployment checks verify builds, public routes and static assets; SQL tests exercise the financial operations under the authenticated QA role.

## Intentional boundaries

No automatic payroll-system integration, salary expense recognition, external reminders or messages. The existing employee-advance schedule provides monthly installment amounts/dates; each actual payroll offset is explicitly recorded against an already posted employee payable. Requests show the latest 200 operations. Current balances are not historical balance reconstructions.
