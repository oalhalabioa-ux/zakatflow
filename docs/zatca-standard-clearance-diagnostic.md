# STANDARD Simulation clearance diagnostic

This is the next isolated protocol check after six saved compliance passes and a separately quarantined final Simulation CSID. It is **not** application acceptance, signature-profile approval, certificate-path validation or Production activation. No reporting, local invoice stamp, accounting/SQL mutation, new CSR/OTP/certificate request or other-device operation is implemented here.

The default-off server flag is `FATOORA_QA_STANDARD_CLEARANCE_EXPERIMENT=enabled`. It also requires the existing final-CSID/procedural gates and1100 unit. The fixed protected Preview target, Vercel SSO, exact OIDC project/role/key/region and private configuration remain mandatory. No HTTP caller can set the gate, taxpayer identity, final credentials, XML, previous hash, destination or certificate.

## Fresh artifacts and final credentials

The backend revalidates both complete compliance suites, immutable original CSR/interim response, saved final-CSID intent/response, CSR identity, current key and certificate time. A backend-only closure releases the saved final token/secret for this diagnostic; it is never included in status/HTTP. This does not insert a signer registry entry or establish CA trust. The interim credential is never substituted for the final one.

Three new unsigned STANDARD documents use the shared application XML/hash builders, distinct UUIDs and invoice numbers, and counters7–9. The first previous-invoice hash links to the sixth saved compliance artifact; the remaining two link in sequence. They are not reused or patched compliance documents. Each synthetic invoice/credit/debit note totals1.15SAR, uses the privately configured seller identity/address and an explicitly synthetic buyer/item. Notes reference the newly generated diagnostic invoice. All originals remain encrypted in a new create-only namespace; old records are not migrated, overwritten or re-signed.

## Dispatch, response and recovery

Preparation sends nothing to the authority and performs no KMS Sign. Each explicit submit binds the complete manifest digest and index, proves the existing create-only storage fence and claims a unique immutable intent before one POST. The fixed URL is `https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/clearance/single`, with V2, JSON, `Clearance-Status:1` and the saved final Basic credentials. Redirects are refused. One20-second abort controller covers response headers and the bounded48KB body; no automatic retry exists.

The bounded raw response is stored encrypted before parsing or checking the returned document. HTTP, JSON, business-validation or document-binding failure cannot erase the saved response or make the sample retry-ready. Lost claims/unknown transport outcomes stay reconciliation-required; saved responses with lost acknowledgements recover read-only. Concurrent workers can dispatch at most once per artifact. A failed/uncertain predecessor blocks the next sample.

`protocolPassed` requires HTTP200, validation PASS, zero error/warning messages, CLEARED, a canonical Base64/UTF-8 returned XML, the identical transformed invoice hash/UUID, one stamp structure with a nonempty signature/certificate and one nonempty QR within700 characters. The existing hardened shared XML parser/hash builder rejects unsafe declarations, DTD/entities, nested invoices and changed financial content. Full returned XML, authority messages and credentials are excluded from status/UI.

**These checks do not cryptographically validate the returned authority signature, its certificate chain or QR content.** `authorityStampVerified:false`, `trustVerified:false`, `applicationProfileApproved:false`, `activationAllowed:false` remain, even for a matched CLEARED response. No REPORTED result or complete application acceptance is claimed. Independent authority-stamp validation, secure application profile, official chain/revocation/policy configuration, native runtime and authenticated tenant lifecycle remain separate release gates.

## Verification

`tests/zatca-simulation-qa-clearance.test.ts` covers real shared XML/hash generation, continuation, byte-identical request binding, private result persistence before validation, changed original/final/key context, caller overrides, missing/changed returned content/UUID/stamp, malformed Base64/UTF-8/JSON/DTD, warnings, unexpected HTTP/disposition, concurrent claims, lost acknowledgements, private-error redaction, no replay and a hanging body deadline. The complete synthetic CSR-to-final integration also exercises all three clearance samples without new signing or modification of earlier records. HTTP/UI/bundle/import-boundary tests cover the new actions, default-off gate and GET-only recovery.

These tests use synthetic certificates and mocked authority/AWS transports. Their outcome is not hosted authority acceptance. Actual deployment/request/readback evidence must be recorded in PR445 and Issue426; this document alone does not assert any new request occurred.

Primary references:
- FATOORA Portal User Manual v3, Simulation API endpoints: https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/Fatoora_Portal_User_Manual_English.pdf
- Final CSID use for reporting/clearance: https://zatca1.discourse.group/t/onboarding-and-renewal/480
- CCSID versus final PCSID and re-signing simplified delivery documents: https://zatca1.discourse.group/t/error-in-simplified-invoice-report-signed-properties-hashing-issue/6028
