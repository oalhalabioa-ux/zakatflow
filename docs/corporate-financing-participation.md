# Corporate financing and participation

Corporate scope only. Personal financing keeps its existing workflow.

- Interest-free loans under Debts: principal-only vouchers and installment settlements.
- Loans and financing: annual nominal rate; declining outstanding principal or flat original principal; equal principal or declining level payments; actual days over contractual 354/360/365 denominator, independent from Zakat.
- Investor participation: incoming variable-return capital. Explicit accounting treatment, actual profit/loss shares, independent capital receipt/return and investor statement. Distinct from outward investments and permanent share capital.
- Previous records: existing unstructured loans retained without inferred rates or automatic reclassification.

Saving and approval do not move money. Principal posting moves cash once. Future financing charges remain cash forecasts until a completed period is accrued and approved. One saved bank settlement can allocate principal and accrued charge together.

Participation contract creation has no financial effect. Receipt needs recognition and cash approval and posts atomically. Actual profit and capital return declarations create payable claims after posting; payment uses the existing settlement flow. Loss reduces managed investor capital without cash movement. No estimated profits or guaranteed returns become automatically payable. Currencies remain separate.

Controlled amendment/correction workflows for early financing payoff, rescheduling and posted participation corrections are not included. Direct operations are blocked to preserve approved terms and prevent incorrect recalculation. No automatic late penalties.

Validation: financing schedule and participation summary tests; QA SQL scenarios in tests/sql for funding, completed-period accrual, combined payment, capital receipt, actual results, loss, return, payout and closure. All SQL fixtures use BEGIN/ROLLBACK. No production financial test transactions.
