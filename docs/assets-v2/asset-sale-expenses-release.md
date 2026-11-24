# Release of the realized asset profit report

PR #506 adds an optional column and a record-only association between a posted sale and an existing expense. Personal withdrawals must come from a cash or bank account owned by the same user. Institutional expenses must already be posted through Financial Core V2 in the same organization, entity and base currency. Attach the voucher only when its full expense is attributable to that sale. For a grouped sale, the linked expense follows the recorded sold quantities. One source voucher can be linked once at a time.

A link leaves the original journals, cash and lots, FIFO, assessments and receipts in place. Linking and unlinking write an audit event in the same transaction. Price and destination corrections retain prior links. Reversed expenses leave the calculation. A source with a pending VAT adjustment or unverifiable classification is presented as incomplete.

## Deployment and recovery

1. Confirm the exact candidate, successful canonical bootstrap and browser tests, current main and the QA V2 slot in #426. Apply migration `20261124140000_asset_sale_expense_links` in QA V2 only for acceptance. Record the migration checksum and verify the authenticated personal and institutional results, including a separate user.
2. Obtain the separate Production database approval before applying the migration. Confirm the current Production migration history and a recent usable backup. Apply the one additive migration before the web release. Verify the private table, RLS, authenticated RPC grants, absence of anonymous grants and initial zero link count.
3. Merge the reviewed candidate. Track its single main-triggered deployment to READY. Verify the live assets page and its existing authorization behavior. Confirm the new column is initially hidden and coordinates with the current report preferences.
4. If web acceptance fails, revert the web release through the approved main deployment path. The additive migration and audit evidence can remain. An incident that requires preventing further linking should first revoke the writer RPC from authenticated users under separate database authorization. Preserve existing links and audit evidence for reconciliation.
