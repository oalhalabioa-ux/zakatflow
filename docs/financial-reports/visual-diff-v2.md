# Visual review V2 — nine screens

Owner direction overrides the illustrated sidebar: all screens reuse the current finance-platform CorporateShell, official Arabic logo, existing menu colors, spacings, icons, collapse state and mobile behavior. The sidebar therefore intentionally differs from the English reference shell. All remaining reference areas were reconstructed in HTML/CSS/React, not used as a screenshot background.

Each screen has an actual Next.js screenshot at 1672×941 (viewport), a full-page desktop image and mobile images. Also checked: 1440×900, 390×844, 375×812, Arabic and English. Desktop comparisons retain the reference at its native size; mobile comparisons clearly state that no separate mobile reference was supplied.

| Reference | Screen | Implemented regions | Specific differences / corrections |
| --- | --- | --- | --- |
| 01 | overview | Five KPIs, performance chart, budget donut, recent reports, six shortcuts | Approved content; replaced preview sidebar with actual platform sidebar. Demo scope now follows the shared selector. |
| 07 | statements | Four KPIs, presentation filters, three primary statement cards, equity/notes cards, recent reports, export tiles | Illustrative document icons are vector reconstructions. Equity/notes screens and PPTX remain explicitly unavailable, not invented. |
| 08 | income | Comparative collapsible statement table, subtotal/total bands, four side indicators | Finance costs are explicitly shown so operating profit, tax and net profit reconcile. Some original image arithmetic and ratios were corrected. |
| 09 | position | Four KPIs, compact comparative balance sheet, composition donut, funding bar, insights | Corrected detailed totals and linked cash to the same cash-flow closing balance. Dense rows and subtle typography differ. Full-page capture can extend below the nominal viewport. |
| 02 | cash-flow | Four cash indicators, three activity groups, subtotals, opening/closing reconciliation, monthly trend, insights | Opening/closing values corrected to agree with financial position. Monthly chart reconciles to selected-quarter cash movement; negative months render below zero. |
| 03 | kpis | Eight distinct indicators, target donut/bars, revenue/growth chart, burn/runway gauges, cash chart, EBITDA bridge, benchmark table, six links | Removed the generated reference's duplicate turnover concept by showing EBITDA margin. Current ratio uses the corrected balance-sheet values. No claim that synthetic benchmarks are operational targets. |
| 04 | budget-monitoring | Five KPIs, monthly budget/actual, variance waterfall, utilization donut, category table, insights, recent budgets, five links | Expense category totals and monthly series reconcile to 1200.0 budget / 1046.8 actual. Revenue is not added to expenditure. |
| 05 | budget-entry | Version/scenario controls, monthly input/formula grid, summary, assumptions, notes, detail panels | Corrected operating profit (134.5) rather than reproducing inconsistent image arithmetic. Missing real target/actual comparisons are marked unavailable. Local inputs and exports work; approval/publishing disabled. |
| 06 | analysis | Six analysis tabs, five KPIs, actual/budget chart, sector donut, report list, insights, sector ranking | Sector revenue/expense/profit/margins reconcile; original generated-sector arithmetic was corrected. Tabs change metric/sector chart presentation. |

Screenshot-driven corrections: localize global table/input overrides; restore row density and subtotal colors; reduce chart height; render negative chart values; reserve mobile legend space; enforce English digits/LTR signs; keep table scrolling inside the card with sticky item column; preserve body width at all tested sizes; make export files match filters and edited budget scenarios.

Remaining visual differences: Cairo glyph widths/weights, vector icon shapes, generated-reference gold gradients/shadows, tooltip positions and some panel geometry. Mobile uses the approved responsive rules because no independent mobile image exists. Screens intentionally scroll vertically when all content cannot fit; do not crop a full-page screenshot to claim an exact-height match.

Status: first-page content approved; full nine-screen visual review pending. No real financial data integration or final merge/deployment approval is implied.
