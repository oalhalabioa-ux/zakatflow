# Uploaded Java SDK 3.0.8 review — 2026-10-22

Archive supplied by owner: `zatca-envoice-sdk-203.zip`.
Archive SHA-256: `1a7df6d91fd34968ad59a97087f637f56504fdf92c42050916b838be20fc5ae3`.
Both CLI/runtime JAR filenames and the runtime banner identify version **3.0.8**. The included KSA rule filename is dated 2021-08-19. This is not evidence that this is the current authority-supported release.

Extracted into an isolated directory after checking archive paths. Adjusted only the local configuration's Windows file paths to the extracted Linux paths. Used installed OpenJDK 17. SDK help, invoice validation and invoice-hash generation ran; this does not establish all signing/CSR operations are compatible with Java 17. No installer, network submission, production data, bundled private key or bundled certificate was used for signing/onboarding. No SDK binaries or bundled keys are committed to the repository.

## Observed results on nine existing unsigned synthetic fixtures

| Fixture group | XSD | EN rules | KSA rules / global |
|---|---|---|---|
| Standard invoice, credit note, debit note | Pass | Pass | Fail: BR-KSA-63, BR-KSA-10, BR-KSA-65 |
| Foreign currency and discount | Pass | Pass | Same address-rule failures |
| Simplified invoice, credit note, debit note | Pass | Pass | Fail: BR-KSA-60 (stamp), BR-KSA-27 (QR) |
| Mixed standard-rate and exempt categories | Pass | Fail: BR-S-10 | KSA phase not reached; global fail |

**No fixture achieved a global SDK validation pass.** These are unsigned preparation fixtures; the simplified stamp/QR failures are expected incomplete integration, not authority rejections or successful compliance.

All **nine** SDK `-generateHash` outputs matched the application's `prepareZatcaInvoiceHash` output exactly in a separate test against the same synthetic XML files. The earlier XMLSec XAdES tests remain separate cryptographic checks, not SDK passes.

## Rule details and interpretation boundaries

- Standard fixtures omit buyer additional number; the legacy BR-KSA-63 requires it. BR-KSA-10 additionally checks `CountrySubentity` although its displayed message only lists street/city/postal/country. Reconcile these legacy checks against the current authority XML/SDK profile and actual collected address fields before changing the application model. Do not fabricate address values.
- At least one BR-KSA-65 implementation tests the customer's `PlotIdentification` but labels its error as seller additional number. The fixture already has a four-digit seller additional number. Preserve this diagnostic mismatch rather than reporting a proven seller-data defect.
- The bundled EN BR-S-10 condition tests whether any top-level VAT category is S and whether any exemption reason exists anywhere in the document. It therefore rejects the mixed fixture even though the S subtotal has no exemption reason and the E subtotal correctly carries one. This is direct inspection of the supplied rule source; the SDK rule files were not modified and exemption data was not removed to force a pass.
- Separately, the preparation builder now rejects an exemption reason attached directly to an S line. That is contradictory tax data regardless of the legacy rule's overly broad scope. Regression coverage preserves the existing E/Z/O reason behavior; financial calculations and production writers are unchanged.

## Process-result trap and safeguards

The SDK returned process exit code **0** for all nine global validation failures. An exit-code-only CI wrapper would incorrectly pass them. `parseLegacyZatcaSdkValidation` recognizes only the observed 3.0.8 report format and requires one version banner, exactly one pass for each XSD/EN/KSA stage, one global pass, a zero process exit code, and no errors/codes/contradictory failures. Incomplete, interrupted, duplicate or unsupported-version reports fail closed. The result is labelled `LEGACY_SDK_CHECK_ONLY`; it cannot grant authority acceptance or change invoice status.

## Gates that remain

### Follow-up against the published XML standard v1.2 (19 May 2023)

Reviewed the current official specification's BR-KSA-10/63/65: the Saudi buyer mandatory address list does not require the optional additional number or `CountrySubentity`; BR-KSA-65 checks additional-number length if present. Existing preparation fixtures contain the listed mandatory address fields. The legacy package's extra address checks therefore remain legacy-version diagnostics, not a demonstrated need to fabricate missing current mandatory fields. The XML builder preserves buyer additional number when supplied. This specification review is not a replacement for current SDK/simulation acceptance.

Also aligned preparation-context identification with BR-KSA-08/14: seller schemes CRN/MOM/MLS/700/SAG/OTH, buyer TIN support, alphanumeric identifier values. These preparation-only guards do not change production organization/contact records.

Reference: https://www.zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20220624_ZATCA_Electronic_Invoice_XML_Implementation_Standard_vF.pdf

1. Obtain/confirm the current official SDK/profile and reconcile address rules, mixed VAT categories and the XAdES SigningCertificateV2/schema version difference already recorded in the Phase 2 progress document.
2. Complete QR, full certificate trust/profile/identity/revocation checks, approved policy configuration, atomic unit chain and saved-document integration.
3. Run signed documents through the appropriate SDK and live simulation using the configured AWS keys/certificates. No global SDK/compliance/production acceptance is claimed by this review.

Detailed logs and fixtures are transient synthetic validation artifacts, outside the repository. The uploaded SDK remains an owner-provided reference package, not a production dependency.
