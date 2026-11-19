# Original CSR, saved unit and certificate identity — 2026-10-25

## V2 CSR identity correction — 2026-11-19

The application previously replaced the supplied simulation common name with `PREZATCA-Code-Signing` and encoded the EGS serial under SAN `serialNumber` (2.5.4.5). The authority Security Features v1.2 table on page 15 assigns CN to the taxpayer's solution-unit name. Actual generation with the owner-supplied Java SDK 3.4.8 confirms that CN retains this supplied name and the SAN serial uses `SN` / surname (2.5.4.4). The corrected writer and original-CSR/certificate verifier agree on both fields. The environment marker remains exclusively in the certificate-template extension. This does not modify the separate accepted Developer Portal diagnostic CSR writer.

V2 is explicit in the initial-request writer, disposable SQL contract, reader schema and verification-audit schema. Native verification rejects another saved common name, a certificate with another CN for the same key, the old serial OID and a V1 identity receipt. Stored requests/certificates are not rewritten, relabelled or automatically regenerated. Existing V1 material needs a separately reviewed recovery/version path; this change adds no persistent migration or active-credential promotion.

`scripts/zatca/verify-csr-sdk348.mjs` performs an offline comparison using the exact pinned 3.4.8 JAR. It generates fresh synthetic SDK keys/CSRs for each of the two environment templates, creates an application CSR with the same ephemeral key, and uses OpenSSL independently to verify signatures, public keys, subject identity, exact SAN text and template values. All private material is removed in finally blocks. Only sanitized booleans and encoding descriptions are emitted; no CSR, key, customer data, credentials or authority request is published. Recorded results are in `docs/zatca-csr-sdk348-evidence-20261119.json`.

This is **semantic identity comparison**, not byte-identical CSR or CA acceptance. The SDK uses UTF8String for the template while the application retains PrintableString as directed by authority simulation guidance; the application also includes its explicitly saved requester email, which the certificate verifier already permits the CA to omit. Those differences are reported rather than hidden. An authorized Simulation request is still needed to establish actual issuer acceptance, and the separate invoice-signature/SDK security-profile question remains open.

Reproduce with the owner's already supplied SDK, a compatible Java 11 runtime, and a local SDK config whose resource paths are valid for the host:

```sh
node scripts/zatca/verify-csr-sdk348.mjs --java /absolute/path/to/java --jar /absolute/path/to/zatca-einvoicing-sdk-238-R3.4.8.jar --sdk-config /absolute/path/to/sdk-config.json
```

References:
- https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf — table 1, common name on page 15.
- https://zatca1.discourse.group/t/simulation-environment-handling-csr-and-compliance-api-with-zatca/4157 — authority guidance distinguishes the simulation template extension and endpoint/OTP.
- Bundled Java 3.4.8 CSR CLI and `-sim` option, exact JAR SHA-256 recorded in the JSON evidence.

`lib/zatca-onboarding-identity.ts` adds two backend preparation checks:

- `inspectZatcaOnboardingIdentity(material, savedUnit, at)` returns `ONBOARDING_IDENTITY_PREFLIGHT_ONLY`.
- `verifyZatcaOnboardingCandidate(material, savedUnit, pathEvidence, configuredTrust, at)` combines identity with the independently configured native path/full-chain CRL checker and returns `ONBOARDING_CANDIDATE_ONLY`.

Neither authorizes a user, writes a registry, activates a connection or calls AWS/ZATCA. No production route or stored-signer closure imports this module. Its values must come from authorized server records, not request JSON; a valid shape is not evidence of authorization. Existing session/role preflight and atomic registry-aware reservation/finalization remain separate mandatory boundaries.

## Exact supported layout

The caller must explicitly select saved profile `ZAKATFLOW_SAN_DIRECTORY_V2`, describing the corrected application CSR identity layout, not a newly certified authority profile. There is no AUTO mode, alternate-field search or fallback to matching text in DNS/SAN display strings. V1 receipts are not silently reinterpreted as V2.

| Identity | Required location in this supported layout |
| --- | --- |
| Country | Subject C = SA |
| Legal name and branch | Subject O and OU |
| Common name | Subject CN equals the saved solution-unit common name in both environments |
| Requester email | Original CSR emailAddress; certificate may omit it, but a present value must match |
| EGS serial | Single SAN directoryName SN / surname (2.5.4.4), as observed in Java SDK 3.4.8 output |
| Taxpayer VAT | SAN directoryName UID (0.9.2342.19200300.100.1.1) |
| Supported invoice categories | SAN directoryName title (2.5.4.12) |
| Branch location | SAN directoryName registeredAddress (2.5.4.26) |
| Industry | SAN directoryName businessCategory (2.5.4.15) |

