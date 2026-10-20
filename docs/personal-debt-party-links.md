# Personal debt party links

Personal additional funding and historical opening vouchers can explicitly select an existing same-side debt party. New vouchers remain independent financial records; opening principal, cash history and hawl dates are not rewritten. The existing personal financing, opening and settlement RPCs remain the financial writers.

`linked_personal_debt_command` atomically executes the existing writer and appends an immutable owner-scoped `personal_debt_links` record. It validates the source owner/type, uses its canonical party identity, inherits classification for historical balances while new cash funding keeps its loan classification and rejects changed replay links. An ordinary debt cannot be linked to an advance. A source link can be followed through later additional vouchers without merging debtors by equal names.

The register applies links to balances and statement movements. Settled receivables remain available in party choices. Personal creditor legacy name keys remain compatible; existing history is not migrated or silently merged. New parties are saved with their voucher, not as separate corporate counterparties.

From the personal receivables/payables row, plus opens settlement, additional cash funding, additional historical opening balance and the party statement. Settlement defaults to the oldest open voucher; another voucher can be selected explicitly. Existing personal settlement currency limits remain in force. A new purchase/sale is recorded from its source, not disguised as an opening balance.

QA: `tests/sql/personal-debt-party-links-qa.sql` runs under authenticated RLS and rolls back all fixtures. Covers 5000 + 1000 - 2000 = 4000 for both sides; bank once; immutable opening; replay and changed-link replay; cross-user and wrong-side rejection. No production financial fixtures are created.
