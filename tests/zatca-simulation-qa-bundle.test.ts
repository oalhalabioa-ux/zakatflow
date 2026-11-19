import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllEnvs());
describe('standalone Simulation QA serverless packaging', () => {
  it('bundles without private configuration and refuses a non-preview runtime without cloud calls', async () => {
    const marker = 'PRIVATE_PROFILE_NOT_FOR_THE_BUILD';
    vi.stubEnv('FATOORA_QA_SIMULATION_UNIT_PROFILE', marker);
    vi.stubEnv('VERCEL_ENV', 'production');
    const result = await build({ entryPoints: ['scripts/zatca/simulation-qa-entry.ts'], write: false,
      bundle: true, platform: 'node', target: 'node22', format: 'cjs', logLevel: 'silent',
      footer: { js: 'module.exports = module.exports.default;' },
      define: { __YAQEEN_SIMULATION_QA_SOURCE_SHA__: JSON.stringify('a'.repeat(40)) } });
    const code = result.outputFiles[0].text;
    expect(code).not.toContain(marker);
    expect(code).not.toMatch(/prepareZatcaSdk345QaDocument|vat-einvoice-setup|SUPABASE_SERVICE_ROLE_KEY/);
    const module = { exports: {} as unknown as (...args: any[]) => Promise<void> };
    new Function('module','exports','require',code)(module,module.exports,createRequire(import.meta.url));
    let status = 0, body = '';
    const response = { setHeader() {}, end: (value: string) => { body = value; }, set statusCode(value: number) { status = value; } };
    await module.exports(Object.assign(Readable.from([]), { method: 'GET', headers: {} }),response);
    expect(status).toBe(503); expect(JSON.parse(body)).toEqual({ error: 'QA_TARGET_REQUIRED' });
  });
  it('reads an official SDK request-context token with no environment token before opening the private configuration', async () => {
    const { simulationQaRole, simulationQaSigningKey } = await import('../scripts/zatca/simulation-qa');
    vi.stubEnv('VERCEL_ENV','preview'); vi.stubEnv('VERCEL_URL','synthetic-qa.vercel.app');
    vi.stubEnv('FATOORA_QA_AWS_REGION','eu-north-1'); vi.stubEnv('FATOORA_QA_AWS_ROLE_ARN',simulationQaRole);
    vi.stubEnv('FATOORA_QA_KMS_KEY_ARN',simulationQaSigningKey); vi.stubEnv('VERCEL_OIDC_TOKEN','');
    vi.stubEnv('FATOORA_QA_SIMULATION_UNIT_PROFILE','not-configured');
    const claims = { sub: 'owner:oalhalabioa-9334:project:yaqeen-fatoora-qa:environment:preview',
      iss: 'https://oidc.vercel.com/oalhalabioa-9334', aud: 'https://vercel.com/oalhalabioa-9334', exp: Math.floor(Date.now()/1000)+3600 };
    const token = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.synthetic-signature';
    const symbol = Symbol.for('@vercel/request-context'), shared = globalThis as unknown as Record<symbol,unknown>, previous = shared[symbol];
    shared[symbol] = { get: () => ({ headers: { 'x-vercel-oidc-token': token } }) };
    try {
      const result = await build({ entryPoints: ['scripts/zatca/simulation-qa-entry.ts'], write: false, bundle: true,
        platform: 'node', target: 'node22', format: 'cjs', logLevel: 'silent', footer: { js: 'module.exports = module.exports.default;' },
        define: { __YAQEEN_SIMULATION_QA_SOURCE_SHA__: JSON.stringify('a'.repeat(40)) } });
      const module = { exports: {} as unknown as (...args:any[]) => Promise<void> };
      new Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url));
      let body = '';
      await module.exports(Object.assign(Readable.from([]), { method: 'GET', headers: { host: 'synthetic-qa.vercel.app' } }),
        { setHeader() {}, end: (value:string) => { body=value; }, set statusCode(_value:number) {} });
      // Reaching the missing-profile check proves context identity passed; no AWS
      // client is constructed for this deliberately absent private profile.
      expect(JSON.parse(body)).toEqual({ error: 'QA_CONFIGURATION_INVALID' });
    } finally { if (previous === undefined) delete shared[symbol]; else shared[symbol] = previous; }
  });
});
