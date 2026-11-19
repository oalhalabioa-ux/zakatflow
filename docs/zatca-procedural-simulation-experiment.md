# Isolated procedural-profile Simulation experiment

This is a protocol experiment under the owner's continuing authorization to complete ZATCA Simulation testing. It is not an alternative application signer, a production profile or a conclusion that the published XAdES requirements have been reconciled. The application XAdES signer, its independent SignedInfo/property tamper checks and its QR700 limit remain unchanged. The synthetic compatibility helper remains excluded from backend/application code.

## Why a separate experiment

The pinned SDK3.4.8 differential isolates the signed-message disagreement: its compatible serialization passes XML/QR/business rules, but a canonical-SignedInfo signature fails its signature checker; its own signer signs decoded invoice-hash bytes. The authority's procedural instructions explicitly describe the invoice-hash signing sequence and using the interim CCSID for simplified compliance samples. The normative Security Standard instead describes SignedInfo/property binding and a700-character QR bound. Neither a sandbox PASS nor this experiment resolves the signed-message normative difference.

The earlier blanket deferral of real Simulation SIMPLIFIED samples is narrowed **only for this bounded, explicitly labelled procedural experiment**. Ordinary runtime compliance/issuance acceptance remains blocked. Its purpose is to establish actual gateway behavior with the preserved owner-issued interim certificate and non-exportable key, while retaining independent private integrity evidence. It does not import the synthetic helper, fabricate a trust chain, approve the application profile or trigger final-CSID/reporting/clearance APIs.

## Fixed scope and integrity

- Available only inside the already isolated, SSO-protected `yaqeen-fatoora-qa` Preview harness, using its existing exact OIDC/STS role/key/region checks. Opt-in requires protected Preview config `FATOORA_QA_SIMPLIFIED_PROCEDURAL_EXPERIMENT=enabled`; disabled by default. Shared QA V2 and Production are excluded.
- Saved functionality must be1100. All three STANDARD results and their original artifacts/intents must validate before preparation. Counters4–6 and the first PIH continue that diagnostic chain; these are not accounting counters or financial records.
- Re-read the unchanged original CSR and encrypted CCSID receipt, verify saved taxpayer/unit identity, current time/curve, and current KMS SPKI on every operation. This narrow serializer additionally requires the observed interim issuer `CN=eInvoicing`; it has no general DN formatter or invented issuer trust.
- Generate three fixed synthetic1SAR+VAT samples with the saved seller identity/address, distinct UUIDs and correct credit/debit references. No caller XML, certificate, credential, key, endpoint, company, OTP or profile override.
- KMS signs each invoice hash for the procedural representation, and separately signs a domain-separated receipt containing the complete emitted XML hash, invoice hash, saved context digest and certificate fingerprint. The receipt is private external integrity evidence, **not embedded XMLDSig conformity**. Local ECDSA verification is mandatory for both signatures.
- Persist one immutable encrypted suite including exact XML/signatures/receipts. Rebuild and verify against stored signatures on every read; recovery/submit never signs again. Context/profile/response/standard-link changes fail closed. Create-only intent/result fences bind each artifact to one fixed Simulation `/compliance/invoices` request; unknown outcomes are read/reconciled without automatic resend.
- Preserve the complete seller name and the published QR700 limit. Actual generation with a73-byte synthetic Arabic name fits the bound; an oversized200-byte name is rejected before storage or transport rather than shortened. Per-artifact QR lengths are recorded. A compressed-SPKI local differential failed the SDK's `publicKey` check, so the exact certificate SPKI is retained.

## Acceptance boundaries

Returned state is `SIMPLIFIED_PROCEDURAL_PROFILE_QA_ONLY`, with `applicationProfileApproved:false` and `activationAllowed:false` regardless of gateway outcome. `privateIntegrityVerified:true` means the external receipt was checked; it does not establish XMLDSig, CA/path/revocation/policy trust. A PASS requires HTTP200, validation PASS and no errors/warnings, and is attributed only to this experiment.

The original CCSID remains quarantined with trust/activation false. No final CSID, renewal, Production API, financial posting, SQL/Auth migration or automatic promotion is implemented. Complete runtime acceptance still requires an authority-accepted secure profile, final certificate checks, native packaging and authenticated tenant application lifecycle validation.

## Validation

`scripts/zatca/verify-procedural-simplified-sdk348.mjs` builds the actual new factory and validates three newly generated synthetic artifacts using the owner-supplied pinned official JAR, fresh temporary synthetic issuer/leaf keys and its own local configuration. It supplies that synthetic certificate to the SDK validator and no private key to validation; it deletes temporary material. It never contacts AWS or the authority. Longer Arabic names are covered rather than replacing the saved taxpayer name for the live experiment.

Unit/integration tests cover both signatures, changed properties/scope with retained receipts, pin/key failures, the default-off gate, completed STANDARD prerequisite, immutable original/response/standard storage, no re-signing/re-send after recovery, concurrent intent claiming, lost acknowledgements, strict HTTP inputs, read-only UI recovery and application import boundaries. Actual hosted acceptance must be recorded separately after exact-head CI and one coordinated Preview; local checks are not a deployment.

References:

- https://zatca1.discourse.group/t/signing-process/354
- https://zatca1.discourse.group/t/error-in-simplified-invoice-report-signed-properties-hashing-issue/6028
- https://zatca1.discourse.group/t/onboarding-and-renewal/480
- https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf
