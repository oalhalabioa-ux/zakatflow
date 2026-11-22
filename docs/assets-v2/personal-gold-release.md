# Personal gold sales release candidate

The release unit is the combined candidate incorporating #478, #476 and #481 through #482. Merge only the reviewed candidate. Check its base against the current main before release; rerun the complete suite if code or base changes.

## Functional scope

Personal gold in grams, priced in the owner's base currency. Preview and sell using FIFO or specific lots, correct price on the original sale, or reverse an eligible sale and its receipt together. A posted grouped sale retains its allocation method, lot IDs, quantities, sale date, currency and destination account. Structural voucher changes under #479 remain separate work. The corporate lifecycle and depreciation workflow remains in force.

## Rehearsal and authorization

The default UI setting is off. Both grouped write RPCs are also closed to authenticated clients at migration time. Keep existing statement readers and paired reversal protection installed. Isolated workflows test the canonical migration, registration locks, manual market prices, browser transactions and the permission switch. Coordinate any hosted QA V2 rehearsal through #426 before changing the stable deployment or QA database.

## Production after independent owner authorization

1. Record the reviewed SHA, running app deployment, database project, applied migration versions and manifest hashes. Verify recoverability from a current backup/PITR restore point by restoring to an isolated database. Record snapshot identifier, recovery time, and baseline counts/balances for grouped allocations, receipts, audit and finalized Zakat. Stop if the version history, schema or restore check differs from the rehearsal.
2. Apply missing canonical migrations once in version order. The asset edit migration is 20261121180000. The grouped sale migration is 20261122010000. The latter installs the planner, allocation writer, atomic sale/receipt, statement reader, audit/reversal guards and card RPC. Validate the disabled-state SQL and financial read-back. Leave write access closed.
3. Release the reviewed application through the normal main deployment. Use a coordinated release window because main may auto-deploy. Build with NEXT_PUBLIC_PERSONAL_GOLD_SALES omitted or 0 initially. Verify asset editing and statements, original manual prices and ownership isolation.
4. After activation approval, apply supabase/release/personal-gold-sales/enable.sql and build the reviewed application with NEXT_PUBLIC_PERSONAL_GOLD_SALES=1. This build-time flag requires a new build. Verify authorized visibility and read-back. Use approved synthetic accounts in QA for financial writes.
5. On rollback run disable.sql first, confirm with tests/sql/personal-gold-release-disabled.sql, rebuild with the flag off and retain the combined read path for existing grouped sales. Disabling also blocks price changes through the existing amendment path for grouped sales. Preserve lawful history, allocations, deposit lots, audit rows, saved Zakat, and structural-reversal guards. Reconcile transactions already in flight when closing the gate. Do not drop these tables or restore an old production snapshot over newer postings. Restore a backup to an isolated database for investigation or a separately approved recovery.
