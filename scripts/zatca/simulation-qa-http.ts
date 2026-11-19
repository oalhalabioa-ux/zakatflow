import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { assertSimulationQaTarget, type createSimulationQa } from './simulation-qa';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare') }).strict(),
  z.object({ action: z.literal('submit'), otp: z.string().regex(/^[0-9]{6}$/), csrSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
const safeErrors = new Set(['QA_TARGET_REQUIRED','QA_IDENTITY_REQUIRED','QA_CONFIGURATION_INVALID','QA_PRIVATE_STORAGE_UNAVAILABLE',
  'QA_STORAGE_FENCE_UNVERIFIED',
  'QA_PRIVATE_STORAGE_INVALID','QA_SIGNING_KEY_UNAVAILABLE','QA_SIGNING_KEY_INVALID','QA_SIGNING_KEY_CHANGED','QA_CSR_SIGNATURE_INVALID',
  'QA_ORIGINAL_INVALID','QA_ORIGINAL_CHANGED','QA_INTENT_INVALID','QA_RECONCILIATION_REQUIRED','QA_OTP_INPUT_INVALID']);
export type SimulationQaRequest = IncomingMessage & { body?: unknown };
export const simulationQaStableHost = 'yaqeen-fatoora-qa-oalhalabioa-9334.vercel.app';

async function readBody(request: SimulationQaRequest) {
  if (request.body !== undefined) {
    if (typeof request.body !== 'object' || request.body === null || Buffer.byteLength(JSON.stringify(request.body)) > 4096) throw new Error();
    return request.body;
  }
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > 4096) throw new Error(); chunks.push(bytes);
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

/** Protected preview entry only. Vercel Authentication must cover this generated
 * deployment's HTML and API before it is deployed. No access share URL is embedded
 * in output, no CORS or request-controlled configuration, no OTP/credential logs.
 */
export function createSimulationQaHttpHandler(open: () => ReturnType<typeof createSimulationQa>, environment: () => Record<string,string|undefined> | Promise<Record<string,string|undefined>>) {
  return async (request: SimulationQaRequest, response: ServerResponse) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const finish = (status: number, body: unknown) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    try {
      const env = await environment(); assertSimulationQaTarget(env);
      if (request.method !== 'GET' && request.method !== 'POST') { response.setHeader('Allow', 'GET, POST'); return finish(405, { error: 'METHOD_NOT_ALLOWED' }); }
      const generated = env.VERCEL_URL, host = request.headers.host;
      if (!generated || !/^[a-z0-9.-]+\.vercel\.app$/.test(generated) || typeof host !== 'string'
        || ![generated, simulationQaStableHost].includes(host)) return finish(403, { error: 'QA_HOST_REQUIRED' });
      if (request.method === 'GET') return finish(200, await open().status());
      if (request.headers.origin !== 'https://' + host
        || (request.headers['sec-fetch-site'] !== undefined && request.headers['sec-fetch-site'] !== 'same-origin'))
        return finish(403, { error: 'SAME_ORIGIN_REQUIRED' });
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(request.headers['content-type'] ?? '')))
        return finish(415, { error: 'JSON_REQUIRED' });
      let action: z.infer<typeof actionSchema>;
      try { action = actionSchema.parse(await readBody(request)); }
      catch { return finish(400, { error: 'QA_INPUT_INVALID' }); }
      const diagnostic = open();
      if (action.action === 'prepare') return finish(200, await diagnostic.prepareOriginal());
      return finish(200, await diagnostic.submitOtp({ otp: action.otp, csrSha256: action.csrSha256 }));
    } catch (error) {
      const code = error instanceof Error && safeErrors.has(error.message) ? error.message : 'QA_REQUEST_FAILED';
      return finish(code === 'QA_RECONCILIATION_REQUIRED' || code === 'QA_ORIGINAL_CHANGED' ? 409 : 503, { error: code });
    }
  };
}
