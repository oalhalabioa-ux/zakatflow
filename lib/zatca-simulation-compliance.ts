import { X509Certificate } from 'node:crypto';
import { z } from 'zod';

const endpoint = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance';
const canonicalBase64 = (value: unknown): Buffer => {
  if (typeof value !== 'string' || value.length < 4 || value.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    throw new Error('SIMULATION_CERTIFICATE_ENCODING_INVALID');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('SIMULATION_CERTIFICATE_ENCODING_INVALID');
  return bytes;
};

/** Preserve the original token for Basic authentication. Decode a separate,
 * exact single certificate for verification; never rewrite stored credentials.
 * The API may return base64(DER), base64(base64(DER)) or base64(single PEM).
 * Decoding establishes neither CA trust nor identity/key/expiry validation.
 */
export function decodeZatcaComplianceCertificate(token: unknown): Buffer {
  let bytes = canonicalBase64(token);
  if (bytes[0] !== 0x30) {
    const text = bytes.toString('ascii');
    if (bytes.some(byte => byte > 127)) throw new Error('SIMULATION_CERTIFICATE_ENCODING_INVALID');
    const pem = /^-----BEGIN CERTIFICATE-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END CERTIFICATE-----\r?\n?$/.exec(text);
    bytes = canonicalBase64(pem ? pem[1].replace(/[\r\n]/g, '') : text);
  }
  let certificate: X509Certificate;
  try { certificate = new X509Certificate(bytes); }
  catch { throw new Error('SIMULATION_CERTIFICATE_ENCODING_INVALID'); }
  if (!certificate.raw.equals(bytes)) throw new Error('SIMULATION_CERTIFICATE_ENCODING_INVALID');
  return Buffer.from(certificate.raw);
}

export const simulationOtpSchema = z.string().regex(/^[0-9]{6}$/);
const requestSchema = z.object({ environment: z.literal('SIMULATION'),
  csrPem: z.string().min(1).max(32768), otp: simulationOtpSchema }).strict();
const issuedSchema = z.object({
  requestID: z.union([z.string().regex(/^[0-9]{1,40}$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]),
  dispositionMessage: z.literal('ISSUED'),
  binarySecurityToken: z.string().min(4).max(32768),
  secret: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/),
  errors: z.union([z.null(), z.array(z.unknown()).length(0)]).optional(),
});

/** Private transport primitive, called ONLY after the durable dispatch claim.
 * No authorization, retries, CSR generation, storage or signer activation here.
 * After any invocation failure the caller must reconcile the original intent;
 * even a received HTTP error is not permission to resend automatically.
 */
export function createZatcaSimulationComplianceTransport(transport: typeof fetch) {
  return async (input: unknown) => {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success || !/^-----BEGIN CERTIFICATE REQUEST-----\n[A-Za-z0-9+/=\n]+\n-----END CERTIFICATE REQUEST-----\n$/.test(parsed.data.csrPem))
      throw new Error('SIMULATION_COMPLIANCE_INPUT_INVALID');
    const { csrPem, otp } = parsed.data;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await transport(endpoint, { method: 'POST', redirect: 'error', cache: 'no-store',
        headers: { accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Version': 'V2', OTP: otp },
        body: JSON.stringify({ csr: Buffer.from(csrPem, 'utf8').toString('base64') }), signal: controller.signal });
      // Refuse redirects even if a test/custom transport doesn't enforce redirect:error.
      if (response.status !== 200 || response.redirected || !response.body) throw new Error();
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 65536) { await reader.cancel(); throw new Error(); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const body = issuedSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
      // Structural encoding only here: identity/trust verification follows private
      // quarantine storage. Invalid but canonical tokens remain recoverable there.
      canonicalBase64(body.binarySecurityToken);
      return { requestId: String(body.requestID), binarySecurityToken: body.binarySecurityToken, secret: body.secret };
    } catch {
      // Never propagate fetch/parse/Zod/authority messages containing OTP or secrets.
      throw new Error('SIMULATION_COMPLIANCE_RECONCILIATION_REQUIRED');
    } finally { clearTimeout(timer); }
  };
}
