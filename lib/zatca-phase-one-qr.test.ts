import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { createZatcaPhaseOneQrPayload } from './zatca-phase-one-qr';

function decodeTlv(payload: string) {
  const buffer = Buffer.from(payload, 'base64');
  const fields: Array<{ tag: number; value: string }> = [];
  for (let offset = 0; offset < buffer.length;) {
    const tag = buffer[offset++];
    const length = buffer[offset++];
    fields.push({ tag, value: buffer.subarray(offset, offset + length).toString('utf8') });
    offset += length;
  }
  return fields;
}

describe('ZATCA Phase 1 QR payload', () => {
  it('encodes the five required values as UTF-8 TLV and base64', () => {
    const payload = createZatcaPhaseOneQrPayload({
      sellerName: 'شركة تجريبية', sellerVatNumber: '310000000000003',
      issueDate: '2026-09-25', issueTime: '12:30', totalWithVat: '115.00', vatTotal: '15',
    });
    expect(decodeTlv(payload)).toEqual([
      { tag: 1, value: 'شركة تجريبية' },
      { tag: 2, value: '310000000000003' },
      { tag: 3, value: '2026-09-25T12:30:00+03:00' },
      { tag: 4, value: '115.00' },
      { tag: 5, value: '15.00' },
    ]);
  });

  it('rejects invalid totals and QR fields that exceed one-byte TLV length', () => {
    const input = {
      sellerName: 'A'.repeat(256), sellerVatNumber: '310000000000003',
      issueDate: '2026-09-25', issueTime: '12:30:00', totalWithVat: 115, vatTotal: 15,
    };
    expect(() => createZatcaPhaseOneQrPayload(input)).toThrow('QR_FIELD_TOO_LONG');
    expect(() => createZatcaPhaseOneQrPayload({ ...input, sellerName: 'Seller', totalWithVat: -1 })).toThrow('QR_AMOUNT_INVALID');
  });
});
