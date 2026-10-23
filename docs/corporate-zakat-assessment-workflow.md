# Corporate Zakat assessments

New assessments in the SIMPLE and SAUDI models can capture a dated, immutable source snapshot. The editor fills only empty fields automatically; explicit refresh presents a comparison and requires choosing whether to fill empty fields or replace available source values. Unsupported balances stay blank, and all treatment requires review.

The immutable `manual_zakat_assessments` row remains the input snapshot. `corporate_zakat_finalizations` links it to a single Financial Core expense, explicit payable obligation and expected tax flow. Approval uses the existing company policy and separation of duties. Posting recognition does not touch cash; partial and full payments use the existing payable settlement path. Current paid/remaining values come from obligation balances, not event-line totals. Zero liabilities require approval without creating synthetic money movements.

An organization advisory lock and overlapping-period check prevent both models from recognizing the same period twice. Draft cancellation retains the assessment/event history and removes the pending cash forecast. Posted records require the existing financial correction/reversal review rather than editing the frozen input. Opening a copy never overwrites the previous assessment.

Source evidence includes cash book balances, explicit receivable/payable obligations, recorded asset values, dedicated investment balances and appropriately classified financial lines. Fixed assets/investments are candidates, not automatic regulatory deductions. Recorded equity lines may not be a complete equity balance. Adjusted profit and regulatory base/rate are reviewer inputs. Foreign currency balances without a dated valuation and asset histories with later movements require manual review; current values are never silently substituted for unsupported historical values.

## Release gate

Run `tests/qa-corporate-zakat-workflow.sql` against **Financial Core QA only** after applying the migration. It rolls back fixtures and cash movements and verifies source mapping, permissions, duplicate/overlap guards, approval-before-posting, a single liability, partial/full cash settlement, replay and no duplicate expense.

At preparation time, the Supabase migration tool returned `Invalid or expired requestState`. No database changes were applied, and the SQL integration script has not run. Keep the PR as draft and do not merge/deploy until the database migration, integration test and advisors pass. Application typecheck/unit tests/build are separate checks and do not substitute for this release gate.
