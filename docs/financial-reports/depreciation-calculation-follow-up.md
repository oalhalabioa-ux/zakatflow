# Deferred: automatic depreciation calculation

Recorded at the user's request on 2026-11-09 (Asia/Riyadh). This is a future task, not implemented or scheduled for automatic execution.

Current behavior: the user enters a monthly depreciation amount; the existing financial approval/posting lifecycle applies it. Duplicate monthly depreciation and amounts above net book value less recorded residual value are guarded. No useful-life-based automatic calculator was found in the reviewed code.

Future scope:
- Asset cost basis, historical accumulated depreciation, residual value, useful life, in-service date, depreciation method and per-organization policy.
- Decide and document partial-period proration, rounding, additions, partial disposals, changes of estimates and opening assets before coding. Do not silently choose a tax rate or jurisdictional method.
- Calculate proposals with a visible calculation breakdown; create reviewable drafts through the existing approval and posting commands. No automatic approval.
- Use the actual subsidiary asset, depreciation expense and accumulated depreciation accounts; preserve tenant scope and historical postings.
- Exclude nondepreciable classes, enforce the residual floor, prevent duplicate periods, respect closed periods and support reversals.
- Verify additions, partial months, residual limits, leap years, disposal, opening accumulated depreciation, estimate changes, fiscal calendars and statement reconciliation.

Resume after source posting rules and their financial-cycle acceptance are complete. The user explicitly deferred this calculator while the current source-integration work continues.
