# Nine-screen validation — 2026-11-02

- First page approved with the actual financial-platform sidebar required. All nine routes now use that actual component; no duplicate visible sidebar.
- Final unit suite: 184 files / 1023 tests passed. TypeScript passed.
- Isolated Next production build passed. Existing unrelated autoprefixer warnings remain.
- Four viewport sizes × two languages × nine pages = 72 layout checks; each asserted no document-width overflow and exactly one actual platform sidebar. Actual viewport/full-page screenshots were saved.
- Browser interactions passed: scoped income/currency conversion; comparison columns; collapsible statement groups; real XLSX values; monthly budget edits/formulas; January copy; scenario-aware XLSX; escaped CSV text; disabled approval/publishing; sidebar preference persistence; mobile rail/drawer and Escape; XLSX and print/PDF for every new page; shared overview organization selection. The final scoped-selector correction was in the test runner, not a UI workaround.
- Standalone HTML uses the same source components/styles/brand assets and passed all nine local page checks without browser exceptions.
- Pure projection tests cover exact decimal amounts, balanced openings/entries/statements, source uniqueness, full reversals, source mapping requirements, cash transfers, date boundaries, report-period versus fiscal profit and input immutability. Fixture tests cover comparative detail totals, cash continuity, monthly chart reconciliation and budget formulas.
- No application dependency changes, live financial-data reads, writes/migrations, deployment or merge. Only non-customer schema catalogs were read in Financial Core QA and Production.
- Real authenticated adapter, RLS/multi-user/revocation and end-to-end real accounting source tests are **not complete**. The source contract gap is documented in README and source-catalog-review.json. The design fixture's organization switching is not an RLS test.

Visual matching is assessed through per-screen comparison images; no image similarity percentage or 100% identity is claimed. Owner approval of all new screens and final release is still required.
