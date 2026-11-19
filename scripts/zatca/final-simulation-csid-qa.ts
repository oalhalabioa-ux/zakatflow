import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

const pin = z.string().regex(/^[a-f0-9]{64}$/);
const requestId = z.string().regex(/^[0-9]{1,40}$/);
const credential = z.object({ requestId, binarySecurityToken: z.string().min(4).max(32768),
  secret: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/) }).strict();
const contextSchema = z.object({ originalDigest: pin, responseDigest: pin, standardManifestDigest: pin,
  simplifiedManifestDigest: pin, interimFingerprint: pin, requestId, token: credential.shape.binarySecurityToken, secret: credential.shape.secret }).strict();
const claimSchema = z.object({ version: z.literal('QA_FINAL_SIMULATION_CSID_INTENT_V1'), id: z.string().uuid(),
  contextDigest: pin, sourceSha: z.string().regex(/^[a-f0-9]{40}$/), createdAt: z.string().datetime() }).strict();
const resultSchema = z.object({ version: z.literal('QA_FINAL_SIMULATION_CSID_RESPONSE_V1'), claimId: z.string().uuid(),
  contextDigest: pin, http: z.literal(200), response: credential }).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type Saved = { content: string; version: string };
export interface FinalSimulationCsidDependencies {
  // Revalidates BOTH complete suites, original CSR/CCSID and fresh KMS identity.
  // No values in this context may be supplied by the HTTP caller.
  load(): Promise<unknown>;
  verifyCertificate(token: string): Promise<{ fingerprintSha256: string }>;
  read(name: string): Promise<Saved | null>;
  create(name: string, version: string, content: string): Promise<{ version: string }>;
  assertCreateOnly(): Promise<void>;
  transport: typeof fetch;
}

/** One final CSID request to SIMULATION only, never the live /core environment.
 * Successful credentials stay in separate immutable encrypted quarantine even
 * when certificate validation fails. No registry, signer, reporting or activation.
 */
export function createFinalSimulationCsidQa(deps: FinalSimulationCsidDependencies, sourceSha: string) {
  const claimName = 'final-simulation-csid/intent', responseName = 'final-simulation-csid/response';
  const flags = { stage: 'FINAL_SIMULATION_CSID_QA_ONLY', diagnosticOnly: true,
    applicationProfileApproved: false, trustVerified: false, activationAllowed: false } as const;
  async function context() {
    try {
      const value = contextSchema.parse(await deps.load());
      const { token: _token, secret: _secret, ...binding } = value;
      return { value, digest: hash(JSON.stringify(binding)) };
    } catch { throw new Error('QA_FINAL_CSID_CONTEXT_UNAVAILABLE'); }
  }
  async function claim(ctx: Awaited<ReturnType<typeof context>>) {
    const saved = await deps.read(claimName); if (!saved) return null;
    const value = claimSchema.parse(JSON.parse(saved.content));
    if (saved.version !== value.id || value.contextDigest !== ctx.digest || JSON.stringify(value) !== saved.content)
      throw new Error('QA_FINAL_CSID_ORIGINAL_CHANGED');
    return value;
  }
  async function summary(ctx: Awaited<ReturnType<typeof context>>) {
    const intent = await claim(ctx), saved = await deps.read(responseName);
    if (!intent) {
      if (saved) throw new Error('QA_FINAL_CSID_ORIGINAL_CHANGED');
      return { ...flags, state: 'READY' as const, readinessDigest: ctx.digest };
    }
    if (!saved) return { ...flags, state: 'RECONCILIATION_REQUIRED' as const };
    const result = resultSchema.parse(JSON.parse(saved.content));
    if (saved.version !== intent.id || result.claimId !== intent.id || result.contextDigest !== ctx.digest
      || JSON.stringify(result) !== saved.content) throw new Error('QA_FINAL_CSID_ORIGINAL_CHANGED');
    try {
      const checked = z.object({ fingerprintSha256: pin }).strict().parse(await deps.verifyCertificate(result.response.binarySecurityToken));
      if (checked.fingerprintSha256 === ctx.value.interimFingerprint) throw new Error();
      return { ...flags, state: 'RESPONSE_QUARANTINED' as const, identityKeyTimeVerified: true,
        fingerprintSha256: checked.fingerprintSha256, responseDigest: hash(saved.content) };
    } catch {
      // The issued credential remains recoverable; rejection never resets intent.
      return { ...flags, state: 'QUARANTINED_VERIFICATION_REQUIRED' as const,
        identityKeyTimeVerified: false, responseDigest: hash(saved.content) };
    }
  }
  return {
    async status() { return summary(await context()); },
    async request(input: unknown) {
      const p = z.object({ readinessDigest: pin }).strict().safeParse(input);
      if (!p.success) throw new Error('QA_FINAL_CSID_INPUT_INVALID');
      const ctx = await context();
      if (p.data.readinessDigest !== ctx.digest) throw new Error('QA_FINAL_CSID_ORIGINAL_CHANGED');
      const existing = await summary(ctx);
      if (existing.state !== 'READY') return existing;
      if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('QA_FINAL_CSID_CONTEXT_UNAVAILABLE');
      await deps.assertCreateOnly();
      const intent = claimSchema.parse({ version: 'QA_FINAL_SIMULATION_CSID_INTENT_V1', id: randomUUID(),
        contextDigest: ctx.digest, sourceSha, createdAt: new Date().toISOString() });
      const content = JSON.stringify(intent);
      try {
        const ack = await deps.create(claimName, intent.id, content), saved = await deps.read(claimName);
        if (ack.version !== intent.id || saved?.version !== intent.id || saved.content !== content) throw new Error();
      } catch { throw new Error('QA_FINAL_CSID_RECONCILIATION_REQUIRED'); }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await deps.transport('https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/production/csids', {
          method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Version': 'V2',
            Authorization: 'Basic ' + Buffer.from(ctx.value.token + ':' + ctx.value.secret).toString('base64') },
          body: JSON.stringify({ compliance_request_id: ctx.value.requestId }),
        });
        if (response.status !== 200 || response.redirected || !response.body) throw new Error();
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try { while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength; if (size > 65536) { await reader.cancel(); throw new Error(); }
          chunks.push(chunk.value);
        } } finally { reader.releaseLock(); }
        const body = z.object({ requestID: z.union([requestId, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]),
          dispositionMessage: z.literal('ISSUED'), binarySecurityToken: credential.shape.binarySecurityToken,
          secret: credential.shape.secret, errors: z.union([z.null(), z.array(z.unknown()).length(0)]).optional() })
          .parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
        const token = body.binarySecurityToken;
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(token) || Buffer.from(token, 'base64').toString('base64') !== token) throw new Error();
        // Store before identity/time/PKIX checks. Never replace the interim CCSID.
        const result = JSON.stringify(resultSchema.parse({ version: 'QA_FINAL_SIMULATION_CSID_RESPONSE_V1',
          claimId: intent.id, contextDigest: ctx.digest, http: 200,
          response: { requestId: String(body.requestID), binarySecurityToken: token, secret: body.secret } }));
        if (Buffer.byteLength(result) > 65536) throw new Error();
        const ack = await deps.create(responseName, intent.id, result), saved = await deps.read(responseName);
        if (ack.version !== intent.id || saved?.version !== intent.id || saved.content !== result) throw new Error();
      } catch { throw new Error('QA_FINAL_CSID_RECONCILIATION_REQUIRED'); }
      finally { clearTimeout(timer); }
      return summary(ctx);
    },
  };
}
