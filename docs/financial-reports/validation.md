# Pilot validation — 2026-11-02

Source implementation: `69e313a68e14c634d649f5b360c51565823a1b4b`, PR #341. Subsequent evidence-only documentation commits do not change application behavior.

- TypeScript: passed.
- Unit suite: 182 files, 1002 tests passed, including 5 new synthetic fixture/export tests.
- Final local Next.js production build: passed. Existing unrelated autoprefixer warnings were emitted. A prior build cleanup failure was retried without deleting files; final build completed successfully.
- Actual Next.js production server in isolation: preview disabled → 404; Vercel Production mode + enabled flag → 404; explicit isolated preview flag → 200.
- Real Chromium browser on that enabled Next route: all 13 grouped checks passed, no page exceptions. This includes four Arabic viewport sizes, English desktop/mobile, no page width overflow, five KPIs, drawer, period/entity selection, CSV row content, actual XLSX content verified with ExcelJS, local-only schedule interaction, Escape, search/empty results, print PDF and English digits.
- The same checks previously passed on the downloadable standalone HTML bundle of the same component. Final comparison images use screenshots of the actual Next.js route, not invented screenshots or image-generated UI.
- Screenshots: Arabic 1672×941, 1440×900, 390×844, 375×812; English 1672×941 and 390×844. Mobile captures are full-page and taller than the viewport.
- Visual differences: documented in visual-diff.md; visual approval pending. No arbitrary image similarity percentage or claim of 100% identity.
- No production deployment, migration, real financial input, authentication/account mutation, or new data source. Real RLS/accounting/permissions tests await the approved integration phase; fixture separation is not a substitute.

Deliverables: self-contained interactive HTML, reference/implementation desktop comparison, desktop-reference/mobile-adaptation comparison, and review evidence ZIP. No hosted preview URL is claimed; local files are supplied to avoid deploying before approval.
