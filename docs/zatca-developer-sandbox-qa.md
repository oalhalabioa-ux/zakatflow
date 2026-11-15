# ZATCA Developer Sandbox QA — 2026-11-15

This records a synthetic test of the Phase 2 branch. It does not activate invoicing, establish taxpayer onboarding, or grant clearance/reporting acceptance.

## Local document and signing checks

The Java SDK reported version **3.4.5**. The [official download page](https://zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox/Pages/DownloadSDK.aspx) was available, but its archive download returned HTTP 403 from this runner. For this diagnostic, the SDK JAR and its bundled rules were taken from the public `lavaloon-eg/zatca-cli` mirror at `8478de3dce8ad7a8e254089a6fc5e8483d594deb` (JAR SHA-256 `681b5250559e8b787fe1299998aa511c90abd6a45680d3ba283dc32078a29940`). This is neither authentication of the archive by ZATCA nor a test of the current official distribution. The JAR ran offline with Corretto 11 and no project credentials or bundled signing key.

| Application-generated synthetic documents | Result |
| --- | --- |
| Standard invoice, credit note, debit note, discount and USD with SAR VAT total | 5 global passes |
| Standard invoice with both standard-rate and exempt lines | Initially `BR-KSA-CL-05`; global pass after rendering the prescribed reason for the selected category E code |
| Simplified invoice, credit note, debit note without stamp or QR | Schema and EN passed; global failed, as expected |
| Same three simplified document types with the app's experimental XAdES and QR | EN, KSA and prior hash passed; XSD, QR and signature failed |

The SDK and application calculated identical invoice hashes on all 12 artifacts, signed and unsigned. The SDK explicitly rejected `SigningCertificateV2` in the current application output. It also found different encodings/signature values in the QR and signature properties. As a control, the **same simplified input and same locally generated key and certificate** signed by the SDK passed every stage offline. This isolates a signature/QR profile difference, not a failure of AWS signing or financial fields. In the control, ECDSA verified against SHA-256 of the decoded invoice hash, and QR tags 6 and 7 stored Base64 text. These observations describe this specific SDK, not a replacement for the [authority security standard](https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf). Keep the existing preparation-only profile gated until a separate profile passes the official SDK and appropriate sandbox checks. Do not change the validated source payload or bypass certificate checks to get a pass.

## Live developer endpoint

The [standard-invoice preview](https://yaqeen-fatoora-qnauqumks-oalhalabioa-9334.vercel.app) and [mixed-VAT preview](https://yaqeen-fatoora-65iqvt5on-oalhalabioa-9334.vercel.app) generated CSRs with the QA AWS KMS key via OIDC. The Developer Portal issued compliance CSIDs (HTTP 200) whose public keys matched KMS. With temporary credentials held only in each run's memory, both synthetic standard XML documents submitted to **`/developer-portal/compliance/invoices` returned HTTP 200 and `validationResults.status=PASS`**, with no errors or warnings. The second document used the fixed exempt-reason exporter and its own invoice UUID. There was no official production request.

Reporting and clearance remain separate gates. A prior **Developer Portal** test returned HTTP 200 for `/production/csids`, but the output certificate did not match the QA key. That credential was not used to sign or submit a document. Follow the [Developer Portal guide](https://sandbox.zatca.gov.sa/User_Manual_Developer_Portal_Manual_Version_3.pdf) for isolated reporting and clearance examples and keep test credentials separate from real FATOORA onboarding.

Before enabling anything on the live domain: validate the simplified signer against the current official SDK; get matching test artifacts and verify the reporting and clearance outcomes separately; then run FATOORA Simulation for an authorized organization, using its own approved key and certificate, before any production release.
