# Saved quarantine-response verification candidate

`services/zatca-private-enrollment-verifier.ts` joins the authoritative original-request reader, a new private response-reference loader and `verifyStoredResponse` in the existing quarantine primitive. It is **read-only preparation**: no authority call, KMS Sign, cloud/SQL write, active credential promotion, registry activation, migration or HTTP endpoint. Production onboarding remains unchanged.

## Authoritative reads and scope

`loadResponseForVerification` on the private response store accepts only saved company/environment/connection/enrollment/dispatch IDs, never an ARN, digest, certificate, key or role override. It verifies Auth, locks fresh active OWNER/ADMIN membership and the saved scoped connection, then joins the immutable original, dispatch and response receipt. It checks both PostgreSQL original/receipt checksums, exact scope/operation/VersionId, dispatch/enrollment digest equality and current unit stamp. The saved KMS ARN must be canonical; KEY_READY and no credential reference are required. Missing, corrupt, cross-company, changed-unit or already-advanced connections fail closed.

The returned reference/receipt digest and KMS ARN are private backend values, not a public API response. The original CSR/public key/complete expected identity still comes from the separate verified original-request reader. The coordinator requires the same original enrollment/digest across both reads. SQL checks are consistency checks, not AWS/certificate authenticity proofs.

## Exact response and native verification

The quarantine verifier receives that saved context/reference/original and protected trust/path configuration. It captures inputs/config/transport before asynchronous work. It checks saved scope and original CSR before cloud access, and requires the expected complete ARN, encryption key and VersionId to match the exact quarantine namespace and dispatch. It never discovers a response via AWSCURRENT or treats a shaped caller reference as storage authority.

It then:

1. Reads metadata and the exact immutable ARN/VersionId. The canonical envelope/complete context and **all six saved reference fields** must match, including envelope and public-token hashes. No raw credential secret is returned.
2. Verifies the recovered certificate against the original signed CSR/public key, saved complete taxpayer/EGS identity and explicit current application profile.
3. Uses the existing KMS metadata/public-key validator with GetPublicKey: exact immutable ARN, ECC_SECG_P256K1, SIGN_VERIFY, ECDSA_SHA_256 and the saved SPKI. It discards the signer object and never invokes Sign. This is metadata/public-key consistency and GetPublicKey access; it does not prove live Sign permission or establish an AWS account/IAM deployment.
4. Runs the real offline composite identity and OpenSSL 3 strict chain/full-chain CRL verifier with independently protected roots and CRLs. No system trust, caller-selected root, executable, path or network retrieval is added. Actual authority profile/roots/policy acceptance remains independent.
5. Rechecks fresh KMS metadata/public key and the same immutable secret reference/content after native verification. Any changed/unavailable result returns no evidence.

The private coordinator does not hold a database transaction across cloud/native calls. Afterwards it verifies Auth/current membership again, reloads the private reference/current unit and compares receipt digest, original digest, key and reference. A revoked permission, changed snapshot or advanced connection prevents the result from being returned. As with any read, changes after that final transaction are still possible: a future activation writer must reauthorize/revalidate under its own locks rather than reuse this result as a grant.

Output is an explicitly selected `AUTHORIZED_STAGED_ENROLLMENT_VERIFICATION_ONLY` candidate containing scope/context, the exact opaque reference/receipt digest and native identity/path evidence. It contains no credential token/secret, certificate bytes, CSR or requester data. Neither a caller-supplied candidate JSON nor this point-in-time result activates a signer. Fixed sanitized errors replace unexpected database/Auth/AWS/native diagnostics and causes.

## Configuration and remaining boundaries

The factory receives protected quarantine settings, trust roots and path evidence. It copies them at construction; no per-request override exists. A protected CRL refresh mechanism must rebuild/update this configuration before expiry. Native validation fails expired/missing evidence; it does not fetch the newest remote CRL. No current authority roots or actual AWS services are provisioned by this change.

The existing current-application SAN profile remains explicitly selected and still needs reconciliation with current authority responses/policies. The helper does not validate the credential secret by contacting the authority, perform live compliance checks, authorize production use, prove exactly-once remote delivery, preserve a new verification audit or promote quarantine material into the active namespace. Those require reviewed fresh-authorized activation/recovery orchestration and actual AWS/current SDK/simulation acceptance. Dedicated direct/session-mode pool/TLS/scoped-role and private native/WASM packaging/migrations remain gates. No live Auth/browser/private-pg acceptance against Supabase QA is claimed.

## Evidence — 2026-10-25

**65 new cases**: 26 response-loader unit tests, 19 private coordinator unit tests, 18 native recovered-response cases in the onboarding suite and two actual pg response-load cases. Unit adapters use mocks; the 18 cases use actual signed CSRs (including Arabic identity), synthetic CA-issued certificates and real OpenSSL chain/CRL verification, with mocked Secrets Manager/KMS transports. The two pg cases use synthetic opaque persistence fixtures. No real AWS encryption/IAM/Sign or authority request occurred.

Coverage includes exact-version double readback, secret-envelope hash changes, wrong scope/reference/version/key, corrupt original CSR, same-key CA certificate for another legal identity, mismatched KMS metadata/SPKI, revoked otherwise matching certificates, invalid trust anchors, post-verification KMS failure, immutable async captures and current final permission/snapshot rechecks. The AWS-read test asserts only DescribeSecret/GetSecretValue and two GetPublicKey calls; no write or Sign is used.

Expanded native relational suite **173/173**: its original-enrollment round trip now runs the actual private verification coordinator against PostgreSQL plus mocked AWS, matching its receipt and native certificate fingerprint before the existing provenance/finalization checks. Its final XML storage payload is synthetic; separate XAdES tests verify signed UBL. This is not a single authority-accepted enrolled-UBL flow. Full focused suite **559 passed**, with its three SQL-only cases passed separately; TypeScript and the prior 17/30/22/18/16/12/8 SQL suites pass.

References: [AWS GetPublicKey](https://docs.aws.amazon.com/kms/latest/APIReference/API_GetPublicKey.html), [AWS GetSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html), [node-postgres transactions](https://node-postgres.com/features/transactions).
