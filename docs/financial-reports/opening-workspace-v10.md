# V10 — opening-balance workspace design preview

Owner requested a single opening page with tabular customer, supplier, cash/bank, asset/depreciation, loan, employee-advance, investment/other and equity views, plus one trial balance. Customer/supplier tabs include master records with and without opening vouchers. Existing source balances remain visible; a supplement is a delta, never a second copy of the full opening. Missing differs from explicitly confirmed zero.

Route: `/design-preview/financial-reports/opening-balances?lang=ar|en`. It uses the current CorporateShell and approved navy/gold styling. Same design-preview flag and Production 404 gate as the original nine pages. It does not change those nine pages or any live master list, voucher, chart, balance or permission.

## Preview behavior

All names, account codes and vouchers are synthetic examples. Nine tabs; local delta/side entry; explicit confirm-zero; search/status filters; source-detail dialog; current source, supplement and final columns; one decimal-precision account aggregation; visible incomplete count and trial-balance difference. Existing master records with balances can remain visible even when inactive. Reverse-side entries and changes to voucher-backed rows are flagged for review. The draft clears on organization change or reload; there is no localStorage or backend balance persistence.

Excel contains the selected filtered detail and a separate full-scope trial-balance sheet with incomplete count. Missing balances export blank, not zero. CSV uses existing formula-injection escaping. Source and financial amounts remain exact decimal strings. Save and approval remain disabled, even if the sample trial balance is made arithmetically balanced. Tabs support arrow keys/Home/End; the phone view preserves table information in labeled row cards. Native sidebar, drawer and focus behavior are reused.

## Reconciliation contract — no posting

`lib/financial-statement-opening.ts` prepares an explicit candidate from an all-organization/base-currency source snapshot and a complete target. It rejects wrong scope/cutoff, partial source counts, conflicting aliases, the same physical row under inconsistent canonical keys, duplicate target rows and unknown/missing account mappings. Aliases deduplicate only by an explicit trusted canonical line key, retaining all source references. Target minus voucher balance is the supplemental delta; the final target is emitted once. Reductions are marked for correction review. The shared statement engine verifies dates, exact balance and closed opening income. Every outcome has `postingAllowed=false` and supplies no authorization.

A live adapter must establish actual canonical voucher identity and book value at the opening cutoff, including verified roll-forward when original opening vouchers predate that cutoff. Current market/zakat values are not a substitute. A cash/debt register or isolated asset voucher is not automatically a complete balanced GL opening. Unmapped sources must stay visible and block approval; no equity/suspense plug may hide a discrepancy. Loading a final opening must exclude its already-included canonical sources from journal recognition. Approvals must validate source revision and recheck effective permissions under the genuine caller, atomically. Browser declarations and this pure validator are not proof of those facts.

The page is not connected to live customer/supplier masters or current source vouchers yet. That adapter and write/review workflow follow visual approval and schema/mapping review, with isolated real-auth/RLS acceptance before any hosted rollout. No schema migration, Production change, merge or deployment is authorized.

## Verification

The existing disposable source workflow runs the nine-screen regressions plus opening preview checks at 1672, 1440, 390 and 375 pixels in both languages, all opening tab captures, exact edited XLSX, Arabic summary PDF, source dialog, keyboard tabs, explicit-zero/invalid precision, organization draft clearing and disabled live actions. A separate offline replay uses the same React component and asserts edits/summary/language/mobile behavior without network requests. Pure tests exercise reconciliation, duplicate sources, missing/zero distinction, mapping/coverage, corrections, scope and exact large-value exports.
