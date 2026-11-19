# Owner-supplied Java SDK 3.4.8 review — 2026-11-19

Source under test: `d79636b3fcb8ee980e154a5f6ce3332e508f5670`, PR #445, based on merged main `6a56458769a03c7df772c426df3e20bab97a97ba`. The signature/QR/exporter code is unchanged by this review. Machine-readable diagnostic evidence is in `docs/zatca-sdk348-evidence-20261119.json`.

## Package identity and execution

The owner downloaded `zatca-einvoicing-sdk-Java-238-R3.4.8.zip` after selecting the Java download in the Developer Portal SIM dialog. The ZIP is 49,169,499 bytes, SHA-256 `91d079b4a6c21c8ed7fb6ec434227409537119cae8b74de34dc150f91793d1f6`. Its executable `Apps/zatca-einvoicing-sdk-238-R3.4.8.jar` hashes to `48abeb828d453ef6fafba792fddbbb2701da5c7018c24bde918853e80ff5d530`. Both `Apps/global.json` and the actual Java banner identify 3.4.8. This is a new package, distinct from the re-uploaded 3.0.8 archive; no further copy of the old ZIP is needed. This review identifies the provided release, not the newest release available from the authority on any later date.

Extracted after rejecting unsafe archive paths. The installer was not run. A separate local config resolved bundled Windows paths and the `Schematrons` directory's Linux case. No SDK rules, schemas or executable were modified. The initial path-configuration failure was corrected before counting any document results. Used an isolated Amazon Corretto 11.0.33.1.1 runtime, downloaded from the documented AWS endpoint and checked against its published SHA-256. Child processes received only PATH, LANG and SDK_CONFIG, with no application/cloud credentials.

All seller/buyer data and root/leaf secp256k1 keys were fresh synthetic fixtures. The CLI used only explicit local validate, sign and generateHash operations. No AWS, taxpayer portal, database or authority submission was used. The SDK's bundled certificate/private key were not used. Temporary synthetic private keys were deleted after validation. No SDK binary, certificate, private key, invoice XML or raw SDK log is added to the repository.

## Actual baseline results

| Synthetic group | Cases | Actual SDK outcome |
| --- | ---: | --- |
| Standard invoice, credit note, debit note, USD, discount, mixed S/E VAT | 6 | Global PASS; XSD, EN, KSA, PIH all PASS |
| Simplified invoice, credit note, debit note without signature/QR | 3 | Global FAIL as expected; QR and signature absent |
| Same simplified types with application XAdES/QR preparation | 3 | Global FAIL: XSD, QR and SIGNATURE; EN, KSA, PIH pass |
| Same simplified types with existing synthetic SDK compatibility probe | 3 | Global PASS at all six stages; synthetic-only |
| Same three unsigned simplified inputs signed by SDK with the same synthetic leaf key/certificate | 3 | Global PASS at all six stages; control only |

Independent application and SDK hash calculations matched on **18/18 actual XML files**. SDK signing reformatted the three control XML documents and changed their hashes relative to their unsigned inputs, so the hash comparison used each returned file itself. A validator exit status alone is unsafe: the SDK returned exit code 0 on the six baseline failures as well as successes.

The application output is explicitly rejected at `SigningCertificateV2`: the bundled `UBL-XAdESv132-2.1.xsd` declares `SigningCertificate` and does not declare `SigningCertificateV2`. The SDK also rejects the application's QR/signature encodings, issuer/property digest representation and timestamp representation. These are observed compatibility differences; they do not authorize replacing the runtime signature with a weaker diagnostic profile. A pass of the SDK-generated control isolates the issue to signature/profile interoperability rather than the core financial input or unavailable cryptographic runtime.

## Negative controls

1. Changed only the item description of a passing compatibility document. SDK rejected the changed invoice hash/QR/signature, still with process exit 0.
2. Changed `SigningTime` and recomputed its serialized properties digest, **without creating a new ECDSA signature**. Verified the invoice hash remained unchanged and that the original invoice-hash signature still verified. SDK 3.4.8 returned global PASS at all six stages.

The second result reproduces the known signed-properties limitation for this synthetic compatibility-profile/checker combination with the newly supplied 3.4.8 release. It is **not** a test or vulnerability claim about the live authority gateway or production system. The application keeps its standards-oriented SignedInfo signature and independent native XMLSec tamper rejection. The compatibility helper remains outside runtime, protected by the existing import-boundary test. No attempt was made to modify the authority's schema/rules or bypass key/trust checks to obtain a release pass.

## Interpretation safeguard and remaining acceptance

Added a separate, narrow 3.4.8 console interpreter. It requires the exact version, one global PASS, every unique expected stage (four for these unsigned standard cases, six for simplified), zero exit, no errors/warnings/codes and no contradictory output. Missing/duplicate/unknown stages, truncated logs and other versions fail closed. Its result is always labelled `SDK_348_OFFLINE_CHECK_ONLY`; even a complete pass cannot establish signed-properties binding or authorize issuance. Existing legacy 3.0.8 interpretation remains unchanged.

The SDK-package identification/review gate now has concrete 3.4.8 evidence. **Runtime simplified SDK compatibility remains failed**, and full ZATCA acceptance remains open. Next requires reconciling the published security requirements and the SDK signature/profile expectations while preserving signed-property integrity, then using authorized FATOORA Simulation with a certificate actually matching the signing key, approved identity/trust/path/revocation/policy evidence, and actual reporting/clearance through the authenticated application lifecycle. The earlier Developer Portal test certificate mismatch is separate and is not fixed by this SDK upload. Do not call the twenty diagnostic outcomes twenty production acceptances or sum overlapping CI suites.