The original CSR template extension must exactly identify the expected environment. A template extension in the certificate, if present, must agree. Actual environment trust comes from independently configured CA roots in the combined check; CN/template text alone cannot establish it. VAT groups' special OU/TIN rules are not separately implemented here and remain an authority-profile acceptance gate.

Certificate and CSR subject identity attributes are unique, with no unknown/mixed subject identity fields in this bounded profile. SAN must have exactly one directoryName and its exact five attributes. Missing, extra or duplicated alternatives are rejected. The parser reads bounded canonical DER lengths/OID bytes and UTF8String/PrintableString/IA5String values, rejecting control characters, malformed encodings and unsupported string/profile forms. It does not parse OpenSSL subject display text or Node's formatted SAN string. Identity strings compare exactly; no trimming or Unicode normalization silently alters them. Arabic UTF-8 is tested.

The published 2023 illustrative profile describes subject organizationIdentifier/businessCategory and notes that the final CA CP/CPS profile governs. That differs from this current application's UID/title directory layout. This module does **not** resolve the difference by guessing, switch the live CSR writer or claim either layout is accepted by the current authority. A real current authority CSR/certificate fixture and reviewed explicit profile mapping remain required before activation.

## Original provenance and key binding

The trusted saved unit must contain the original CSR DER SHA256 digest, saved KMS public SPKI, scope/explicit profile and complete identity values. The material must contain that exact single PEM CSR and canonical certificate DER. The function verifies:

1. CSR DER digest matches the **original saved request**, rather than accepting a regenerated request for the same key.
2. CSR version/algorithm/attributes are the supported PKCS#10 form; ECDSA/SHA256 signature is independently checked with Node, with strict DER signature encoding.
3. CSR SPKI is canonical secp256k1 and exactly matches saved KMS public SPKI.
4. Both CSR and certificate identities match the saved unit; certificate public key exactly matches the original request.
5. Certificate preflight enforces exact DER, non-CA leaf, curve and validity. Its computed fingerprint is candidate evidence, **not independent CA trust**.
6. The combined check uses that same certificate/fingerprint/environment with protected root configuration and complete-chain CRLs. Identity/key equality cannot bypass revocation or CA trust.

The result contains scope, profile and public-material digests and a complete expected-identity receipt, not taxpayer/EGS/email text or key/token/password contents. Errors omit supplied data, native messages and causes. The combined path captures material/identity/evidence/time before awaiting native verification; no caller-selected certificate pin, executable or path is accepted through path evidence.

## Evidence and remaining integration

42 regressions use the existing CSR builder, independent OpenSSL CSR verification/CA issuance and native CRL verification. They cover production/simulation layouts; Arabic strings; saved/certificate identity substitution using the same CA/key; another key; changed CSR provenance and invalid signatures; duplicate/multiple SAN identities and duplicate subjects; mixed profiles; email omission/conflict; malformed/private/bundled inputs and safe errors. Combined checks prove successful identity plus trust for the same certificate, rejection of a revoked otherwise matching certificate, early identity failure, rejected override fields and async input capture.

The live onboarding route currently generates a CSR in memory and records only the resulting AWS secret ARN. It does not persist the original CSR/digest, AWS VersionId, explicit identity profile or this composite evidence. Existing connections cannot be retroactively declared verified by regenerating a CSR or inventing provenance. The next writer/coordinator must preserve original enrollment inputs before authority submission, capture actual immutable AWS metadata and bind reviewed identity/path evidence to the saved registry version, then recheck fresh authorization/trust at signing/finalization. The additive disposable enrollment contract now preserves original CSR/identity and binds its receipt/path evidence to registry/reservation/finalization (see `docs/zatca-enrollment-provenance.md`). It is not installed as a migration or invoked by the live route.

Still required: actual authority-profile/CP/CPS mapping, environment CA/CRL provisioning and refresh, verified fresh KMS metadata, authorized backend transport and signing-time checks, backend native/WASM packaging, real AWS/IAM/current SDK/simulation acceptance and accounting/recovery lifecycle validation. The native dependencies are deliberately not assumed to exist in the live Next.js/Hostinger runtime.

References: [ZATCA security features v1.2](https://www.zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf), [RFC 2986 PKCS#10](https://www.rfc-editor.org/rfc/rfc2986), [RFC 5280](https://www.rfc-editor.org/rfc/rfc5280), and `docs/zatca-certificate-path-preflight.md`.

The separately opted-in native SQL test now verifies the original saved request/identity through the composite verifier, compares Arabic identity receipts with PostgreSQL and rejects a receipt derived from another saved snapshot before enrollment-aware reservation/finalization. The XML storage payload in that test is synthetic; it does not claim complete enrolled-UBL/authority acceptance.
