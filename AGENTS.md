# Yaqeen Business — mandatory repository-wide instructions

These instructions apply to **every ChatGPT Work, AI coding, and human development session** working on `oalhalabioa-ux/zakatflow`. Read [Deployment governance](docs/operations/deployment-governance.md) and the [central release queue, Issue #426](https://github.com/oalhalabioa-ux/zakatflow/issues/426) before any deployment action.

## Deployments — hard rules

1. **Development is not deployment.** Use feature branches, local builds, GitHub Actions, and PRs for ordinary code/test iterations. Never invoke Vercel deploy/CLI/deploy hooks/REST API on every commit, every PR, or every test retry.
2. **Production only from approved `main`.** The Vercel project `zakatflow` serves `app.yaqeenbiz.com`. Only `main` auto-deploys via Git. Do not directly push to `main`, merge a PR, publish a Production deployment, change production domains/secrets, or apply production DB migrations without explicit approval and required successful checks. A change to `vercel.json` itself may cause a production redeploy after merge.
3. **All other Git branches are auto-deploy-disabled.** Preserve `git.deploymentEnabled` with `"**": false` and `"main": true`. A `true` rule for any other branch is prohibited. Changes must pass the deployment-policy GitHub Action. Rebases/merges from `main` bring this policy to existing long-lived branches.
4. **QA V2 is a shared, independently managed release target**, Vercel project `yaqeen-financial-core-v2-qa`. Preserve its existing stable URL and QA database. Do not switch branches, aliases, environment variables, or deploy while another session is testing. Coordinate through [Issue #426](https://github.com/oalhalabioa-ux/zakatflow/issues/426), recording exact commit, PR, passed checks and QA owner before one intentional deployment of a validated candidate. Release/verify the coordination lock afterward.
5. **QA V2 must not touch Production.** Never copy production secrets/data into QA, mutate the production Supabase project, or change Google production auth during QA. Do not merge unapproved modules just to get a testable preview.
6. **No duplicate deployments for one SHA** unless deliberately needed and explicitly justified in Issue #426. Prefer tests without hosted deployment until an integration/browser check actually requires hosted QA.
7. **Preserve user-facing stable URLs.** A new generated deployment URL does not justify repointing QA/production aliases. Any release must verify and report the same stable QA address, SHA, deployment ID, and smoke-test result.

## Fast delivery — execution rules

Follow the [owner's Fast Delivery decision in #426](https://github.com/oalhalabioa-ux/zakatflow/issues/426#issuecomment-7209252802). This section changes execution efficiency, not deployment authority or the hard rules above.

- Track one central status record with owners, dependencies, accepted evidence, blockers, and next deliverables. At session start use the current summary and relevant changes; consult historical or edited records only when needed to resolve conflicts, verify authorization, or validate a sensitive transition. Before any deployment or migration, verify the latest applicable approvals and actual target state.
- Keep one owner and existing branch/PR per work package where practical. Run independent work and isolated synthetic-data checks concurrently; use the shared QA V2 slot only for required hosted acceptance, with the existing coordination gate. Do not automatically create another branch or deployment for each small edit.
- Classify changes: L1 presentation-only; L2 report/read/export or data-dependent behavior; L3 ledger, zakat, financial calculations, migrations, authorization or data integrity. Use targeted checks for L1; reconcile amounts, scope, and permissions for L2; require financial/integrity and migration/rollback evidence as applicable for L3. Mixed changes inherit the highest relevant risk. Never waive required CI, security, isolation, financial acceptance or production approval.
- Reuse passing evidence only when its inputs, relevant dependencies and scope remain unchanged. Re-run affected checks and all required release checks on the exact final candidate. No duplicate full review without a material reason.
- Freeze the current release scope until its acceptance gaps close; do not block unrelated packages on an artificial dependency. Resolve routine technical decisions within the existing approved scope. Escalate real blockers and offer alternatives, preserving the original owner and approval boundaries. Aim to report a blocker after an hour without progress; work on independent tasks rather than waiting.
- Batch new owner decisions with exact SHA, impact, required migrations, acceptance evidence and rollback plan. Do not request already granted approval within its exact scope, or transfer it to a new candidate without authority.
- Report accepted deliverables and verifiable links, not just test counts or activity. Distinguish isolated, CI, hosted QA, deployed, and verified production. No automatic closure of sensitive tasks, unapproved paid resources, feature-flag changes, or data mutations.

## General session handoff

- At the start of a development session, inspect the latest `main`, active PRs/other sessions, this file and Issue #426. Work in your own feature branch, not a shared release/QA branch.
- At handoff, report branch, full SHA, PR, checks, work completed, blocked items, and whether a **QA deployment was actually performed**. Passing tests or opening a PR must never be described as a live deploy.
- For an approved QA V2 candidate, first coordinate using the issue; only one coordinator publishes, then validates persisted data, organization isolation, and other relevant end-to-end paths.
- Keep this policy consistent across all modules: reports, financial setup, Financial Core V2, feasibility, subscription/billing, and ZATCA.

## تعليمات إلزامية لكل الجلسات

**رفع الكود إلى GitHub لا يعني النشر على Vercel.** يمنع النشر الآلي لفروع التطوير؛ فرع `main` للإنتاج المعتمد فقط؛ وQA V2 بيئة مشتركة لها منسق واحد وطلب نشر موثق في [#426](https://github.com/oalhalabioa-ux/zakatflow/issues/426). لا تغيّر روابط المعاينة الثابتة ولا Production أو قواعد بياناته. نفّذ الفحوصات أولًا، ثم انشر نسخة مرشحة واحدة بعد التنسيق، وسجل SHA والنتيجة.