No new hosted QA deployment, main merge, Production activation, environment/auth/domain change, persistent database migration or cloud resource occurred in this review. Shared QA V2 and the current production release were untouched.

## Follow-up: isolate the signed bytes from XML/QR serialization

The original application output failed several SDK stages simultaneously. A new offline differential changes only the ECDSA signed message and the corresponding signature/QR value in the otherwise SDK-compatible synthetic serialization. It does **not** modify the application signer, SDK executable, schemas or authority rules. `scripts/zatca/verify-simplified-binding-sdk348.mjs` reproduces twelve comparisons using temporary synthetic root/leaf keys, all three SIMPLIFIED document kinds, the exact pinned JAR and the strict six-stage interpreter. It also invokes the official SDK signer itself using those same synthetic credentials; neither the SDK's bundled key nor a taxpayer credential is used.

| Profile, across invoice / credit note / debit note | SDK result | Independent Node ECDSA result |
| --- | --- | --- |
| Existing synthetic compatibility control | All six stages PASS | Verifies over decoded invoice-hash bytes; fails over canonical SignedInfo |
| Changed SigningTime and recomputed serialized-properties digest, without re-signing | All six stages PASS | Original signature and invoice hash unchanged; canonical SignedInfo changed |
| Same serialization, ECDSA over canonical SignedInfo, QR tag7 updated to match | XSD/EN/KSA/QR/PIH PASS; only SIGNATURE fails with `signatureValue` | Verifies over canonical SignedInfo; fails over decoded invoice-hash bytes |
| Output produced by the official SDK signing command | All six stages PASS | Verifies over that returned document's invoice-hash bytes; fails over canonical SignedInfo |

Three additional independent negative controls change the properties/reference of the SignedInfo-signed variant while retaining its signature/QR bytes; all reject. The SDK signer reformats XML, so its returned invoice hash is checked against its **own** embedded reference, not assumed equal to the pre-sign input's hash. Independently computed hashes match the embedded invoice reference for all twelve files. Machine-readable observations: `docs/zatca-sdk348-binding-evidence-20261119.json`.

This isolates a signed-message interoperability difference after XML, QR and business-rule checks pass. The controlled variant is **not** a complete XAdES-conformant candidate: it deliberately retains the compatibility profile's other serialization/reference conventions to vary a single factor. A valid ECDSA over SignedInfo alone does not establish correct references, CA trust, policy, revocation or authority acceptance. The tamper outcome applies only to this pinned **offline SDK** and synthetic fixtures; it is not evidence of a live-gateway vulnerability. No real-company simplified invoice or new authority request was made.

Security Features Standard v1.2 section2.3.3 places the SignedProperties reference digest in SignedInfo so it is signed when SignedInfo is signed. The separate authority signing-process instructions describe signing the generated invoice hash. The observed SDK behavior follows the latter procedure. This unresolved difference must not be hidden by silently replacing the application signer with the synthetic compatibility helper. Resolve the accepted secure profile before submitting the three real Simulation SIMPLIFIED samples; a passing SDK control alone cannot close that gate.

Reproduce from the repository root with the already downloaded official SDK and its locally resolved configuration:

```sh
node scripts/zatca/verify-simplified-binding-sdk348.mjs \
  --java /absolute/path/to/java \
  --jar /absolute/path/to/zatca-einvoicing-sdk-238-R3.4.8.jar \
  --sdk-config /absolute/path/to/sdk-config.json
```

The command outputs sanitized JSON, exits nonzero unless the complete expected differential and negative controls reproduce, and removes temporary keys/XML/configuration in `finally`. Java child processes receive only PATH/LANG/SDK_CONFIG. This manual SDK check is not run by CI without the supplied SDK artifact; normal CI still checks runtime boundaries and native XML signatures.

## Actual onboarding progress superseding the earlier access blocker

On 2026-11-19, isolated hosted candidate `89dcbca0854cfffbfc5dc1153e98e75297ce7dc9` preserved the owner-issued interim CCSID and completed the three STANDARD invoice/credit/debit compliance checks against the Simulation gateway: HTTP200/PASS, zero errors/warnings, retained after browser reload and independent API recovery. Evidence is recorded in PR445 and Issue426. This is **3/6 onboarding compliance cases**, not reporting/clearance, final-CSID activation or Production release.

The interim credential's identity/key/time preflight passed while `trustVerified:false` and `activationAllowed:false` remained. The authority's onboarding sequence uses CCSID during compliance; the CA-issued final CSID follows successful required checks. Final path/revocation/native packaging and private authenticated application lifecycle acceptance remain separate gates. A new OTP or repeated original CSR request does not fix the SIMPLIFIED signed-message difference. This offline follow-up makes no new deployment or changes to the existing hosted result.

References:
- https://zatca1.discourse.group/t/signing-process/354
- https://zatca1.discourse.group/t/error-in-simplified-invoice-report-signed-properties-hashing-issue/6028
- https://zatca1.discourse.group/t/onboarding-and-renewal/480
- https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf
- https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20220624_ZATCA_Electronic_Invoice_XML_Implementation_Standard_vF.pdf
- https://sandbox.zatca.gov.sa/downloadSDK
- https://docs.aws.amazon.com/corretto/latest/corretto-11-ug/downloads-list.html
