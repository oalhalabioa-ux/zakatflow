import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inspectSimulationCertificate, inspectSimulationNativeRuntime } from '../scripts/zatca/simulation-certificate-inspection';
import { inspectSimulationCertificateDiscovery } from '../scripts/zatca/simulation-certificate-discovery';

let directory: string, leaf: X509Certificate, root: X509Certificate, unsafeHints: X509Certificate, boundedHints: X509Certificate;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'qa-public-certificate-'));
  const run = (args: string[]) => execFileSync('/usr/bin/openssl', args, { cwd: directory, stdio: 'pipe' });
  run(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'root.key']);
  run(['req', '-new', '-x509', '-key', 'root.key', '-subj', '/C=SA/CN=Synthetic Issuer CA', '-days', '2', '-out', 'root.pem']);
  run(['ecparam', '-name', 'secp256k1', '-genkey', '-noout', '-out', 'leaf.key']);
  run(['req', '-new', '-key', 'leaf.key', '-subj', '/C=SA/CN=PRIVATE_SUBJECT_NOT_FOR_RESPONSE', '-out', 'leaf.csr']);
  writeFileSync(join(directory, 'extensions.cnf'), [
    'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature', 'extendedKeyUsage=clientAuth',
    'authorityInfoAccess=caIssuers;URI:https://ca.example.invalid/issuer.crt,OCSP;URI:https://ca.example.invalid/ocsp',
    'crlDistributionPoints=URI:https://ca.example.invalid/current.crl', 'certificatePolicies=1.2.3.4.5',
  ].join('\n'));
  run(['x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-set_serial', '123456',
    '-days', '1', '-sha256', '-extfile', 'extensions.cnf', '-out', 'leaf.pem']);
  leaf = new X509Certificate(readFileSync(join(directory, 'leaf.pem')));
  root = new X509Certificate(readFileSync(join(directory, 'root.pem')));
  writeFileSync(join(directory, 'unsafe.cnf'), [
    'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature',
    'authorityInfoAccess=caIssuers;URI:https://user:PRIVATE_URI_CREDENTIAL@ca.example.invalid/cert,OCSP;URI:file:///etc/passwd',
    'crlDistributionPoints=URI:ldap://internal.example.invalid/revocations',
  ].join('\n'));
  run(['x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-set_serial', '123457',
    '-days', '1', '-sha256', '-extfile', 'unsafe.cnf', '-out', 'unsafe.pem']);
  unsafeHints = new X509Certificate(readFileSync(join(directory, 'unsafe.pem')));
  writeFileSync(join(directory, 'bounded.cnf'), [
    'basicConstraints=critical,CA:FALSE',
    'authorityInfoAccess=' + Array.from({ length: 12 }, (_, i) => 'caIssuers;URI:https://ca.example.invalid/' + i + '.crt').join(','),
    'crlDistributionPoints="URI:https://ca.example.invalid/list.crl?PRIVATE_QUERY=secret,URI:https://ca.example.invalid/list.crl#PRIVATE_FRAGMENT"',
    'certificatePolicies=2.999.3.4',
  ].join('\n'));
  run(['x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-set_serial', '123458',
    '-days', '1', '-sha256', '-extfile', 'bounded.cnf', '-out', 'bounded.pem']);
  boundedHints = new X509Certificate(readFileSync(join(directory, 'bounded.pem')));
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

