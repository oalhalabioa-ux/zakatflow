# Yaqeen Business — unified deployment governance

**Status:** Policy baseline, effective when merged into `main`. Applies to all agents, sessions, PRs, and modules in `oalhalabioa-ux/zakatflow`.

**Coordination:** [Issue #426 — central QA V2 release gate](https://github.com/oalhalabioa-ux/zakatflow/issues/426).

## Why

On November 16, 2026, Vercel showed 151 deployments in the previous 24 hours (123 `zakatflow`, 15 `yaqeen-financial-core-v2-qa`, 13 `yaqeen-fatoora-qa`); 126 READY, 17 CANCELED and 8 ERROR. Multiple active branches each published every push; the same commit was deployed to multiple projects.

Vercel's **Ignored Build Step is not a quota fix**: canceled builds still count against deployment limits. Use `git.deploymentEnabled` instead of creating deployments and canceling them.

## Targets and decision table

| Target | Vercel project | Trigger | Rule |
| --- | --- | --- | --- |
| GitHub feature/fix/qa branches | none | push / PR | Code review and CI only; **no automatic Vercel deployment** |
| Production | `zakatflow` → `app.yaqeenbiz.com` | approved merge to `main` | **Only** allowed automatic Git deployment, after production approval/checks |
| Shared QA V2 integration | `yaqeen-financial-core-v2-qa` | one coordinated manual deployment of approved SHA | Keep stable project URL, QA DB, and membership/isolation tests |
| Isolated special QA (e.g. ZATCA) | existing isolated QA project | explicitly justified one-off deployment | Do not multiply deployments or point shared QA to test branches |

Project-level `previewDeploymentsDisabled` on **production Vercel project `zakatflow`** acts as an immediate guardrail for old long-running feature branches. It is deliberately **not** enabled on the separate QA V2 project so approved manual QA can continue. This does not block approved production `main` deployment.

Repository `vercel.json` has `git.deploymentEnabled: {"**":false,"main":true}`. The broad glob is essential: exact-name exclusions leave new branches unprotected. `main` is the **sole** true exception (when multiple branch rules match, true wins). All other branches remain false, including `feature/...`, `fix/...`, `qa/...`, `feat/...`, `integration/...`, and other future names.

**Important for old branches:** Vercel may read the configuration at the deployed Git revision; branches not yet rebased to the policy commit may carry the old config. The production project's preview block prevents that from causing excess previews. Bring the latest main into long-lived branches before further work.

## QA V2 manual deployment protocol

1. Finish code and tests in a dedicated feature branch. Pin an **exact SHA** and confirm CI/QA results.
2. In Issue #426 create a `[QA V2 DEPLOY REQUEST]` comment with PR, branch, SHA, passed checks, test scope and coordinator.
3. Coordinator checks the most recent issue activity and active QA users/tests. Coordinate a non-overlapping slot; no blind overwrite of another session's deployment.
4. Make **one** preview deployment to the existing QA V2 Vercel project, only if the planned integration needs a hosted QA environment. No `--prod`. Do not create a new project or replace stable domains.
5. Re-check the persistent QA URL, deployed exact SHA, deployment ID, auth, institutional/personal data separation, and the relevant flows. Record result in Issue #426 and the relevant PR.
6. Release coordination for the next validated candidate. Failed tests return to local/CI fixes; do not redeploy after every edit.

No Deploy Hook, scheduled job, or self-triggering GitHub workflow may publish to QA without this release gate. The gate is a recorded human/agent coordination rule; comments in the issue do **not** themselves deploy anything.

## Risk-based delivery and acceptance scheduling

The [owner-approved Fast Delivery coordination decision](https://github.com/oalhalabioa-ux/zakatflow/issues/426#issuecomment-7209252802) governs work preparation, without weakening any deployment or production rule.

| Risk | Examples | Evidence before release |
| --- | --- | --- |
| L1 — presentation-only | Layout, colors, labels, translations | Relevant UI checks and required CI; no unrelated financial or database acceptance |
| L2 — data-dependent read and operations | Reports, dashboards, exports, read behavior | Relevant functional checks, reconciliation, authorization and scope isolation |
| L3 — financial/security/data change | Posting, zakat, migrations, RLS, permissions, balances | Required CI and financial acceptance, isolation, schema/upgrade and rollback/restore evidence as applicable; explicitly scoped approvals |

Mixed changes take the highest applicable risk. Reuse valid unchanged evidence; re-run affected checks and mandatory final-candidate checks. Local and CI tests may proceed in parallel on disposable synthetic data. An existing shared QA deployment can be reused for acceptance if the exact candidate, database schema and approved scope match. Do not change aliases or database state without coordination and authority. A new exact candidate or migration outside an existing approval must be presented for approval where required.

The central coordinator uses the latest state summary and changes since the last verified evidence. Check history, edits and authorizations when relevant or inconsistent; always verify current approval and target before sensitive operations. Maintain one owner per active task, time-box shared QA slots, record explicit handoff and release, and bundle compatible decisions without blocking independent work. Report remaining blockers and alternatives rather than repeating unchanged checks. A GitHub comment does not automatically start an existing Work session.

Track accepted and released deliverables, candidate lead time, open blocker age, and unnecessary repeat checks. Planning targets are not guaranteed deadlines or evidence of completion.

## Production release protocol

- Never direct-push `main`; merge an approved PR only after successful required checks and review of branch/current-main conflicts.
- A merge to `main` triggers a Git-linked production deploy **only** if authorized and if quota is available. Never run extra `vercel deploy --prod` for the same revision.
- Production Supabase changes, domain changes, auth, and billing require separately scoped explicit approval.
- Preserve current production endpoints, stable QA URLs, and environment separation; verify deployment target and record the exact SHA after release.

## Validation and maintenance

- `node scripts/verify-deployment-policy.mjs` validates the repo guard.
- `.github/workflows/deployment-policy.yml` runs this validation for policy-changing PRs and main pushes.
- For urgent exceptions, document approver, exact target, necessity, rollback plan, and proof in Issue #426. Do **not** change `git.deploymentEnabled` globally to true.
- A GitHub instructions file alone cannot technically revoke CLI permissions. Platform settings restrict automatic previews; the shared release-gate policy coordinates explicit manual deployments. Stronger source-based deployment policies may require a paid Vercel plan.

## Official references
- https://vercel.com/docs/project-configuration/git-configuration
- https://vercel.com/docs/project-configuration/project-settings
- https://vercel.com/docs/deployments
