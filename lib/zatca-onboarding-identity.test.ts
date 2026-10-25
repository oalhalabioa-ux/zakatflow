import { createHash, generateKeyPairSync, KeyObject, randomUUID, sign, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createZatcaCsr } from './vat-zatca-csr';
import { Pool } from 'pg';
import { createVerifiedZatcaEnrollmentReader } from '../services/zatca-private-enrollment-reader';
import { inspectZatcaOnboardingIdentity, verifyZatcaOnboardingCandidate } from './zatca-onboarding-identity';

let directory: string, at: Date, key: KeyObject;
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const csrDer = (pem: string) => Buffer.from(pem.replace(/-----[^\n]+-----/g, '').replace(/\s/g, ''), 'base64');
const path = (name: string) => join(directory, name);
const fields = { environment: 'SIMULATION' as 'SIMULATION' | 'PRODUCTION', commonName: 'EGS saved unit', taxpayerVatNumber: '312345678901233',
  branchName: 'Riyadh Main', organizationName: 'Synthetic Company', serialNumber: '1-ZakatFlow|2-1.0|3-12345678-1234-1234-1234-123456789012',
  invoiceType: '1100', registeredAddress: 'Riyadh 12345', businessCategory: 'Software', email: 'qa@example.invalid' };
function issue(csr: string, ext = '', subject?: string) {
  const id = randomUUID(); writeFileSync(path(id + '.csr'), csr);
  writeFileSync(path(id + '.ext'), '[leaf]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n' + ext);
  const args = ['x509', '-req', '-in', path(id + '.csr'), '-CA', path('ca.pem'), '-CAkey', path('ca.key'),
    '-set_serial', '0x' + randomUUID().replace(/-/g, ''), '-days', '2', '-sha256', '-copy_extensions', 'copy',
    '-extfile', path(id + '.ext'), '-extensions', 'leaf', '-out', path(id + '.pem')];
  if (subject) args.push('-subj', subject);
  execFileSync('/usr/bin/openssl', args, { stdio: 'pipe' });
  return new X509Certificate(readFileSync(path(id + '.pem'))).raw.toString('base64');
}
async function request(overrides: Partial<typeof fields> = {}, privateKey = key) {
  // The passed key's public half is derived independently by Node.
  const { createPublicKey } = await import('node:crypto');
  const spki = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return { csr: await createZatcaCsr({ ...fields, ...overrides }, spki, async bytes => sign('sha256', bytes, privateKey)), spki };
}
function sanFixture(duplicateUid = false, repeat = false) {
  const tlv = (tag: number, value: Buffer) => {
    const len = value.length < 128 ? Buffer.from([value.length]) : value.length < 256 ? Buffer.from([0x81, value.length]) : Buffer.from([0x82, value.length >> 8, value.length & 255]);
    return Buffer.concat([Buffer.from([tag]), len, value]);
  };
  const attrs = [['550405', fields.serialNumber], ['0992268993f22c640101', fields.taxpayerVatNumber],
    ...(duplicateUid ? [['0992268993f22c640101', '398765432109873']] : []),
    ['55040c', fields.invoiceType], ['55041a', fields.registeredAddress], ['55040f', fields.businessCategory]];
  const name = tlv(0x30, Buffer.concat(attrs.map(([oid, value]) => tlv(0x31, tlv(0x30,
    Buffer.concat([tlv(6, Buffer.from(oid, 'hex')), tlv(12, Buffer.from(value))]))))));
  const directoryName = tlv(0xa4, name);
  return 'subjectAltName=DER:' + tlv(0x30, repeat ? Buffer.concat([directoryName, directoryName]) : directoryName).toString('hex') + '\n';
}
let crl: string, revokedCrl: string;
function pathFixture() {
  const root = new X509Certificate(readFileSync(path('ca.pem'))).raw;
  return { evidence: { issuerChainDerBase64: [root.toString('base64')], crlsDerBase64: [crl] },
    trust: { version: 'ZATCA_CERTIFICATE_TRUST_V1', environment: 'SIMULATION',
      anchors: [{ certificateDerBase64: root.toString('base64'), fingerprintSha256: hash(root) }] } };
}
let base: Awaited<ReturnType<typeof fixture>>;
async function fixture(overrides: Partial<typeof fields> = {}) {
  const source = { ...fields, ...overrides }, r = await request(overrides);
  const connectionId = randomUUID();
  return { material: { certificateDerBase64: issue(r.csr), csrPem: r.csr }, expected: {
    organizationId: randomUUID(), connectionId, unitId: connectionId, environment: source.environment,
    profile: 'ZAKATFLOW_SAN_DIRECTORY_V1', csrSha256: hash(csrDer(r.csr)), kmsPublicKeySpkiBase64: r.spki.toString('base64'),
    taxpayerVatNumber: source.taxpayerVatNumber, commonName: source.commonName, branchName: source.branchName,
    legalName: source.organizationName, egsSerialNumber: source.serialNumber, invoiceType: source.invoiceType,
    branchLocation: source.registeredAddress, industry: source.businessCategory, email: source.email,
  } };
}
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'zatca-identity-'));
  execFileSync('/usr/bin/openssl', ['req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-keyout', path('ca.key'), '-out', path('ca.pem'), '-days', '3', '-subj', '/C=SA/O=Synthetic CA/CN=Identity QA CA',
    '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], { stdio: 'pipe' });
  key = generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey;
  base = await fixture(); at = new Date(Date.now() + 60_000);
  writeFileSync(path('index'), ''); writeFileSync(path('serial'), '1000\n'); writeFileSync(path('crlnumber'), '1000\n');
  writeFileSync(path('ca.cnf'), `[ca]\ndefault_ca=issuer\n[issuer]\ncertificate=${path('ca.pem')}\nprivate_key=${path('ca.key')}\ndatabase=${path('index')}\nserial=${path('serial')}\ncrlnumber=${path('crlnumber')}\nnew_certs_dir=${directory}\ndefault_md=sha256\ndefault_crl_days=1\ncrl_extensions=crl_ext\n[crl_ext]\nauthorityKeyIdentifier=keyid:always\n`);
  const generate = (name: string) => {
    execFileSync('/usr/bin/openssl', ['ca', '-gencrl', '-config', path('ca.cnf'), '-out', path(name + '.pem')], { stdio: 'pipe' });
    return execFileSync('/usr/bin/openssl', ['crl', '-in', path(name + '.pem'), '-outform', 'DER'], { stdio: ['pipe','pipe','pipe'] }).toString('base64');
  };
  crl = generate('good'); writeFileSync(path('base.pem'), new X509Certificate(Buffer.from(base.material.certificateDerBase64, 'base64')).toString());
  execFileSync('/usr/bin/openssl', ['ca', '-config', path('ca.cnf'), '-revoke', path('base.pem')], { stdio: 'pipe' });
  revokedCrl = generate('revoked');
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

describe('saved CSR/key and exact EGS certificate identity preflight', () => {
  it('binds a CA-issued certificate to the original saved signed CSR, saved key and every current-layout identity field', () => {
    const result = inspectZatcaOnboardingIdentity(base.material, base.expected, at);
    expect(result.stage).toBe('ONBOARDING_IDENTITY_PREFLIGHT_ONLY');
    expect(result.scope).toEqual({ organizationId: base.expected.organizationId, connectionId: base.expected.connectionId,
      unitId: base.expected.unitId, environment: 'SIMULATION' });
    expect(result.certificateFingerprintSha256).toBe(hash(Buffer.from(base.material.certificateDerBase64, 'base64')));
    expect(result.csrSha256).toBe(base.expected.csrSha256);
    expect(JSON.stringify(result)).not.toContain(base.expected.taxpayerVatNumber);
    expect(JSON.stringify(result)).not.toContain(base.expected.egsSerialNumber);
    writeFileSync(path('verify.csr'), base.material.csrPem);
    execFileSync('/usr/bin/openssl', ['req', '-in', path('verify.csr'), '-noout', '-verify'], { stdio: 'pipe' });
  });
  it('supports the explicit production template/common name without promoting it to authority approval', async () => {
    const f = await fixture({ environment: 'PRODUCTION' });
    expect(inspectZatcaOnboardingIdentity(f.material, f.expected, at).scope.environment).toBe('PRODUCTION');
  });
  it('compares Arabic identity strings exactly', async () => {
    const f = await fixture({ branchName: 'فرع الرياض', organizationName: 'شركة الاختبار', registeredAddress: 'الرياض', businessCategory: 'البرمجيات' });
    expect(inspectZatcaOnboardingIdentity(f.material, f.expected, at).profile).toBe('ZAKATFLOW_SAN_DIRECTORY_V1');
    if (process.env.ZATCA_ENROLLMENT_SQL_QA === '1') {
      if (process.env.ZATCA_LEDGER_DISPOSABLE_QA !== '1' || process.env.PGDATABASE !== 'zatca_ledger_qa') throw new Error('DISPOSABLE_LEDGER_QA_REQUIRED');
      const value = JSON.stringify(f.expected).replace(/'/g, "''");
      const sqlHash = execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
        input: "select zatca_preparation.enrollment_identity_digest('" + value + "'::jsonb)", encoding: 'utf8', stdio: ['pipe','pipe','pipe'],
      }).trim();
      expect(inspectZatcaOnboardingIdentity(f.material, f.expected, at).expectedIdentitySha256).toBe(sqlHash);
    }
  });
  it('requires an explicitly selected saved profile with no alternate-field guessing', () => {
    for (const profile of [undefined, 'AUTO', 'SUBJECT_VAT_V1']) expect(() => inspectZatcaOnboardingIdentity(base.material,
      { ...base.expected, profile }, at)).toThrow('ONBOARDING_IDENTITY_INPUT_INVALID');
  });
  it('requires the original CSR digest for a different enrollment request using the same unit/key', async () => {
    const other = await request({ email: 'other-enrollment@example.invalid' });
    expect(() => inspectZatcaOnboardingIdentity({ ...base.material, csrPem: other.csr }, base.expected, at)).toThrow('ONBOARDING_IDENTITY_CSR_DIGEST_MISMATCH');
  });
  it('verifies the CSR signature independently of its saved digest', () => {
    const der = csrDer(base.material.csrPem); der[der.length - 1] ^= 1;
    const csr = '-----BEGIN CERTIFICATE REQUEST-----\n' + der.toString('base64') + '\n-----END CERTIFICATE REQUEST-----\n';
    expect(() => inspectZatcaOnboardingIdentity({ ...base.material, csrPem: csr }, { ...base.expected, csrSha256: hash(der) }, at)).toThrow('ONBOARDING_IDENTITY_CSR_SIGNATURE_INVALID');
  });
  it('rejects another saved key', () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).publicKey.export({ type: 'spki', format: 'der' });
    expect(() => inspectZatcaOnboardingIdentity(base.material, { ...base.expected, kmsPublicKeySpkiBase64: other.toString('base64') }, at)).toThrow('ONBOARDING_IDENTITY_KEY_MISMATCH');
  });
  it('rejects another certificate key even when identity values match', async () => {
    const otherKey = generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey;
    const other = await request({}, otherKey);
    expect(() => inspectZatcaOnboardingIdentity({ ...base.material, certificateDerBase64: issue(other.csr) }, base.expected, at)).toThrow('ONBOARDING_IDENTITY_KEY_MISMATCH');
  });
  it.each(['taxpayerVatNumber','branchName','legalName','egsSerialNumber','invoiceType','branchLocation','industry','email'] as const)('rejects saved %s mismatch', field => {
    const value = field === 'taxpayerVatNumber' ? '398765432109873' : field === 'invoiceType' ? '0100' : field === 'email' ? 'other@example.invalid'
      : field === 'egsSerialNumber' ? '1-Other|2-1|3-Other' : 'Other saved value';
    expect(() => inspectZatcaOnboardingIdentity(base.material, { ...base.expected, [field]: value }, at)).toThrow('ONBOARDING_IDENTITY_SAVED_UNIT_MISMATCH');
  });
  it.each(['taxpayerVatNumber','branchName','organizationName','serialNumber','invoiceType','registeredAddress','businessCategory'] as const)('rejects certificate %s substitution signed by the same CA for the same key', async field => {
    const value = field === 'taxpayerVatNumber' ? '398765432109873' : field === 'invoiceType' ? '0100'
      : field === 'serialNumber' ? '1-Other|2-1|3-Other' : 'Other certificate value';
    const other = await request({ [field]: value });
    expect(() => inspectZatcaOnboardingIdentity({ ...base.material, certificateDerBase64: issue(other.csr) }, base.expected, at)).toThrow('ONBOARDING_IDENTITY_SAVED_UNIT_MISMATCH');
  });
  it('rejects cross-environment request templates and mismatched unit/connection scope', () => {
    expect(() => inspectZatcaOnboardingIdentity(base.material, { ...base.expected, environment: 'PRODUCTION' }, at)).toThrow('ONBOARDING_IDENTITY_ENVIRONMENT_MISMATCH');
    expect(() => inspectZatcaOnboardingIdentity(base.material, { ...base.expected, unitId: randomUUID() }, at)).toThrow('ONBOARDING_IDENTITY_SCOPE_MISMATCH');
  });
  it('compares the saved production common name', async () => {
    const f = await fixture({ environment: 'PRODUCTION' });
    expect(() => inspectZatcaOnboardingIdentity(f.material, { ...f.expected, commonName: 'Other unit' }, at)).toThrow('ONBOARDING_IDENTITY_SAVED_UNIT_MISMATCH');
  });
  it('rejects duplicate subject identity attributes even if one matches', () => {
    const subject = '/C=SA/OU=Riyadh Main/O=Synthetic Company/CN=PREZATCA-Code-Signing/CN=FORGED/emailAddress=qa@example.invalid';
    expect(() => inspectZatcaOnboardingIdentity({ ...base.material, certificateDerBase64: issue(base.material.csrPem, '', subject) }, base.expected, at)).toThrow('ONBOARDING_IDENTITY_DUPLICATE_ATTRIBUTE');
  });
  it('accepts omission of requester email in the certificate but rejects a present conflicting email', () => {
    const subject = '/C=SA/OU=Riyadh Main/O=Synthetic Company/CN=PREZATCA-Code-Signing';
    expect(inspectZatcaOnboardingIdentity({ ...base.material, certificateDerBase64: issue(base.material.csrPem, '', subject) }, base.expected, at).stage).toBe('ONBOARDING_IDENTITY_PREFLIGHT_ONLY');
    expect(() => inspectZatcaOnboardingIdentity({ ...base.material, certificateDerBase64: issue(base.material.csrPem, '', subject + '/emailAddress=other@example.invalid') }, base.expected, at)).toThrow('ONBOARDING_IDENTITY_SAVED_UNIT_MISMATCH');
  });
  it('rejects a missing directoryName and does not search DNS/text for matching VAT digits', () => {
    const certificateDerBase64 = issue(base.material.csrPem, 'subjectAltName=DNS:312345678901233.invalid\n');
    expect(() => inspectZatcaOnboardingIdentity({ ...base.material, certificateDerBase64 }, base.expected, at)).toThrow('ONBOARDING_IDENTITY_SAN_AMBIGUOUS');
  });
  it('rejects multiple directoryName alternatives', () => {
    const ext = sanFixture(false, true);
    expect(() => inspectZatcaOnboardingIdentity({ ...base.material, certificateDerBase64: issue(base.material.csrPem, ext) }, base.expected, at)).toThrow('ONBOARDING_IDENTITY_SAN_AMBIGUOUS');
  });
  it('rejects duplicate SAN identity attributes', () => {
    const ext = sanFixture(true);
    expect(() => inspectZatcaOnboardingIdentity({ ...base.material, certificateDerBase64: issue(base.material.csrPem, ext) }, base.expected, at)).toThrow('ONBOARDING_IDENTITY_DUPLICATE_ATTRIBUTE');
  });
  it('rejects unknown subject identity fields instead of silently accepting a mixed profile', () => {
    const subject = '/C=SA/OU=Riyadh Main/O=Synthetic Company/CN=PREZATCA-Code-Signing/organizationIdentifier=312345678901233';
    expect(() => inspectZatcaOnboardingIdentity({ ...base.material, certificateDerBase64: issue(base.material.csrPem, '', subject) }, base.expected, at)).toThrow('ONBOARDING_IDENTITY_SAVED_UNIT_MISMATCH');
  });
  it('rejects expired certificates and invalid check times', () => {
    const c = new X509Certificate(Buffer.from(base.material.certificateDerBase64, 'base64'));
    expect(() => inspectZatcaOnboardingIdentity(base.material, base.expected, new Date(Date.parse(c.validTo) + 1000))).toThrow('SIGNING_CERTIFICATE_EXPIRED');
    expect(() => inspectZatcaOnboardingIdentity(base.material, base.expected, new Date(NaN))).toThrow('INVALID_CERTIFICATE_CHECK_TIME');
  });
  it.each(['bundle','privateKey','trailing','oversize'])('rejects %s CSR input without returning its content', mode => {
    const csrPem = mode === 'bundle' ? base.material.csrPem.repeat(2) : mode === 'privateKey' ? '-----BEGIN PRIVATE KEY-----\nPRIVATE_MARKER\n-----END PRIVATE KEY-----'
      : mode === 'trailing' ? base.material.csrPem + 'PRIVATE_MARKER' : 'PRIVATE_MARKER'.repeat(4000);
    try { inspectZatcaOnboardingIdentity({ ...base.material, csrPem }, base.expected, at); throw new Error('unexpected success'); }
    catch (error) { expect((error as Error).message).toMatch(/^ONBOARDING_IDENTITY_/); expect(String(error)).not.toContain('PRIVATE_MARKER'); expect((error as Error).cause).toBeUndefined(); }
  });
  it('rejects extra material/authorization flags and whitespace/control-character identities', () => {
    expect(() => inspectZatcaOnboardingIdentity({ ...base.material, approved: true }, base.expected, at)).toThrow('ONBOARDING_IDENTITY_INPUT_INVALID');
    for (const branchName of [' Riyadh Main', 'Riyadh Main\nCN=forged', 'Riyadh\0Main'])
      expect(() => inspectZatcaOnboardingIdentity(base.material, { ...base.expected, branchName }, at)).toThrow('ONBOARDING_IDENTITY_INPUT_INVALID');
  });
});


