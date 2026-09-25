import { Buffer } from 'node:buffer';

export function createZatcaPhaseOneQrPayload(input: {
  sellerName: string;
  sellerVatNumber: string;
  issueDate: string;
  issueTime: string;
  totalWithVat: string | number;
  vatTotal: string | number;
}) {
  const timestamp = `${input.issueDate}T${input.issueTime.length === 5 ? `${input.issueTime}:00` : input.issueTime}+03:00`;
  const values = [
    input.sellerName,
    input.sellerVatNumber,
    timestamp,
    fixedAmount(input.totalWithVat),
    fixedAmount(input.vatTotal),
  ];
  const fields: Buffer[] = values.map((value, index) => {
    const encoded = Buffer.from(value, 'utf8');
    if (encoded.length > 255) throw new Error('QR_FIELD_TOO_LONG');
    return Buffer.concat([Buffer.from([index + 1, encoded.length]), encoded]);
  });
  const payload = Buffer.concat(fields).toString('base64');
  if (payload.length > 700) throw new Error('QR_PAYLOAD_TOO_LONG');
  return payload;
}

function fixedAmount(value: string | number) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('QR_AMOUNT_INVALID');
  return amount.toFixed(2);
}
