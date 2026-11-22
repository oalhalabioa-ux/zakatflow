# Personal gold sales release candidate

PR #488 combines the asset registration and valuation changes, personal gold lot sales, and independent personal-sale correction from #483 and #486. PR #487 provides hosted QA evidence. Coordinate with #489 through #426 and keep invitation changes in their own release. If either release lands first, preserve both sets of entries in `supabase/migration-history.json` and `tests/migration-history/bootstrap.mjs`, and rerun the affected checks against the new `main`.

## Functional scope

Personal gold in grams, priced in the owner's base currency. Preview and sell using FIFO or specific lots, correct price on the original sale, or reverse an eligible sale and its receipt together. A posted grouped sale retains its allocation method, lot IDs, quantities, sale date, currency and destination account. The independent personal-sale workflow can replace an eligible voucher and keep both the original and the replacement linked. Price-only correction preserves FIFO allocations and is subject to cash FIFO and final Zakat checks. The corporate lifecycle and depreciation workflow remains in force.

## Rehearsal and authorization

The default UI setting is off. Grouped posting and reversal are closed to authenticated clients at migration time. The shared transaction guards reject legacy unpaired reversal of a grouped sale or its receipt and reject grouped price changes while writes are disabled. Ordinary correction eligibility still applies to independent personal sale vouchers. Isolated workflows cover canonical migration history, registration locks, manual market prices, browser transactions, and the permission switch. Coordinate any hosted QA V2 rehearsal through #426 before changing the stable deployment or QA database.

## Production after independent owner authorization

1. Record the reviewed SHA, running deployment, migration history and manifest hashes. Verify a recoverable production backup covering both #480 migrations. The approved fallback is a current encrypted logical archive at an approved destination with a successful isolated restore. Record the backup identity, recovery evidence, and fingerprints for assets, lots, allocations, receipts, audit and final Zakat. Capture the live definitions and grants of functions replaced by the release for rollback comparison.
2. Apply the following canonical migrations once, checking the recorded version and hash after each one.

   | Version | Change | Verification before proceeding |
   | --- | --- | --- |
   | `20261121180000` | Asset edit details | Verify the registration lock and market valuation permission, including manual quotes. Compare financial baselines. |
   | `20261122010000` | Personal gold lot sales | Verify disabled-state grants and RLS with `tests/sql/personal-gold-release-disabled.sql`. Check the shared transaction guards and statement readers. |
   | `20261122040000` | Independent sale destination history | Verify the approved `correct_personal_asset_sale` and `personal_sale_preflight` definitions and grants. Check independent voucher correction, protected proceeds, and the institutional lifecycle against QA evidence. |

3. After merge and deployment approval, use the coordinated Git-linked `main` rollout with `NEXT_PUBLIC_PERSONAL_GOLD_SALES` omitted or `0`. Verify the deployed SHA, asset edits, statements, existing correction paths, ownership isolation and institutional operations. Keep grouped writes closed.
4. After independent activation approval, apply `supabase/release/personal-gold-sales/enable.sql` and build the reviewed application with `NEXT_PUBLIC_PERSONAL_GOLD_SALES=1`. Verify authorized visibility and read-back. Use synthetic accounts for financial write tests in QA.

## Rollback

- Stop the rollout if the migration history, function grants, financial baseline or existing operations differ from the expected result. Record the last successful version and resolve the discrepancy before proceeding.
- If the grouped write migration is installed, close its grants with `supabase/release/personal-gold-sales/disable.sql` and verify the disabled-state checks. Turn off the UI in the rollback build and reconcile in-flight requests. Preserve posted vouchers, allocations, receipts, audit, final Zakat and the grouped readers and guards needed by existing records.
- For a regression in the independent correction or asset edit database functions, compare the affected definitions and grants with the pre-release capture. Use a separately approved, rehearsed corrective migration to restore compatible definitions where needed. Both independent correction functions existed before the third migration and serve current clients.
- Before any grouped vouchers exist, the prior application deployment is a rollback candidate after confirming database compatibility. Once grouped vouchers exist, retain a reader that understands their allocations and linked receipts. Use the verified backup in isolation to investigate and reconcile any data fault. A production restore requires a separate decision and a plan for preserving newer postings.
