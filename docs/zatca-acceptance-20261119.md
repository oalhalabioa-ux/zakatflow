# ZATCA Developer Portal acceptance — 2026-11-19

Source: `23a20a95ffb43458622ae32c533360ee1bbb96d8`, based on merged main `6a56458769a03c7df772c426df3e20bab97a97ba`.
Preview project: `yaqeen-fatoora-qa`; deployment `dpl_9MhGfjaXY1Jr2yvjcmKVhKgq2iwT` (READY).
Sanitized evidence: https://yaqeen-fatoora-3z32jf8pv-oalhalabioa-9334.vercel.app/acceptance.json

| Check | Actual result |
| --- | --- |
| Existing QA AWS OIDC/KMS identity | Passed; exact project, role, region and key |
| Compliance CSID | HTTP 200; certificate SPKI matches existing KMS key |
| Standard invoice | HTTP 200, validation PASS, zero errors/warnings |
| Standard credit note | HTTP 200, validation PASS, zero errors/warnings |
| Standard debit note | HTTP 200, validation PASS, zero errors/warnings |
| Simplified invoice | HTTP 200, validation PASS, zero errors/warnings |
| Simplified credit note | HTTP 200, validation PASS, zero errors/warnings |
| Simplified debit note | HTTP 200, validation PASS, zero errors/warnings |
| Permanent Developer Portal test CSID | BLOCKED: AUTHORITY_CERTIFICATE_KEY_MISMATCH |
| Reporting | Not attempted: preceding certificate gate failed |
| Clearance | Not attempted: preceding certificate gate failed |
| Production release acceptance | OPEN; releaseReady=false |

This is a synthetic Developer Portal diagnostic, not an end-to-end test of application-issued invoices. Simplified cases use the explicitly test-only SDK 3.4.5 compatibility probe with its documented signed-properties limitation. A validator PASS does not remove that limitation or establish certificate identity, chain trust/revocation, authorized Simulation acceptance, or production readiness. Runtime code retains its independent cryptographic requirements. Do not replace its signing profile with this diagnostic helper.

The permanent test credential certificate returned by the Developer Portal did not match the key used to create the CSR. The runner refused to use it. No credentials, certificates, invoice XML or raw authority response were published. No real FATOORA Production/Simulation request, database migration or credential activation occurred. Shared QA V2 and production aliases were untouched.

Remaining gates: reconcile current official SDK/profile with the standards-preserving runtime signature; obtain a matching usable test credential through the documented authority environment; verify actual REPORTED/CLEARED outcomes with the application path; complete signed-content tampering, certificate trust/identity/revocation, authenticated company permissions and financial lifecycle acceptance. Authorized taxpayer Simulation credentials may be needed for that environment; Developer Portal sample success must not substitute for them.

Local checks: TypeScript and esbuild passed. Eleven focused tests passed across the new acceptance suite and existing production-boundary guard. Prior merged CI evidence remains recorded in PR #443. No repeat deployment was made to bypass the failing certificate check.
