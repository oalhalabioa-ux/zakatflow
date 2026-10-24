# Experimental Phase 2 ledger storage contract

This is an isolated, owner-only PostgreSQL QA contract, not an application feature, migration or public RPC. The SQL lives under `tests/fixtures/` deliberately; do not copy it into deployment migrations or grant application access before the integration gates below are complete.

## Storage behavior verified

- A unit is identified by organization, environment and EGS unit UUID. Sales/purchase invoice numbering and financial recognition are separate.
- `reserve` locks that unit's head row and stores document UUID, invoice UUID, the complete caller-provided JSON snapshot, its PostgreSQL-generated SHA-256 fingerprint, next counter and prior hash. JSON key order does not create a different reservation. The first previous hash uses the exact BR-KSA-26 constant (base64 of the hexadecimal SHA-256 of `0`); subsequent hashes are canonical base64 SHA-256 binary digests supplied by the future verifier.
- One reservation per unit may remain pending. The database transaction ends before any external signing/network work. A different document on that same unit receives `UNIT_RESERVATION_PENDING`; a matching retry returns the same reservation. Other units/organizations/environments have separate heads.
- `finalize` locks the same head and reservation, compares the saved snapshot fingerprint, and saves the exact prepared XML bytes and supplied invoice hash while advancing the head in the same transaction. Concurrent exact retries return the saved result. Changed artifacts are rejected, including independently valid but byte-different ECDSA signatures: the durable winner must be loaded and reused.
- Reservation identity/snapshot fields cannot change; prepared rows cannot be updated or deleted through ordinary DML. Unique document, UUID and unit-counter constraints supplement row locks. Pending work has no automatic expiry, cancellation or number reuse.
- `PREPARED` is only a storage state. Authority acceptance/rejection never follows from it. A transport failure does not authorize regenerating an invoice, rolling back its chain entry or recycling its number.

## Deliberate boundaries and required integration

The test fixture accepts an opaque JSON snapshot and opaque XML string. Its fingerprint is **not** an XML invoice hash, financial validation or signature verification. The SQL validates only hash encoding and bounded artifact size. It cannot prove that supplied XML/hash correspond to the snapshot or reservation. The tests intentionally use synthetic non-UBL storage payloads so their result cannot be mistaken for cryptographic/authority compliance.

Before a real caller or migration exists:

1. Bind each unit to an authorized saved onboarding connection, organization, environment, certificate and key. Add reviewed foreign keys and deletion/retention semantics; the experimental fixture has no references to live business tables. Establish a least-privilege authenticated backend boundary and tenant authorization. There are currently no application grants or RLS policies; schema/tables/functions deny PUBLIC access, tables enable RLS, and functions use SECURITY INVOKER. Owner-only QA is not a completed application authorization design.
2. Load and validate the complete saved invoice DTO and required XML context under authorization. Freeze all amounts, FX, tax lines, original invoice references and supplier/buyer identity. Serialize database bigint counters as decimal strings at the adapter boundary to avoid JavaScript integer precision loss. Persist a versioned canonical snapshot contract; the current PostgreSQL JSONB fingerprint is internal storage comparison only.
3. Generate/verify XML strictly from the saved snapshot plus allocated UUID/counter/previous hash. Independently recompute C14N invoice hash, check reference identity, financial totals, certificate/profile/identity/trust/revocation and signature before allowing finalization. The signing service must not accept arbitrary client XML or hash.
4. Resolve process/network failures by reading the durable reservation/artifact. Do not hold a database transaction over KMS or HTTP; do not clear a stale reservation or change its snapshot automatically. Multiple workers may sign the same reservation; only one exact artifact wins and the loser must reuse it. A durable worker ownership/recovery protocol and operational audit remain to be implemented.
5. Separate local artifact persistence, standard clearance and simplified reporting in an append-only submission/audit model. Finalized local chain entries must not be rewritten on authority rejection. Validate the exact standard-cleared artifact/QR handling and rejection/correction rules against the current SDK and simulation before deciding the production chain advancement policy.
6. Generate a reviewed migration with Supabase tooling, run advisors and permission tests, then exercise actual Supabase QA → signing → submission → recovery. The disposable fixture and its passing tests do not satisfy these gates.

## Reproduce storage QA

Use a new empty database named `zatca_ledger_qa` on a disposable local PostgreSQL instance. Set standard libpq environment variables and run:

```sh
ZATCA_LEDGER_DISPOSABLE_QA=1 PGDATABASE=zatca_ledger_qa python3 tests/zatca-ledger-postgres.py
```

The runner refuses another database name and does not drop schemas or databases. Use a new empty database for every run. It creates only synthetic units/documents and an unprivileged test role. The CI job provisions its own PostgreSQL container, independent of all Supabase QA/production credentials.

