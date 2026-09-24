import { randomUUID } from 'node:crypto';

type CsrFields = {
  environment: 'SIMULATION' | 'PRODUCTION';
  commonName: string;
  taxpayerVatNumber: string;
  branchName: string;
  organizationName: string;
  serialNumber: string;
  invoiceType: string;
  registeredAddress: string;
  businessCategory: string;
  email: string;
};

type Tlv = { tag: number; value: Buffer };

const oid = (value: string): Buffer => {
  const parts = value.split('.').map(Number);
  const encodeArc = (arc: number) => {
    const bytes = [arc & 0x7f];
    arc = Math.floor(arc / 128);
    while (arc > 0) {
      bytes.unshift((arc & 0x7f) | 0x80);
      arc = Math.floor(arc / 128);
    }
    return bytes;
  };
  const bytes = [...encodeArc(parts[0] * 40 + parts[1])];
  for (const arc of parts.slice(2)) bytes.push(...encodeArc(arc));
  return der(0x06, Buffer.from(bytes));
};

const derLength = (length: number) => {
  if (length < 128) return Buffer.from([length]);
  const octets: number[] = [];
  while (length > 0) {
    octets.unshift(length & 0xff);
    length >>>= 8;
  }
  return Buffer.from([0x80 | octets.length, ...octets]);
};

const der = (tag: number, value: Buffer) => Buffer.concat([Buffer.from([tag]), derLength(value.length), value]);
const sequence = (...parts: Buffer[]) => der(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]) => der(0x31, Buffer.concat(parts));
const utf8 = (value: string) => der(0x0c, Buffer.from(value, 'utf8'));
const printable = (value: string) => der(0x13, Buffer.from(value, 'ascii'));
const ia5 = (value: string) => der(0x16, Buffer.from(value, 'ascii'));
const octet = (value: Buffer) => der(0x04, value);
const bitString = (value: Buffer) => der(0x03, Buffer.concat([Buffer.from([0]), value]));
const integerZero = () => der(0x02, Buffer.from([0]));

function attribute(id: string, value: Buffer) {
  return sequence(oid(id), value);
}

function relativeName(attributes: Array<[string, string, 'utf8' | 'printable' | 'ia5']>) {
  return sequence(...attributes.map(([id, value, type]) => set(attribute(id, type === 'ia5' ? ia5(value) : type === 'printable' ? printable(value) : utf8(value)))));
}

function pem(label: string, value: Buffer) {
  const base64 = value.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}

export async function createZatcaCsr(
  fields: CsrFields,
  publicKeyInfo: Buffer,
  sign: (requestInfoDer: Buffer) => Promise<Buffer>,
) {
  const commonName = fields.environment === 'SIMULATION' ? 'PREZATCA-Code-Signing' : fields.commonName;
  const templateName = fields.environment === 'SIMULATION' ? 'PREZATCA-Code-Signing' : 'ZATCA-Code-Signing';
  const name = relativeName([
    ['2.5.4.6', 'SA', 'printable'],
    ['2.5.4.11', fields.branchName, 'utf8'],
    ['2.5.4.10', fields.organizationName, 'utf8'],
    ['2.5.4.3', commonName, 'utf8'],
    ['1.2.840.113549.1.9.1', fields.email, 'ia5'],
  ]);

  // ZATCA's CSR SAN uses a directoryName containing the EGS serial, VAT ID,
  // invoice functionality map, branch location, and industry.
  const sanName = relativeName([
    ['2.5.4.5', fields.serialNumber, 'utf8'],
    ['0.9.2342.19200300.100.1.1', fields.taxpayerVatNumber, 'utf8'],
    ['2.5.4.12', fields.invoiceType, 'utf8'],
    ['2.5.4.26', fields.registeredAddress, 'utf8'],
    ['2.5.4.15', fields.businessCategory, 'utf8'],
  ]);
  const directoryName = der(0xa4, sanName);
  const subjectAltName = sequence(
    oid('2.5.29.17'),
    octet(sequence(directoryName)),
  );
  const certificateTemplateName = sequence(
    oid('1.3.6.1.4.1.311.20.2'),
    octet(printable(templateName)),
  );
  const extensions = sequence(certificateTemplateName, subjectAltName);
  const extensionRequest = sequence(oid('1.2.840.113549.1.9.14'), set(extensions));
  const attributes = der(0xa0, extensionRequest);

  const requestInfo = sequence(integerZero(), name, publicKeyInfo, attributes);
  const signature = await sign(requestInfo);
  const signatureAlgorithm = sequence(oid('1.2.840.10045.4.3.2'));
  return pem('CERTIFICATE REQUEST', sequence(requestInfo, signatureAlgorithm, bitString(signature)));
}

export const zatcaEgsSerialNumber = () => `1-ZakatFlow|2-1.0|3-${randomUUID()}`;
