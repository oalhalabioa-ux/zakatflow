import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { certificateSignatureDer, prepareSimplifiedPhaseTwoQr } from './zatca-phase2-qr';

const text = { sellerName: 'شركة يقين', sellerVatNumber: '312345678901233', timestamp: '2026-10-22T12:00:00+03:00', totalWithVat: '115.00', vatTotal: '15.00' };
let directory: string;
let certificateDer: Buffer;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'zatca-qr-'));
  execFileSync('openssl', ['req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp256k1', '-nodes', '-keyout', join(directory, 'synthetic.key'), '-out', join(directory, 'synthetic.pem'), '-days', '2', '-subj', '/CN=Synthetic QR Test', '-addext', 'basicConstraints=CA:FALSE'], { stdio: 'pipe' });
  certificateDer = new X509Certificate(readFileSync(join(directory, 'synthetic.pem'))).raw;
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
const crypto = () => ({ invoiceHash: Buffer.alloc(32, 0xab), xmlSignature: Buffer.alloc(64, 0xcd), certificateDer });
function decode(payload: string) {
  const bytes = Buffer.from(payload, 'base64'), entries: Buffer[] = [];
  for (let i = 0; i < bytes.length;) {
    expect(bytes[i++]).toBe(entries.length + 1);
    const length = bytes[i++];
    entries.push(bytes.subarray(i, i + length)); i += length;
    expect(i).toBeLessThanOrEqual(bytes.length);
  }
  return entries;
}
describe('simplified Phase 2 QR preparation', () => {
  it('uses UTF8 byte lengths, raw binary hash/signature and the same certificate public material', () => {
    const result = prepareSimplifiedPhaseTwoQr(text, crypto());
    const values = decode(result.payload);
    expect(values.length).toBe(9);
    expect(values[0].toString('utf8')).toBe(text.sellerName);
    expect(values[0].length).toBe(Buffer.byteLength(text.sellerName));
    expect(values[2].toString()).toBe(text.timestamp);
    expect(values[3].toString()).toBe('115.00');
    expect(values[4].toString()).toBe('15.00');
    expect(values[5]).toEqual(crypto().invoiceHash);
    expect(values[5].length).toBe(32);
    expect(values[6]).toEqual(crypto().xmlSignature);
    expect(values[7]).toEqual(new X509Certificate(certificateDer).publicKey.export({ format: 'der', type: 'spki' }));
    expect(values[8]).toEqual(certificateSignatureDer(certificateDer));
    expect(result.stage).toBe('QR_PREPARATION_ONLY');
    expect(result.payload.length).toBeLessThanOrEqual(700);
  });
  it('extracts the exact outer certificate signature independently shown by OpenSSL', () => {
    const output = execFileSync('openssl', ['x509', '-in', join(directory, 'synthetic.pem'), '-noout', '-text'], { encoding: 'utf8' });
    const signature = output.split('Signature Value:').pop()!.replace(/\s/g, '').replace(/:/g, '');
    expect(signature).toMatch(/^[a-f0-9]+$/i);
    expect(certificateSignatureDer(certificateDer)).toEqual(Buffer.from(signature, 'hex'));
  });
  it.each([31, 33, 44])('rejects a hash with %s bytes including accidentally encoded base64 text', length => {
    expect(() => prepareSimplifiedPhaseTwoQr(text, { ...crypto(), invoiceHash: Buffer.alloc(length) })).toThrow('INVALID_QR_CRYPTO_LENGTH');
  });
  it('rejects malformed/trailing certificate data and incorrect signature length', () => {
    expect(() => prepareSimplifiedPhaseTwoQr(text, { ...crypto(), xmlSignature: Buffer.alloc(63) })).toThrow('INVALID_QR_CRYPTO_LENGTH');
    for (const bytes of [Buffer.from('bad'), Buffer.concat([certificateDer, Buffer.from([0])])]) expect(() => certificateSignatureDer(bytes)).toThrow('INVALID_QR_CERTIFICATE');
  });
  it.each([{ totalWithVat: '115.001' }, { vatTotal: '-1.00' }, { timestamp: '2026-02-30T12:00:00Z' }, { sellerVatNumber: '123' }])('rejects malformed text fields %j', change => {
    expect(() => prepareSimplifiedPhaseTwoQr({ ...text, ...change }, crypto())).toThrow();
  });
  it('rejects VAT exceeding gross without floating point rounding', () => {
    expect(() => prepareSimplifiedPhaseTwoQr({ ...text, vatTotal: '115.01' }, crypto())).toThrow('QR_AMOUNT_INCONSISTENT');
  });
  it('rejects byte-overlong fields and excessive complete payloads', () => {
    expect(() => prepareSimplifiedPhaseTwoQr({ ...text, sellerName: 'ع'.repeat(130) }, crypto())).toThrow('QR_FIELD_TOO_LONG');
    expect(() => prepareSimplifiedPhaseTwoQr({ ...text, sellerName: 'ع'.repeat(120) }, crypto())).toThrow('QR_PAYLOAD_TOO_LONG');
  });
});
