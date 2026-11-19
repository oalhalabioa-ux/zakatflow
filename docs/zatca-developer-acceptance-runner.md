# Repeatable Developer Portal acceptance diagnostic

Scope: the existing `yaqeen-fatoora-qa` Vercel Preview project and existing scoped KMS key only. This runner is outside application routes, never reads a database, never creates keys/secrets, and never uses the real FATOORA production or Simulation namespace. Its only network destinations are the existing AWS credential/signing services and the fixed authority `/e-invoicing/developer-portal` test API. No automatic HTTP retries are performed.

The runner explicitly requires `--developer-only`, Preview, the exact QA role/key/region, and the exact Vercel issuer/audience/project claims before cloud work. STS verifies the token through the credential provider. It checks KMS metadata and the compliance certificate's actual SPKI against that key. A fresh synthetic CSR uses the documented Developer Portal OTP example, not a real taxpayer OTP. Credentials remain in memory; neither credentials, CSR/certificate, invoice XML nor raw authority messages are published.

Six synthetic scenarios use the strict application UBL builder: standard and simplified invoice, credit note and debit note. Counters and previous hashes form one diagnostic chain. Each result requires HTTP 200, explicit validation PASS, zero errors and zero warnings. A missing or malformed validation response fails closed. The standalone simplified SDK 3.4.5 helper remains synthetic-only; its known signed-properties limitation is not repaired or promoted by this diagnostic.

After all six compliance checks pass, the runner requests the Developer Portal's test `/production/csids` resource. This path is **inside the developer-portal namespace**, not the production environment. Its certificate must match the same key before reporting or clearance is attempted. An unrelated sample certificate blocks both operations. Reporting requires an explicit REPORTED result and clearance an explicit CLEARED result, separately from validation status. Nothing activates an application connection or updates an invoice.

The only published file is `public/acceptance.json`, containing stage, safe rule codes and per-scenario outcomes. `releaseReady` is always false: current official SDK/profile verification, complete certificate identity/trust/revocation and authorized-organization FATOORA Simulation remain separate gates. This diagnostic cannot certify production compliance.

Unit checks cover environment/project/key guards, HTTP-versus-business acceptance, reporting/clearance dispositions, redaction, warning refusal, malformed certificates and actual key mismatch across supported certificate envelopes. Prior passing cryptography/storage checks are retained; no financial source code or schemas are modified.

Authority references:
- https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf (v1.2, sections 2.2.1 and 2.3.3: complete signed content, trust/revocation and signed qualifying properties)
- https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20220624_ZATCA_Electronic_Invoice_XML_Implementation_Standard_vF.pdf (v1.2: document categories, references and financial rules)

One coordinated Preview build is justified to exercise the six-category matrix with the existing QA AWS identity. It must not replace the shared QA V2 alias or trigger a Production deployment. Review the exact source SHA and test results in the associated PR before executing it.
