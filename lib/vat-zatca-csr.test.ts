import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createZatcaCsr, zatcaEgsSerialNumber } from './vat-zatca-csr';

describe('ZATCA CSR creation', () => {
  it('creates a signed simulation CSR using the KMS signing callback', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    const publicKeyInfo = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    let signedInfo: Uint8Array = new Uint8Array();
    let signature: Uint8Array = new Uint8Array();
    const csr = await createZatcaCsr({
      environment: 'SIMULATION',
      commonName: 'Customer Point of Sale',
      taxpayerVatNumber: '300000000000003',
      branchName: 'Riyadh Main',
      organizationName: 'Levant Holding',
      serialNumber: '1-ZakatFlow|2-1.0|3-6a9e90cd-85d9-4d72-86e8-6f9dc705c173',
      invoiceType: '1100',
      registeredAddress: 'Riyadh 12345',
      businessCategory: 'Software',
      email: 'admin@example.com',
    }, publicKeyInfo, async (requestInfo) => {
      signedInfo = requestInfo;
      const generatedSignature = sign('sha256', requestInfo, privateKey);
      signature = generatedSignature;
      return Buffer.from(generatedSignature);
    });

    const der = Buffer.from(csr.replace(/-----[^\n]+-----/g, '').replace(/\s/g, ''), 'base64');
    expect(csr.startsWith('-----BEGIN CERTIFICATE REQUEST-----')).toBe(true);
    expect(der.indexOf(signedInfo)).toBeGreaterThanOrEqual(0);
    expect(der.indexOf(signature)).toBeGreaterThanOrEqual(0);
    expect(verify('sha256', signedInfo, publicKey, signature)).toBe(true);
    expect(createPublicKey({ key: publicKeyInfo, format: 'der', type: 'spki' }).asymmetricKeyType).toBe('ec');

    const directory = mkdtempSync(join(tmpdir(), 'zakatflow-csr-'));
    try {
      const requestPath = join(directory, 'request.csr');
      writeFileSync(requestPath, csr, 'utf8');
      const validation = spawnSync('openssl', ['req', '-in', requestPath, '-noout', '-verify', '-text'], { encoding: 'utf8' });
      if (validation.error?.message.includes('ENOENT')) return;
      const asn = spawnSync('openssl', ['asn1parse', '-in', requestPath], { encoding: 'utf8' });
      expect(validation.status, `${validation.stderr}\n${asn.stdout}`).toBe(0);
      expect(validation.stdout).toContain('PREZATCA-Code-Signing');
      expect(validation.stdout).toContain('300000000000003');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses the mandatory simulation template and produces an EGS serial with a UUIDv4', async () => {
    const serial = zatcaEgsSerialNumber();
    expect(serial).toMatch(/^1-ZakatFlow\|2-1\.0\|3-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
