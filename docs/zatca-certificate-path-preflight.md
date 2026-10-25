# Configured certificate-path and CRL preflight — 2026-10-25

`lib/zatca-certificate-path.ts` adds an offline backend preparation primitive, `verifyZatcaCertificatePath`. It returns `CERTIFICATE_PATH_CHECK_ONLY`, never a certificate activation/authority approval or reusable authorization grant. No live route, onboarding writer, stored-signer closure or database migration invokes it yet.

## Trust boundary

The caller supplies a saved leaf pin and complete ordered issuer chain ending at a root. The separate `ZATCA_CERTIFICATE_TRUST_V1` configuration must come from protected server deployment configuration, with the expected environment and exact DER/SHA256 pins of independently approved roots. A certificate response or request body is **not** a source of trust anchors. There are no built-in or guessed ZATCA roots and no system-store fallback. Real environment-specific CA/CRL onboarding and ownership of their refresh remain integration gates.

The primitive accepts bounded canonical base64 DER only. It rejects trailing certificate bytes, duplicate chain certificates/anchors/CRLs, incorrect pins, a CA as the leaf, incompatible secp256k1 leaf keys, invalid leaf dates, mismatched environments, incomplete/reversed/broken issuer links and roots not present in configured trust. Ordered issuer signatures are independently checked using Node before OpenSSL validation. The leaf requires a critical KeyUsage containing digitalSignature (and excluding keyCertSign), plus explicit clientAuth EKU. Node's `X509Certificate.keyUsage` is an **extended** key-usage list; a bounded DER reader checks actual KeyUsage rather than mistaking the two fields.

The supported signature-algorithm subset is explicit: ECDSA/SHA256 for the leaf; ECDSA or RSA PKCS#1 signatures with SHA256/384/512 for CA certificates and CRLs. SHA1 and algorithms outside that subset, including currently unsupported RSA-PSS parameters, fail closed. This is a deliberately bounded supported profile, not a claim to support every otherwise valid CA certificate. A negative synthetic ECDSA/SHA1 fixture showed why this explicit restriction is needed rather than assuming `-auth_level 2` alone covers it in every available OpenSSL build.

## Native verification and lifecycle

Requires **Linux `/usr/bin/openssl` 3.x** installed in the isolated backend image. The existing Next.js/Vercel/Hostinger runtime has not been certified or packaged for this dependency; do not wire it into live routes until packaging is verified. No shell, executable/path overrides, URL fetching, AIA fetching or CRL download flags are used. Missing/unsupported engine, invalid evidence or unavailable CRLs reject the check.

The verifier creates a private temporary directory and public-material files (0700/0600), then runs fixed arguments:

- `-no-CAfile -no-CApath -no-CAstore -trusted <selected-pinned-root>`
- `-x509_strict -check_ss_sig -auth_level 2 -purpose sslclient -verify_depth 5`
- `-attime <captured-time> -crl_check_all -CRLfile <supplied-CRLs>`
- Explicit untrusted intermediates only when present.

OpenSSL verifies path constraints, critical extensions, signing purpose, validity and signed CRLs for the complete chain at the captured time. Missing issuer CRLs, expired/not-yet-valid CRLs, corrupt signatures and revoked leaf/intermediate certificates reject the result. This implementation does not use OCSP, delta-CRL retrieval or network access; deployments requiring another revocation mechanism need a separately reviewed adapter. Do not treat this result as current indefinitely: a future backend must load fresh evidence and recheck at onboarding/signing/finalization, with authorization and registry state held consistently. The check is point-in-time and cannot atomically lock remote revocation changes.

Files are removed in `finally` after success/failure. Input/config arrays and evaluation time are captured before asynchronous work. Native stderr, stdout, temporary paths, certificate subject contents and causes are not returned in errors. The result exposes only environment, checked time, engine version and public-material fingerprint evidence. No keys/passwords/tokens are involved.

## Evidence and remaining gates

36 tests generate an ephemeral root, intermediate, leaves and real signed CRLs through native OpenSSL. They exercise successful complete-chain checking; leaf and intermediate revocation; missing, future, expired, corrupt and malformed CRLs; weak certificate algorithms; wrong/missing EKU and digital-signature usage; unknown critical extensions; path-length/name constraints; expired intermediate; broken/missing/reordered issuer links; scope/pin/anchor mismatches; bounded canonical encodings, async capture and filesystem cleanup. No AWS/authority transport is mocked into a claim of acceptance: these are actual native checks over synthetic material, not ZATCA-issued certificates.

Still required: verified environment-specific CA provisioning and CRL refresh, exact VAT/EGS/CSR identity/profile and certificate-policy mapping, a production onboarding writer capturing actual AWS VersionId and approved material, integration of fresh path evidence with the registry-aware backend, deployment packaging, actual AWS/IAM and current SDK/simulation acceptance. The existing CSR's SAN UID/title layout and the published subject organizationIdentifier/businessCategory description must be reconciled against the current authority profile/response; this change deliberately does not silently rewrite the live CSR or guess alternative identity fields.

Primary references:

- [OpenSSL verification options](https://docs.openssl.org/3.0/man1/openssl-verification-options/)
- [OpenSSL verify](https://docs.openssl.org/3.0/man1/openssl-verify/)
- [OpenSSL CA/CRL fixture generation](https://docs.openssl.org/3.0/man1/openssl-ca/)
- [Node X509Certificate](https://nodejs.org/docs/latest-v22.x/api/crypto.html#class-x509certificate)
- [ZATCA security features v1.2, 19 May 2023](https://www.zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf)
