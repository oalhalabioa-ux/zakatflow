# ZATCA Phase 2 preparation — 2026-10-22

Base production: `906495d1`. This branch is preparation work, not a complete Phase 2 integration or production release.

## Implemented in this branch

- Pure unsigned UBL Invoice XML preparation for standard/simplified invoices, credit notes and debit notes (388/381/383 and 0100000/0200000).
- Reuses the existing Decimal invoice calculation; line discounts remain line allowances and are not deducted again at document level. Group VAT rounding stays consistent with existing saved totals.
- Preserves source currency, separate SAR VAT total, supplied UUID, invoice counter and previous hash. It does not allocate, increment or fabricate chain state.
- Explicit supplier registration identifier, supply date and payment method; buyer identifier required for standard invoices; actual original invoice number and reason required for notes.
- Rejects XML-invalid characters, unsupported top-level inputs (including prepaid amounts), missing exemption reasons, mixed outside-scope categories and conflicting grouped exemption reasons. Existing workflows and financial writers are untouched.

## Validation completed

- TypeScript passed.
- 27 tests passed across XML preparation (16), existing draft calculations (9) and existing CSR signing callback (2).
- Nine generated synthetic documents passed the official OASIS UBL 2.1 Invoice XSD using an independent lxml validator: six document/category combinations, foreign currency, discount and mixed tax categories.
- These are preparation/schema checks, not ZATCA business-rule, cryptographic-signature or authority acceptance results. ZATCA SDK and sandbox compliance remain required.

## Integration boundary

`buildUnsignedZatcaXml` is not imported by any production route. Its output is labelled `UNSIGNED_PREPARATION`; it contains no signature or issuance QR. It must not be submitted or used to mark a document ISSUED/CLEARED/REPORTED. The current Phase 1 issuing flow is unchanged.

Supported preparation scope follows the existing domestic invoice DTO. Exports, advance-payment adjustments, document charges, self-billing and other special transaction indicators are not implemented. They require explicit models and acceptance tests before support is claimed. Invoice unit codes and exemption identifiers still require ZATCA SDK/business-rule validation.

## Remaining implementation and acceptance gates

1. Atomic per-unit invoice counter/previous-hash chain and immutable invoice snapshot. Keep these distinct from sales/purchase document numbering. Handle simultaneous issuance, retries and rejected submissions.
2. Canonicalization, SHA-256 invoice hash, certificate-bound XAdES signature and Phase 2 QR. Verify signatures and certificate/key matching independently.
3. Wire saved invoice snapshots to the preparation component, including supplier registration identity, actual supply date and original note invoice number. Preserve financial/foreign-currency identity checks.
4. Run the current ZATCA SDK and compliance scenarios for each supported standard/simplified invoice/note category. Reject unsupported inputs rather than silently changing financial meaning.
5. Simulation certificate onboarding and authenticated compliance submissions; persist sanitized authority responses and retry state.
6. Production CSID onboarding, standard clearance and simplified reporting, only after simulation gates pass. Distinguish local issuance from authority acceptance in UI and records.
7. End-to-end QA: tenant permissions, non-duplication of recognition/payment, exact accounting/UBL totals, transport retries, rejected invoices and audit/recovery.

## Inputs required from the owner

- Identify the VAT-registered legal entity/branch to use for simulation and confirm its official legal name, registration identity, VAT number and address in the application. Do not populate those fields with another organization's data.
- The existing onboarding code uses AWS KMS (secp256k1) and Secrets Manager via a Vercel OIDC role. QA currently has no AWS_REGION or AWS_ROLE_ARN configuration. A suitable AWS account/administrator connection is needed before live onboarding. No AWS resources were created or charged by this work.
- Obtain an OTP from the appropriate Fatoora simulation onboarding flow only when the unit/key are ready, and enter it through the application's setup form. Do not send passwords, OTPs, private keys or cloud access keys in chat.
- Hostinger and Vercel are separate deployment targets; the existing AWS credential adapter uses Vercel OIDC. Hostinger signing credentials require a deliberate supported identity arrangement before the same signer can be claimed operational there.

## Primary references used

- ZATCA XML Implementation Standard v1.2 (19 May 2023): https://www.zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20220624_ZATCA_Electronic_Invoice_XML_Implementation_Standard_vF.pdf
- ZATCA Security Features Implementation Standards: https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf
- Official validation toolbox: https://www.zatca.gov.sa/en/E-Invoicing/SystemsDevelopers/ComplianceEnablementToolbox/Pages/DownloadSDK.aspx
- OASIS UBL 2.1 XSD distribution: https://docs.oasis-open.org/ubl/os-UBL-2.1/UBL-2.1.zip

Validation fixtures/schemas and browser/cloud credentials are not committed. No production invoice or schema was changed.
