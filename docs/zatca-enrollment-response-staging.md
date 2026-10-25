# Unverified enrollment-response quarantine and immutable receipt

`lib/zatca-enrollment-response-staging.ts` preserves a **normalized successful authority response candidate** using an injected Secrets Manager transport. `services/zatca-private-enrollment-response.ts` records only its opaque reference through `tests/fixtures/zatca-enrollment-response.sql`. These remain isolated preparation components: no live authority request, AWS client/account/resource, HTTP endpoint, automatic response activation or installed migration. AWS operations are mocked in tests; real encryption/IAM/network behavior is not claimed.

## Quarantine storage

The protected coordinator must supply saved company/environment/connection, original enrollment/digest, durable dispatch UUID and saved signing-key ARN. Neither the AWS client nor region/account/encryption-key configuration comes from request JSON. The normalized in-memory response contains only request ID text, canonical base64 credential token and bounded printable credential secret. It is not a parser for arbitrary live provider responses. Actual request-ID representation and credential codec remain current authority interoperability gates.

The namespace is deliberately separate from active credentials:

`zakatflow/fatoora-enrollment/{company}/{environment}/{connection}/{enrollment}/{dispatch}`

`CreateSecret` receives this deterministic name, a protected immutable encryption-key ARN, the saved dispatch UUID as `ClientRequestToken`, and a canonical JSON envelope in **SecretString only**. The envelope binds every saved context field and original digest to the normalized response. No OTP or Auth access token is accepted. Signing/encryption key ARNs must be distinct and match configured region/account; no alias, cross-account/region fallback, replica or active-secret overwrite is used. Configuring a symmetric encryption key and matching IAM/KMS permissions remains a deployment requirement, not a verified AWS fact from these tests.

AWS creates the initial `AWSCURRENT` version **inside this new quarantine secret**. This does not activate a signer: the existing stored signer rejects the quarantine namespace, and a regression checks that rejection before any secret read. The stager never calls PutSecretValue, UpdateSecretVersionStage, DeleteSecret or an authority endpoint. No existing active-secret stage is moved.

After creation, the stager validates exact returned name/complete ARN/dispatch VersionId, then DescribeSecret and GetSecretValue readback. Metadata must match the configured current encryption key/name/ARN with no deletion, managed service, rotation or replicas. The exact immutable VersionId is always requested; AWSCURRENT is not used to choose a response version. Metadata is a current configuration check, not a per-version encryption-key attestation or an atomic guarantee against later administrative changes.

Strict readback rejects wrong scope/version, noncanonical/duplicate/extra JSON, wrong codec, binary or oversized content. An exact staging retry checks **identical canonical content** and refuses changed request ID/token/secret. The returned reference contains only versioned quarantine format, complete ARN, immutable VersionId, encryption-key ARN, private envelope SHA256 and public-token-byte SHA256. It returns no request ID, credential token or secret. Those hashes are consistency values, not signatures, trust evidence or proof of authority submission.

## Recovery without resubmission

Any failed CreateSecret acknowledgement, including ResourceExists, triggers only a lookup of that deterministic name and exact saved VersionId. A matching stored envelope can reconcile a successful write; missing/unavailable or conflicting data returns a fixed sanitized failure. No replacement version or new authority request is attempted.

`recoverResponse(savedContext)` is read-only: it uses DescribeSecret/GetSecretValue and does not need the lost in-memory authority response. It returns the reference to the same scoped canonical saved envelope. This allows a future protected coordinator to complete a missing SQL receipt after an interruption. Recovery does not validate CA trust, CSR identity, credential-secret correctness or that the response actually came from the authority. Those checks and audited authorization remain required before activation. A response lost **before** successful quarantine storage cannot be recovered by this primitive; the dispatch remains reconciliation-required, without automatic resend.

## Private SQL reference

