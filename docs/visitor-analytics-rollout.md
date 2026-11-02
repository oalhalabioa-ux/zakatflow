# Yaqeen visitor analytics rollout

## Scope
- Public website: `yaqeenbiz.com` / `www.yaqeenbiz.com` (hosting must be verified independently).
- Financial platform: `app.yaqeenbiz.com` on Vercel project `zakatflow`.
- Exclude preview and QA traffic from production reports.

## Before release
1. Confirm Web Analytics is enabled for the production Vercel project. The loader at `/_vercel/insights/script.js` does not enable the service by itself.
2. Verify browser Network returns a successful script response on the actual production hostname, then observe a pageview in the Vercel dashboard. Check route transitions as well as full page loads.
3. Check whether Hostinger serves the public marketing site. If yes, install a supported tracking mechanism there separately; Vercel's endpoint must not be assumed to exist on Hostinger.
4. Verify privacy notice, consent requirements, data retention and exclusion of sensitive paths/query strings.
5. Verify no new auth, finance, or Supabase changes and no tracking on preview domains.
6. Confirm historical traffic can only be reported for dates on which a collection mechanism was active.

## Owner dashboard acceptance criteria (not yet implemented)
- Restricted to verified platform owner; deny ordinary organization users.
- Separate website and application metrics, with a combined overview only when collection definitions are comparable.
- Unique visitors, pageviews, day-by-day trends, country, device, referrer, and most visited pages, with date range and timezone clearly indicated.
- Registration conversion: count completed account creations from authorized Supabase aggregate queries; no PII in visitor reports.
- Explicit 'No tracking data available' state instead of treating missing data as genuine zero traffic.
- Never expose API tokens, visitor IP addresses, user email addresses, or raw authentication logs in browser payloads.
- Validate analytics accuracy, authorization, mobile layout, and performance on isolated QA before requesting production approval.

## Current status
Earlier GitHub checks succeeded; checks on the latest dependency commit must be rerun. Live traffic capture, Hostinger historical statistics, and owner dashboard implementation remain unverified or incomplete.

## Verified setup evidence (2026-11-02)
- Owner-provided Vercel Project Analytics screenshot shows **Get Started** instructions for Next.js, including `npm i @vercel/analytics` and `<Analytics />`. Therefore dashboard activation and actual data collection must **not** be claimed complete.
- The PR now uses the official `@vercel/analytics/next` component and the generated dependency lockfile, gated to `app.yaqeenbiz.com`.
- If switching to the documented `@vercel/analytics/next` integration, update **both** `package.json` and `package-lock.json` with a reproducible install, preserve the verified production-only gate, and rerun all QA checks. Avoid ad-hoc lockfile edits.
- Do not merge while Work is actively editing table UI. Inspect current main and potential shared layout/admin file conflicts before release.
- Before production approval, confirm the project Analytics feature is enabled and whether any billing change is proposed; no paid plan should be enabled without owner consent.

## Workflow permission diagnostic
- The bot-generated lockfile commit showed `action_required` for pull-request checks. A fresh ordinary commit on the isolated PR branch should request normal pull-request checks without requiring the owner to find an approval button. Verify actual run results; do not equate `action_required` with a failed code test.