describe('protected Simulation certificate inspection, not trust/activation', () => {
  it('reads bounded actual DER discovery without a native executable or exposing the subject/certificate', () => {
    const result = inspectSimulationCertificateDiscovery(leaf.raw);
    expect(result).toMatchObject({ issuer: 'C=SA CN=Synthetic Issuer CA', signatureAlgorithmOid: '1.2.840.10045.4.3.2',
      issuerCertificateUrls: ['https://ca.example.invalid/issuer.crt'], ocspUrls: ['https://ca.example.invalid/ocsp'],
      crlDistributionUrls: ['https://ca.example.invalid/current.crl'], policyOids: ['1.2.3.4.5'],
      extendedKeyUsage: ['1.3.6.1.5.5.7.3.2'], digitalSignature: true, keyUsageCritical: true,
      keyCertSign: false, clientAuthentication: true, selfIssued: false,
      discoveryHintsTrusted: false, trustVerified: false, activationAllowed: false });
    expect(result.validFrom).toBe(new Date(leaf.validFrom).toISOString());
    expect(result.validTo).toBe(new Date(leaf.validTo).toISOString());
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SUBJECT|binarySecurityToken|serialNumber|csrPem|CERTIFICATE-----/);
    expect(JSON.stringify(result)).not.toContain(leaf.raw.toString('base64'));
  });
  it('matches independent native metadata while distinguishing CA issuers from OCSP responders', async () => {
    const portable = inspectSimulationCertificateDiscovery(leaf.raw), native = await inspectSimulationNativeRuntime(leaf.raw);
    expect(native.state).toBe('AVAILABLE');
    expect([...portable.issuerCertificateUrls, ...portable.ocspUrls]).toEqual(native.issuerAccessUrls);
    expect(portable.crlDistributionUrls).toEqual(native.crlDistributionUrls); expect(portable.policyOids).toEqual(native.policyOids);
  });
  it('filters unsafe URI schemes and credential-bearing discovery locations', () => {
    const result = inspectSimulationCertificateDiscovery(unsafeHints.raw);
    expect(result.issuerCertificateUrls).toEqual([]); expect(result.ocspUrls).toEqual([]); expect(result.crlDistributionUrls).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_URI_CREDENTIAL');
  });
  it('bounds lists, omits query/fragment locations and decodes multi-octet OID first components', () => {
    const result = inspectSimulationCertificateDiscovery(boundedHints.raw);
    expect(result.issuerCertificateUrls).toHaveLength(8); expect(result.crlDistributionUrls).toEqual([]);
    expect(result.policyOids).toEqual(['2.999.3.4']); expect(result.extendedKeyUsage).toEqual([]);
    expect(result.digitalSignature).toBe(false); expect(result.keyUsageCritical).toBe(false); expect(result.clientAuthentication).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_QUERY|PRIVATE_FRAGMENT/);
  });
  it('does not turn a parsed self-issued root into configured trust', () => {
    expect(inspectSimulationCertificateDiscovery(root.raw)).toMatchObject({ selfIssued: true, trustVerified: false, activationAllowed: false });
  });
  it.each([Buffer.alloc(0), Buffer.from([0x30, 0]), Buffer.from([0x30, 0x80, 0, 0]), Buffer.alloc(32769)])
    ('rejects malformed, indefinite or oversized input without exposing parser diagnostics', bytes => {
      expect(() => inspectSimulationCertificateDiscovery(bytes)).toThrow('QA_CERTIFICATE_DISCOVERY_INVALID');
    });
  it('rejects trailing data and corrupted known extension structure', () => {
    expect(() => inspectSimulationCertificateDiscovery(Buffer.concat([leaf.raw, Buffer.from('extra')]))).toThrow('QA_CERTIFICATE_DISCOVERY_INVALID');
    const altered = Buffer.from(leaf.raw), i = altered.indexOf(Buffer.from('0603551d20', 'hex'));
    expect(i).toBeGreaterThan(0); expect(altered[i + 5]).toBe(4); expect(altered[i + 7]).toBe(0x30);
    altered[i + 7] = 0x31;
    expect(() => inspectSimulationCertificateDiscovery(altered)).toThrow('QA_CERTIFICATE_DISCOVERY_INVALID');
  });
  it('inspects actual certificate dates/key and fixed native runtime without returning credential or subject material', async () => {
    const value = await inspectSimulationCertificate(leaf.raw, true);
    expect(value).toMatchObject({ stage: 'SIMULATION_CERTIFICATE_INSPECTION_ONLY', timeKeyPreflight: 'PASSED', freshKmsKeyMatched: true,
      issuer: 'C=SA CN=Synthetic Issuer CA', selfIssued: false, extendedKeyUsage: ['1.3.6.1.5.5.7.3.2'],
      discoveryHintsTrusted: false, trustVerified: false, activationAllowed: false,
      nativeRuntime: { state: 'AVAILABLE', issuerAccessUrls: ['https://ca.example.invalid/issuer.crt', 'https://ca.example.invalid/ocsp'],
        crlDistributionUrls: ['https://ca.example.invalid/current.crl'], policyOids: ['1.2.3.4.5'] } });
    expect(value.nativeRuntime.engine).toMatch(/^OpenSSL 3\./);
    expect(value.fingerprintSha256).toBe(createHash('sha256').update(leaf.raw).digest('hex'));
    const output = JSON.stringify(value);
    for (const forbidden of ['PRIVATE_SUBJECT_NOT_FOR_RESPONSE', 'CERTIFICATE-----', leaf.raw.toString('base64'), 'binarySecurityToken', 'secret', 'csrPem', 'serialNumber'])
      expect(output).not.toContain(forbidden);
  });
  it.each(['EXPIRED', 'NOT_YET_VALID'] as const)('reports %s separately from identity or issuer trust', async status => {
    const at = new Date(status === 'EXPIRED' ? Date.parse(leaf.validTo) + 1 : Date.parse(leaf.validFrom) - 1);
    const result = await inspectSimulationCertificate(leaf.raw, true, async () => ({ state: 'UNAVAILABLE' }), at);
    expect(result.timeKeyPreflight).toBe(status); expect(result.trustVerified).toBe(false); expect(result.activationAllowed).toBe(false);
  });
  it('does not lose readable certificate evidence or grant trust when the native engine fails', async () => {
    const result = await inspectSimulationCertificate(leaf.raw, null, async () => { throw new Error('PRIVATE_PATH_AND_CREDENTIAL'); });
    expect(result.timeKeyPreflight).toBe('PASSED'); expect(result.freshKmsKeyMatched).toBeNull();
    expect(result.nativeRuntime).toEqual({ state: 'UNAVAILABLE' }); expect(JSON.stringify(result)).not.toContain('PRIVATE_PATH');
  });
  it('does not equate a mismatching current KMS key or available parser with a verified signing certificate', async () => {
    const result = await inspectSimulationCertificate(leaf.raw, false, async () => ({ state: 'AVAILABLE', engine: 'OpenSSL 3.0.0' }));
    expect(result.freshKmsKeyMatched).toBe(false); expect(result.activationAllowed).toBe(false); expect(result.trustVerified).toBe(false);
  });
  it('keeps a CA certificate rejected even when it is valid in time', async () => {
    const result = await inspectSimulationCertificate(root.raw, true, async () => ({ state: 'UNAVAILABLE' }));
    expect(result.timeKeyPreflight).toBe('REJECTED'); expect(result.selfIssued).toBe(true); expect(result.activationAllowed).toBe(false);
  });
  it('rejects trailing/malformed material and invalid time before invoking the runtime inspector', async () => {
    const native = vi.fn(async () => ({ state: 'UNAVAILABLE' as const }));
    await expect(inspectSimulationCertificate(Buffer.concat([leaf.raw, Buffer.from('extra')]), true, native)).rejects.toThrow('QA_CERTIFICATE_INSPECTION_INVALID');
    await expect(inspectSimulationCertificate(leaf.raw, true, native, new Date('invalid'))).rejects.toThrow('QA_CERTIFICATE_INSPECTION_INVALID');
    expect(native).not.toHaveBeenCalled();
  });
  it('sanitizes fixed native parser errors without returning native output', async () => {
    expect(await inspectSimulationNativeRuntime(Buffer.from([0x30, 0]))).toEqual({ state: 'UNAVAILABLE' });
  });
  it('does not expose credential-bearing or non-HTTP certificate discovery URIs', async () => {
    const result = await inspectSimulationNativeRuntime(unsafeHints.raw);
    expect(result).toMatchObject({ state: 'AVAILABLE', issuerAccessUrls: [], crlDistributionUrls: [] });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_URI_CREDENTIAL');
  });
  it('captures certificate bytes and evaluation time before asynchronous inspection', async () => {
    const bytes = Buffer.from(leaf.raw), at = new Date(), expected = at.toISOString();
    const result = await inspectSimulationCertificate(bytes, true, async supplied => {
      bytes.fill(0); supplied.fill(0); at.setUTCFullYear(2099); return { state: 'UNAVAILABLE' };
    }, at);
    expect(result.checkedAt).toBe(expected); expect(result.timeKeyPreflight).toBe('PASSED');
    expect(result.fingerprintSha256).toBe(createHash('sha256').update(leaf.raw).digest('hex'));
  });
});