describe('combined identity and independently configured path candidate', () => {
  it('returns both matching identity and complete native path evidence for the same certificate/environment', async () => {
    const f = pathFixture(); const candidate = await verifyZatcaOnboardingCandidate(base.material, base.expected, f.evidence, f.trust, at);
    expect(candidate.stage).toBe('ONBOARDING_CANDIDATE_ONLY');
    expect(candidate.identity.certificateFingerprintSha256).toBe(candidate.path.certificateFingerprintSha256);
    expect(candidate.identity.scope.environment).toBe(candidate.path.environment);
  });
  it('does not treat a matching identity and key as CA trust or revocation approval', async () => {
    const f = pathFixture(); f.evidence.crlsDerBase64 = [revokedCrl];
    await expect(verifyZatcaOnboardingCandidate(base.material, base.expected, f.evidence, f.trust, at)).rejects.toThrow('CERTIFICATE_PATH_OR_REVOCATION_REJECTED');
  });
  it('rejects wrong saved identity before path checking', async () => {
    const f = pathFixture();
    await expect(verifyZatcaOnboardingCandidate(base.material, { ...base.expected, industry: 'Other' }, f.evidence, {}, at)).rejects.toThrow('ONBOARDING_IDENTITY_SAVED_UNIT_MISMATCH');
  });
  it('rejects material/engine/pin overrides hidden inside path evidence', async () => {
    const f = pathFixture();
    await expect(verifyZatcaOnboardingCandidate(base.material, base.expected,
      { ...f.evidence, expectedFingerprintSha256: '0'.repeat(64) }, f.trust, at)).rejects.toThrow('ONBOARDING_CANDIDATE_INPUT_INVALID');
  });
  it('captures saved identity/material/evidence and time before awaiting native verification', async () => {
    const f = pathFixture(), material = { ...base.material }, saved = { ...base.expected }, date = new Date(at);
    const pending = verifyZatcaOnboardingCandidate(material, saved, f.evidence, f.trust, date);
    material.certificateDerBase64 = 'AAAA'; saved.organizationId = randomUUID(); f.evidence.crlsDerBase64.length = 0; date.setFullYear(1990);
    const result = await pending; expect(result.identity.scope.organizationId).toBe(base.expected.organizationId);
    expect(result.path.checkedAt).toBe(at.toISOString());
  });
});

