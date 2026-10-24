# Saved signing-material preparation contract — 2026-10-24

`lib/zatca-stored-signer.ts` prepares a reservation-derived artifact using a strict, already-authorized saved signer binding. It is a backend primitive with no production import, HTTP route, registry writer, database migration or authority request. The binding argument is **not** authenticated by its shape: a future backend must load it from its authorized onboarding registry, never from request JSON.

## Binding and lookup

`ZATCA_SAVED_SIGNER_V1` requires organization/environment/unit/connection identity, an immutable KMS key ARN, a complete tenant/environment/connection-scoped Secrets Manager ARN, an explicit immutable secret VersionId, the previously approved certificate SHA-256 pin, issuer chain, approved policy identifier/digest and explicit experimental QR choice. Scope is compared with the separately authorized expected invoice scope. Key/secret references must belong to the same AWS account/region, matching the current application's single-region configuration. KMS aliases, partial secret names, missing versions/pins and cross-scope references are rejected before transport.

Every secret read supplies **both VersionId and VersionStage=AWSCURRENT**; AWS requires these to identify the same version. The returned ARN/version/current-stage are checked exactly. The loader supports only bounded JSON with the current writer's `binarySecurityToken` and `secret` fields, and exactly canonical base64 DER certificate content. It does not guess nested encodings, PEM wrappers, private-key bundles or unrelated extra fields. Actual onboarding token/profile interoperability remains an acceptance gate.

Certificate preflight checks the saved pin, exact DER, validity time and compatible non-CA secp256k1 key. Before signing, the saved version is fetched again and compared with the original secret-content digest. The existing KMS primitive loads the saved immutable key's public metadata, checks it against the certificate, signs canonical SignedInfo as SHA256 DIGEST exactly once, and independently verifies the returned signature. After signing, the same current secret version/content and certificate time are checked again; rotation/expiry means no artifact result is returned. Each check is point-in-time, not an atomic distributed guarantee against rotation after the last read.

The returned artifact remains RESERVATION_BOUND_PREPARATION_ONLY and carries only version/certificate reference metadata in addition to existing preparation/finalization arguments. Authentication passwords are not returned, logged or placed in errors. AWS transport/secret parsing failures are sanitized without original messages/causes. Key/signature validation errors and operational KMS unavailability use distinct safe codes. No generic signing callback or arbitrary XML/key/policy override is exposed by the returned preparation closure.

## Existing onboarding gap and remaining integration

The current `app/api/vat/e-invoicing/route.ts` saves the ARN from CreateSecret/PutSecretValue, but does **not** persist their VersionId or an approved certificate fingerprint/chain/policy registry. This work deliberately leaves that live route unchanged. Existing connection rows cannot be treated as ready saved signer bindings; missing data fails closed. A reviewed registry schema/writer must capture exact AWS version metadata and establish CSR/KMS/certificate/VAT/EGS identity and approved policy/trust before this primitive is wired.

The private SQL connection-reference stamp currently covers key/secret ARNs and saved identity, not credential versions/certificate pins. The future backend must bind the loaded version/pin/policy to the reservation and recheck current registry authorization/version before finalization; this module does not close that persistence or transport boundary. Full configured trust anchors/PKIX/profile/key usage/VAT/EGS identity/revocation, signing-time authorization and actual AWS/SDK/authority acceptance remain gates. Current XAdES chain linkage is not a full trust decision. Hostinger still requires an approved hosting-independent AWS identity arrangement.

## Validation

32 new regressions use ephemeral synthetic CA/leaf certificates and mocked AWS transports. OpenSSL independently signs the raw SHA256 digest for the KMS mock; Node independently verifies its returned DER signature, and native XMLSec verifies the complete returned XML. Tests cover exact version/stage commands, scope/ARN/version/pin mismatches, malformed/oversized/extra/binary/nested credential content, key mismatch, sanitized secret/KMS errors, rotation/content changes before/during signing, expiry before/during signing, async input capture and rejected reservation credential overrides. Two database-dependent signing tests remain separately enabled by their explicit flags.

These are preparation/mocked-transport checks, not real Secrets Manager/KMS/IAM integration or current authority-profile acceptance. No cloud account, key, secret, billable resource or authority submission was created.

Primary reference: [AWS GetSecretValue](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html), including explicit VersionId/VersionStage semantics and secret-value logging guidance.