The private INVOKER function locks fresh active OWNER/ADMIN membership and the scoped saved connection, checks original enrollment checksum/digest/unit stamp and the existing immutable dispatch, then validates an exact six-field reference. ARN namespace, company/environment/connection/enrollment/dispatch, saved signing-key region/account, distinct encryption key and VersionId=dispatch UUID must match. Raw token/secret/OTP/certificate or extra JSON fields are rejected.

One immutable receipt per dispatch stores only that reference, a database JSONB checksum, first actor and database time. Exact retries/concurrent writes preserve the first receipt. Changed references cannot replace it. First receipt recording requires KEY_READY/no credentials/no registry; an exact existing receipt may be retried after credentials appear, with current authorization/unit checks. It neither updates connection status/credentials nor records a signer version. SQL accepts a correctly shaped private reference without querying AWS: the protected stager/readback must actually run. It is not certificate/AWS trust validation.

The pg adapter independently verifies Auth, uses the shared isolated session helper, validates returned reference/checksum/original operation before COMMIT, sanitizes errors and clears/discards pooled identity as appropriate. An insert rolls back on a corrupt receipt. Lost COMMIT/cleanup acknowledgement may leave a committed receipt; exact retry preserves it. No raw credential is sent to PostgreSQL. RLS/immutable guards and explicit PUBLIC/anon/authenticated/service_role revocations are included. Private role/TLS/pool/migration provisioning is still required.

## Evidence — 2026-10-25

- **45 mocked-AWS unit cases**: deterministic names/token/version, read-only recovery, lost CreateSecret acknowledgement, ResourceExists, eight concurrent retries, changed content refusal, metadata/name/ARN/key/version/JSON/codec validation, sanitized failures, captured async inputs/config/transport and active-signer namespace rejection. Public token bytes in most storage tests are synthetic codec fixtures, not valid certificates.
- **21 pg-adapter unit cases**, **12 disposable SQL regressions**, **6 real pg-adapter cases**: immutable scope/reference/actor/time, eight concurrent records, authorization/revocation lock ordering, no backfill/activation, wrong digest/path/key/account/version, raw credential rejection, exact commit/cleanup recovery, corrupt-receipt rollback and pooled identity cleanup. SQL references are synthetic storage fixtures, not proof of actual AWS or authority acceptance.
- Native relational suite **153/153**. The original-enrollment case now combines saved original CSR/coordinator dispatch with a synthetic CA-issued certificate, mocked-AWS quarantine/read-only recovery, matching public-token fingerprint and an actual private pg response receipt/retry before the existing enrollment-aware registry/reservation/finalization checks. Final XML storage payload is synthetic; independent XAdES tests verify signed UBL. No single authority-accepted enrolled-UBL flow is claimed.
- Focused native suite **496 passed**; its three SQL-only cases passed separately. TypeScript and prior disposable suites (17 ledger, 30 source, 22 registry, 18 enrollment, 16 dispatch, 8 permission) pass.

Still required: fresh authorized orchestration before cloud operations, KMS key ownership/configuration/IAM and actual AWS tests, fixed authority transport/normalization, an exact private response loader for verification, fresh native CSR/path/CRL checks on recovered material and reviewed active-credential promotion, audited recovery/status UI, HTTP/CSRF/rate/tenant boundary, native/private backend packaging and reviewed migrations, current SDK/simulation/browser acceptance. Production onboarding remains unchanged; no paid resource or permanent QA/production DDL occurred.

References: [AWS CreateSecret](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_CreateSecret.html), [AWS GetSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html), [node-postgres transactions](https://node-postgres.com/features/transactions).


The follow-up private verifier now loads the authoritative original/receipt, reads the exact quarantine version internally, verifies saved identity/native chain/CRLs and fresh KMS public metadata, then reauthorizes/reloads the same snapshot. It returns evidence only and adds no Sign/write/activation. Native relational coverage is now 173/173; see `docs/zatca-enrollment-response-verification.md`.
