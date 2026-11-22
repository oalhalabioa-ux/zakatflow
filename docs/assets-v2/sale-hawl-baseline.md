# Personal sale proceeds and hawl continuity

## Reproduction

Main at `0f519d01b37e73accf46c3f6958df598960fca0d` has the standalone path. PR #488 at `d40045f4810c914ee9c7ee3ea8c5f937707816ec` contains both paths. The disposable test executes their SQL and the canonical hawl-period RPC against synthetic rows.

```sh
npm install --prefix /tmp/yaqeen-hawl-baseline --no-save --package-lock=false @electric-sql/pglite@0.5.17
NODE_PATH=/tmp/yaqeen-hawl-baseline/node_modules node tests/assets-v2/sale-hawl-baseline.cjs
```

| Measure | Standalone and grouped |
|---|---:|
| Gold consumed from the 2025-03-01 source | 10 g at SAR 300 cost |
| Gold consumed from the 2025-06-01 source | 2 g at SAR 400 cost |
| FIFO cost / single receipt / gain | SAR 3,800 / 6,000 / 2,200 |
| Remaining gold | 8 g at SAR 3,200 cost, June source |
| Receipt principal absent from the hawl candidates | SAR 6,000 |
| Corrected proceeds / gain at SAR 450 per gram | SAR 5,400 / 1,600 |
| Corrected cash after transfer to the residence | SAR 4,200 |
| Balances after paired reversal before spending | 20 g at SAR 7,000 cost, zero cash |

Both posting paths create a cash lot with null hawl dates and no continuity parent. The cash lot contributes to the initial portfolio valuation in `calculateAndSaveAssessment`, then disappears from the candidate rows and the qualification value sent to the engine. On the fixture assessment date of 2026-04-01, the March source has reached its first Gregorian anniversary and the June source has yet to reach its own. Assigning all SAR 6,000 to either date would therefore produce the wrong eligible balance.

The fixture proves the final-assessment and spent-receipt preflight guards, the paired reversal balances, and owner-scoped period reads. It uses selected repository DDL in local PostgreSQL via PGlite. It does not run the full save/finalization pipeline or use hosted QA.

## Repair contract

- Preserve the single posted receipt and the single cash lot consumed by the existing financial FIFO. Record one durable source component per saved sale allocation. The stable inputs are the sale allocation and source lot IDs, the source hawl lineage, and the sold quantities. Allocate the SAR 6,000 as SAR 5,000 and SAR 1,000 by sold quantity at the common price. Reconcile currency and base totals exactly at stored precision.
- Resolve both the inception and finalized coverage of each component through its source ancestry. The existing conversion settings are `zakatable_conversion_continuity` and `non_zakatable_conversion_exits_pool`. Both are defined on `user_settings`. The two posting paths do not read those settings. Verify the policy-off and unknown-ancestor cases explicitly before reporting a date.
- Use the original financial allocation rows as the expenditure evidence. Define and test a deterministic component order inside the receipt, including residuals, reversals and transfers. A transfer's date or the receipt's UUID alone cannot establish how much of each component survives. A purchase qualifies by its recorded account classification and purpose. A residence removes only the cash expended. Trade property and rental receipts need separate fixtures.
- Persist assessment coverage per component with a stable key. The current save function rejects duplicate lot IDs and validates a line against the whole cash lot quantity. Final coverage and payment allocation also consume stored assessment lines. Update those interfaces together before exposing a component to assessment. Leave the existing valuation, rates, threshold and saved snapshots in place.
- Price-only correction reconciles the same component keys to the corrected receipt in the same transaction. Structural replacement and paired reversal retire the old components while retaining audit links. Existing guards for later allocations and final snapshots apply before a change. New writes only, with legacy proceeds reported as unresolved until separately approved.