it.runIf(process.env.ZATCA_ENROLLMENT_SQL_QA === '1')('persists the original signed CSR before credentials, verifies saved identity/path and binds enrollment through relational finalization', async () => {
  if (process.env.ZATCA_LEDGER_DISPOSABLE_QA !== '1' || process.env.PGDATABASE !== 'zatca_ledger_qa') throw new Error('DISPOSABLE_LEDGER_QA_REQUIRED');
  const query = (statement: string) => execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
  const q = (value: string) => "'" + value.replace(/'/g, "''") + "'";
  expect(query('select current_database()')).toBe('zatca_ledger_qa');
  const f = JSON.parse(execFileSync('python3', ['-c', "import runpy,json; s=runpy.run_path('tests/zatca-source-freeze-postgres.py'); f=s['SourceFreeze'](); f.setUp(); print(json.dumps(dict(org=f.org,actor=f.actor,connection=f.connection,document=f.doc,snapshot=f.snapshot)))"], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }));
  const auth = "select set_config('request.jwt.claim.sub'," + q(f.actor) + ",false);";
  const kms = 'arn:aws:kms:eu-central-1:123456789012:key/12345678-1234-1234-1234-123456789012';
  const secret = `arn:aws:secretsmanager:eu-central-1:123456789012:secret:zakatflow/fatoora/${f.org}/simulation/${f.connection}-ABC123`;
  query('update public.vat_einvoice_connections set status=\'KEY_READY\',credentials_secret_arn=null,kms_key_arn=' + q(kms)
    + ',common_name=' + q(fields.commonName) + ',legal_name=' + q(fields.organizationName) + ',branch_name=' + q(fields.branchName)
    + ',branch_location=' + q(fields.registeredAddress) + ',industry=' + q(fields.businessCategory) + ',egs_serial_number=' + q(fields.serialNumber)
    + ' where id=' + q(f.connection));
  const original = JSON.parse(query(auth + 'select row_to_json(r) from zatca_preparation.begin_initial_enrollment('
    + [f.org, 'SIMULATION', f.connection, randomUUID(), csrDer(base.material.csrPem).toString('base64'), base.expected.kmsPublicKeySpkiBase64, fields.email].map(q).join(',') + ') r').split('\n').at(-1)!);
  const privatePool = new Pool({ max: 1, connectionTimeoutMillis: 2000, query_timeout: 7000 });
  let savedRead;
  try {
    // Auth transport is a test stand-in; actual pg transaction/session isolation
    // and subsequent native CSR/certificate/CRL verification are exercised here.
    const auth = { getUser: async () => ({ data: { user: { id: f.actor, aud: 'authenticated', is_anonymous: false } }, error: null }) };
    savedRead = await createVerifiedZatcaEnrollmentReader(auth as never, privatePool).loadOriginalEnrollment('SYNTHETIC.AUTH.TOKEN',
      { organizationId: f.org, connectionId: f.connection, environment: 'SIMULATION' });
  } finally { await privatePool.end(); }
  expect(savedRead.enrollmentId).toBe(original.enrollment_id); expect(savedRead.enrollmentDigest).toBe(original.enrollment_digest);
  const savedMaterial = { certificateDerBase64: base.material.certificateDerBase64, csrPem: savedRead.csrPem };
  const evidence = pathFixture();
  const verified = await verifyZatcaOnboardingCandidate(savedMaterial, savedRead.savedUnit, evidence.evidence, evidence.trust, new Date());
  query("update public.vat_einvoice_connections set status='COMPLIANCE_PASSED',credentials_secret_arn=" + q(secret) + ' where id=' + q(f.connection));
  const binding = { version: 'ZATCA_SAVED_SIGNER_V1', organizationId: f.org, environment: 'SIMULATION', unitId: f.connection, connectionId: f.connection,
    kmsKeyArn: kms, secretArn: secret, secretVersionId: randomUUID(), certificateFingerprintSha256: verified.identity.certificateFingerprintSha256,
    issuerChainDerBase64: evidence.evidence.issuerChainDerBase64, policy: { identifier: 'https://example.invalid/synthetic-policy', digestSha256Base64: 'A'.repeat(43) + '=' }, includeSimplifiedQr: false };
  // Simulation's CN is fixed by the current CSR writer. A verifier called with
  // a changed saved commonName can still match this CSR, so the complete saved
  // identity receipt must prevent replaying that result into the original row.
  const otherSnapshot = await verifyZatcaOnboardingCandidate(savedMaterial, { ...original.expected_identity, commonName: 'Different saved snapshot' },
    evidence.evidence, evidence.trust, new Date());
  expect(() => query(auth + 'select zatca_preparation.record_enrolled_signer_candidate('
    + [f.org, 'SIMULATION', f.connection, original.enrollment_id, JSON.stringify(binding), JSON.stringify(otherSnapshot)].map(q).join(',') + ',null)')).toThrow('ENROLLMENT_EVIDENCE_INVALID');
  const registry = JSON.parse(query(auth + 'select row_to_json(r) from zatca_preparation.record_enrolled_signer_candidate('
    + [f.org, 'SIMULATION', f.connection, original.enrollment_id, JSON.stringify(binding), JSON.stringify(verified)].map(q).join(',') + ',null) r').split('\n').at(-1)!);
  const reservation = JSON.parse(query(auth + 'select row_to_json(r) from zatca_preparation.reserve_with_enrollment('
    + [f.org, f.document, 'SIMULATION', registry.registry_id, registry.binding_digest, original.enrollment_digest, JSON.stringify(f.snapshot)].map(q).join(',') + ') r').split('\n').at(-1)!);
  // This round trip proves native onboarding evidence + relational provenance;
  // signed UBL verification remains the independent XAdES relational suite.
  const artifact = '<synthetic-enrollment-storage-payload/>';
  const prepared = JSON.parse(query(auth + 'select row_to_json(r) from zatca_preparation.finalize_with_enrollment('
    + [f.org, 'SIMULATION', f.connection, reservation.reservation_id, registry.registry_id, registry.binding_digest, original.enrollment_digest,
      JSON.stringify({ version: binding.version, secretVersionId: binding.secretVersionId, certificateFingerprintSha256: binding.certificateFingerprintSha256 }),
      reservation.snapshot_digest, createHash('sha256').update(artifact).digest('base64'), artifact].map(q).join(',') + ') r').split('\n').at(-1)!);
  expect(prepared.state).toBe('PREPARED');
  expect(query('select enrollment_digest from zatca_preparation.enrollment_finalization_audit where reservation_id=' + q(reservation.reservation_id))).toBe(original.enrollment_digest);
  expect(query('select status from public.vat_einvoices where id=' + q(f.document))).toBe('DRAFT');
});
