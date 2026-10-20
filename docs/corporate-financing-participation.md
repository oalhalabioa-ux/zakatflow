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


## Corporate contract refinements

- Qard is managed inside receivables/payables, by direction. The old qard URL redirects to payables; draft approval, installments and settlement remain available inside each debt page. Personal workflows are unchanged.
- Investments includes outward variable-profit investment contracts. Direction is explicit and immutable. Incoming capital stays in Financing & participation; no contract appears in both workspaces.
- Outward funding posts approved CAPEX/ASSET_PURCHASE recognition and an atomic bank outflow, without a fixed receivable on capital. Actual profit creates a receivable; actual loss reduces carrying capital. Declared capital return reduces investment carrying value and creates a receivable, so financial position does not count both. Collection settles that receivable without recognizing income again.
- Empty unapproved drafts can be edited or deleted. Editing replaces the old draft in one transaction and preserves audit history. Deletion removes it from workspaces but retains the immutable financial trail. Approved/posted documents and participation drafts with non-cancelled movements are blocked.
- Legacy navigation is removed; existing unrelated records are never bulk-deleted or inferred to have financing terms.
- QA scenarios: external funding 1,000 from a 2,000 bank balance; 60 actual profit, 100 loss, 900 capital return; collection 960 yields bank 1,960 and zero outstanding capital/claims. Draft edit/delete, repeat deletion, null action guard, approved deletion guard and qard installment preservation are rollback-tested. Incoming participation and structured financing regressions pass.