17 tests passed on PostgreSQL 15.18: initial hash/snapshot identity; identity conflicts; pending/partition isolation; exact finalization and old retries; digest/artifact conflicts; transaction rollback; tenant/unknown-unit isolation; immutable rows; JSON key-order equivalence; head-conflict rejection; one winner for competing artifacts; invalid inputs/overflow; duplicate UUIDs; 16 simultaneous matching retries; 16 competing documents; 12 simultaneous finalizations; permissions/RLS/function security posture.

References:
- [PostgreSQL explicit row locking](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)
- [ZATCA XML Implementation Standard v1.2, BR-KSA-26/33/34/61](https://www.zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20220624_ZATCA_Electronic_Invoice_XML_Implementation_Standard_vF.pdf)

## Saved-document binding follow-up — 2026-10-24

`lib/zatca-reserved-preparation.ts` now provides isolated versioned DTO and signing binding primitives. Snapshot creation accepts only a DRAFT, requires document/UUID/organization/connection identity and explicit saved totals/ordered line amounts, and compares every saved monetary field with the existing Decimal calculator before UBL validation. It rejects caller-supplied chain fields, unsupported line fields and inconsistent data before reserving. Saved currency/FX/document type/country and line tax/unit/discount fields must be explicit; form defaults cannot fill gaps at this boundary. Context must include supplier identifier, supply date and payment means; note references follow the strict UBL builder.

After a trusted reservation is loaded, preparation checks both its metadata and snapshot scope against a separately trusted expected scope. It rejects finalized records or caller XML, requires exact counter text through PostgreSQL bigint maximum, and takes UUID/counter/PIH from that reservation. It captures mutable inputs before awaiting, constructs the entire signed artifact with the existing verified signer, and compares final C14N invoice hash with the expected unsigned snapshot hash. The returned private finalization arguments preserve the database reservation ID/fingerprint and exact generated XML/hash. No finalization write or authority request occurs in the module.

The PostgreSQL snapshot fingerprint is forwarded from trusted storage; this primitive does not authenticate arbitrary client-provided reservations, approve unit certificates/roots/policies or establish tenant permission. The full saved-source loading/freezing transaction, authorized connection/unit identity binding, private backend adapter, current SDK/profile acceptance and durable worker/submission recovery remain open gates above. Source totals and line amounts must be read consistently from the database and mapped explicitly into the versioned DTO; do not substitute a browser draft or silently recompute persisted totals to force agreement.

A real disposable PostgreSQL test now reads its JSONB reservation (bigint explicitly cast to text), prepares/signs using an ephemeral synthetic CA/leaf, independently verifies with XMLSec, finalizes through the SQL contract, retries the exact artifact and verifies the next reservation's counter/PIH. This checks the storage/preparation boundary, **not** actual Supabase authorization or ZATCA acceptance. CI enables this one test with `ZATCA_LEDGER_SQL_QA=1` after the 17 storage tests. Ordinary test runs skip it without that opt-in; native signature checks additionally require `ZATCA_NATIVE_XMLSEC=1`. The test uses synthetic saved DTOs and no business records, credentials or real cloud signing calls.

## Verified-session access preflight — 2026-10-24

`checkZatcaPhaseTwoPreparationAccess` now uses the existing server-session helper (`auth.getUser`) and actual organization-access helper to require an active OWNER or ADMIN before reading invoice metadata. Its strict target contains only organization, document and environment. It loads the connection from the saved draft, checks both returned row identities in addition to scoped query filters, requires simulation COMPLIANCE_PASSED or production CONNECTED for business-invoice eligibility, matches seller VAT and supported standard/simplified invoice types, and selects no credential/key/certificate fields. This readiness check does not replace or block the separate initial compliance-fixture onboarding workflow.

The current database connection represents one EGS per organization/environment, so the connection primary key supplies both connectionId and unitId. The production schema has no separate saved multi-EGS registry; do not accept a client-selected arbitrary unit ID. A future multi-EGS schema needs an explicit reviewed mapping. This service has no production caller or HTTP route, and makes no database writes.

The return stage is ACCESS_CHECK_ONLY. Separate session/membership/invoice/connection reads are a point-in-time preflight, not a transferable authorization grant or source lock. Do not sign/finalize merely because a caller presents this returned object. Membership, connection readiness, source identity and immutable saved data must be rechecked under the atomic source-freeze/reservation boundary, followed by fresh trust/certificate/revocation checks at signing. The current signing binding primitive still requires a trusted adapter to supply expected scope and saved reservation. Actual Supabase authenticated/RLS tests and concurrency/revocation tests at that write boundary remain open.

33 service tests pass with a mocked server-session helper and mocked query responses; the real membership authorization helper runs. They verify query scoping/order, deny forged user metadata/non-admin/inactive membership, changed source/connection/environment, wrong VAT/category/readiness and unsafe input additions. This does not claim a real user login or live database permission test.
