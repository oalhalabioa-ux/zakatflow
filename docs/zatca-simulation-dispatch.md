# Saved-original Simulation dispatch candidate

The separate single-owner diagnostic in `docs/zatca-simulation-qa-preview.md` can use the newly owner-provisioned QA quarantine permissions without SQL. It does not provision, activate or replace the SQL/Auth-backed application candidate described below.

This is private backend code, not a published OTP form or an active signer. Do not generate an OTP based on passing unit/CI checks. The existing isolated Vercel project currently has only its three diagnostic AWS variables; the dedicated private SQL worker/Auth binding and quarantine encryption/IAM configuration remain unprovisioned.

`services/zatca-private-simulation-dispatcher.ts` adds one real fixed Simulation HTTP attempt after the existing saved-original reader, independent CSR signature/identity verification, fresh KMS key-metadata/SPKI check and durable dispatch fence. Replays and unknown outcomes require reconciliation; no reset or automatic resend exists. A successful response goes into the existing separate encrypted Secrets Manager quarantine and then receives an independently authorized SQL reference. The return value contains only identifiers, a receipt digest and `activationAllowed:false`.

`lib/zatca-simulation-compliance.ts` fixes the URL to `/e-invoicing/simulation/compliance`, disallows endpoint/environment/CSR overrides, sends original PEM base64 with JSON/V2 headers, blocks redirects, limits response bytes and applies a 20-second fetch/body deadline. Error messages never include authority bodies, OTPs or credentials. Request IDs received as numbers must be safe integers; larger IDs must arrive as decimal strings. Malformed or uncertain responses never authorize a second automatic attempt.

The authority's authentication token is preserved byte-for-byte. Verification separately handles a single DER certificate, its base64-text wrapper or a single PEM wrapper, rejecting trailing/bundled/triple-wrapped material. Normalization does not establish identity, key matching, expiry, CA trust or revocation. Existing private verification still applies those checks after quarantine and does not activate a signer.

## Existing legacy application path

`app/api/vat/e-invoicing/route.ts` and `components/vat-einvoice-setup.tsx` already contain an older Simulation request form. That path does **not** call this new dispatcher, original-request persistence or one-shot fence. It must not be presented as the reviewed saved-original flow. This candidate adds no caller to the legacy route, modifies no authentication or Production configuration and deploys no app.

## Concrete provisioning step for the owner

`scripts/zatca/provision-qa-enrollment.sh` is intended for the owner's AWS CloudShell, not this development container. It verifies account `701899214938` and the existing `yaqeen-fatoora-qa-preview` role, creates/reuses one tagged symmetric KMS quarantine key and adds the separate `YaqeenQASimulationEnrollmentQuarantine` inline policy. It preserves existing role policies and the asymmetric signing key. The policy permits only Simulation quarantine Create/Tag/Describe/Get operations and encryption-key use through regional Secrets Manager with the matching secret namespace. It grants no PutSecretValue, deletion, rotation, key administration or Production namespace access.

The helper is **not executed** by this code change. It creates a customer-managed encryption key if the alias is absent; reviewing and running it is an AWS provisioning action. Lost cloud acknowledgements stop the script; do not blindly rerun after an unknown create result. Its output is public configuration metadata, never an access key, secret credential or OTP. Successful provisioning alone does not make the HTTP/UI path ready.

Still required before asking for a real OTP: reviewed private SQL packaging/grants and dedicated direct/session-mode worker, deployment-bound Auth and authorized QA organization/unit, preservation of the original CSR, server-only quarantine config, CSRF/rate/tenant HTTP boundary, accurate recovery/status UI and one coordinated isolated Preview smoke test. Current issuer/CRL trust and the unresolved runtime invoice SDK profile remain additional acceptance gates. No company data, OTP or credentials belong in Git/public evidence.

The independently inspected FATOORA QA database is the existing isolated project `mbilbpaxnuxfgyweztsa`; inspection found no organization, invoice connection or account for the selected requester. No rows, auth accounts, functions or schema were created during that inspection. Shared QA V2 and Production are separate and unchanged.
