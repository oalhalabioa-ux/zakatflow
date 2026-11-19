# Final Simulation CSID diagnostic

This follow-up to the six accepted diagnostic compliance samples requests a final certificate **only in Simulation**. The path includes `/production/csids` because that is the authority's onboarding API name; the fixed environment prefix is `/e-invoicing/simulation/`. It never calls `/core/`, renews a certificate, modifies other devices or enables application invoices.

## Gates and immutable records

The existing isolated, owner-only, SSO-protected Preview harness remains mandatory. The new server-only opt-in is `FATOORA_QA_FINAL_SIMULATION_CSID_EXPERIMENT=enabled`; it is disabled by default and also requires the existing procedural experiment gate and saved1100 functionality. No HTTP parameter can enable either gate.

Before readiness or submission, the backend independently revalidates both three-document suites and their existing intents/results, deterministic artifacts, private integrity signatures, original CSR/CCSID envelope, current certificate identity/time/curve and fresh matching KMS SPKI. A readiness digest binds the original/response/standard/procedural manifests, interim fingerprint and compliance request identifier. Tokens and secrets are excluded from returned state. The client cannot supply an identifier, credential, certificate, endpoint, company or OTP.

Explicit submission first proves create-only storage and claims a new immutable intent with a distinct UUID/token/body. A lost or wrong claim acknowledgement prevents transport. Concurrency cannot reuse an acknowledged old claim to dispatch again. One fixed POST carries the saved compliance request identifier and byte-identical interim Basic authentication with V2/JSON headers. Redirects are refused; a20-second controller covers headers and the complete bounded64KiB response stream. Failures and uncertain outcomes require read-only reconciliation, with no automatic resend or reset.

The normalized issued response (including unmodified token and secret) is saved in a separate encrypted `final-simulation-csid/response` object before certificate checks. Original interim credentials and all six samples stay unchanged. Stored success plus a lost acknowledgement is recovered by GET without another request. A returned certificate that fails parse/identity/current-key/time checks, or is the same interim certificate, remains quarantined with verification required. A certificate preflight success still reports `trustVerified:false`, `applicationProfileApproved:false`, `activationAllowed:false`.

No final credential is exposed to the caller or connected to an application registry/signer. No reporting, clearance, posting, SQL/Auth migration or Production action is implemented here. The external artifact receipt and procedural six-pass result do not resolve the normative application SignedInfo discrepancy. Trust/path/revocation/policy/native-worker packaging and authenticated tenant lifecycle acceptance remain separate gates.

## Read-only final-certificate discovery

After identity/key/time verification, `simulation-certificate-discovery.ts` can inspect the already saved final certificate directly with Node and a bounded DER reader. It needs no OpenSSL executable and sends no network request. Its explicit metadata schema excludes subject/SAN, serial, raw certificate, credential, request ID and secret references. It distinguishes CA-issuer access locations from OCSP responders, reads CRL distribution URIs and policy OIDs, and reports actual KeyUsage criticality/digitalSignature/keyCertSign and clientAuth EKU. Multi-octet OID components and bounded lists are covered by real certificate fixtures and an independent OpenSSL metadata comparison. Non-HTTP, credential-bearing, query-bearing and fragment-bearing URLs are omitted; no URL is automatically followed or trusted.

Discovery does not verify issuer signatures, establish a protected root, apply a certificate policy, fetch/check revocation or approve the application profile. All trust/activation flags remain false. Missing optional discovery must not erase otherwise verified identity or the encrypted response. Old saved envelopes are not migrated or rewritten. This is an additive GET response; it does not replay onboarding or a final-CSID request. The standalone build package now explicitly skips a second framework build with `buildCommand:""`, preventing the prior inferred npm-build packaging failure.

Reference for AIA, certificate policies, KeyUsage/EKU and CRL distribution point structure: RFC5280 sections4.2.1.3,4.2.1.4,4.2.1.12,4.2.1.13,4.2.2.1 (https://www.rfc-editor.org/rfc/rfc5280). These metadata hints are not the section6 certification-path algorithm.

## UI and validation

The fifth diagnostic section is hidden until enabled by private configuration. Its only button requires fresh readiness plus both completed suites. A click error disables submission until a GET refresh; saved/unknown/completed requests cannot be resent. Initial load and refresh remain GET-only.

Regression coverage includes actual synthetic CSR/issuer/certificate/KMS-signature integration through both suites and the final request, default-off gating, original preservation, wrong-key refusal, private response retention, concurrent calls, missing/changed provenance, lost acknowledgements, redaction, malformed/oversized/unsafe-integer responses, a hanging-body deadline, strict HTTP input and UI recovery. Cloud/authority transports in these tests are mocked. Actual hosted evidence must be recorded separately; local tests do not claim issuance or deployment.

Authority explanation of this exact Simulation endpoint, saved requestID, V2 and interim Basic authentication:
https://zatca1.discourse.group/t/i-successfully-onboarded-in-to-simulation-but-the-solution-is-not-getting-listed-in-the-simulation-portal/4530/3

Onboarding sequence:
https://zatca1.discourse.group/t/onboarding-and-renewal/480
