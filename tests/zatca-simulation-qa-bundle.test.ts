import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => vi.unstubAllEnvs());
describe('standalone Simulation QA serverless packaging', () => {
  it('executes the actual CommonJS sample-preparation bundle with the pinned ESM/WASM package kept intact', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'standard-qa-package-'));
    try {
      mkdirSync(join(directory, 'node_modules'));
      symlinkSync(realpathSync(resolve('node_modules/libxml2-wasm')), join(directory, 'node_modules/libxml2-wasm'), 'dir');
      const built = await build({ entryPoints: ['scripts/zatca/standard-compliance-qa.ts'], write: false, bundle: true,
        platform: 'node', target: 'node22', format: 'cjs', external: ['libxml2-wasm'], logLevel: 'silent' });
      const output = join(directory, 'sample.cjs'); writeFileSync(output, built.outputFiles[0].text);
      const { createStandardComplianceQa } = createRequire(import.meta.url)(output);
      const map = new Map(), transport = vi.fn();
      const api = createStandardComplianceQa({ load: async () => ({ organizationId: randomUUID(), legalName: 'Synthetic', vatNumber: '312345678901233',
        originalDigest: 'a'.repeat(64), responseDigest: 'b'.repeat(64), token: 'PRIVATE_TOKEN', secret: 'PRIVATE_CREDENTIAL' }),
        read: async (name:string) => map.get(name) ?? null, create: async (name:string,version:string,content:string) => { map.set(name,{version,content}); return {version}; },
        assertCreateOnly: async () => {}, transport }, { street: 'Synthetic',building: '1234',district: 'Synthetic',additional: '5678',postal: '12345',city: 'Riyadh' }, 'c'.repeat(40));
      const result = await api.prepare(); expect(result.manifestDigest).toMatch(/^[a-f0-9]{64}$/); expect(result.results).toHaveLength(3);
      expect(transport).not.toHaveBeenCalled(); expect(map.size).toBe(1);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('bundles without private configuration and refuses a non-preview runtime without cloud calls', async () => {
    const marker = 'PRIVATE_PROFILE_NOT_FOR_THE_BUILD';
    vi.stubEnv('FATOORA_QA_SIMULATION_UNIT_PROFILE', marker);
    vi.stubEnv('VERCEL_ENV', 'production');
    const result = await build({ entryPoints: ['scripts/zatca/simulation-qa-entry.ts'], write: false,
      bundle: true, platform: 'node', target: 'node22', format: 'cjs', logLevel: 'silent', external: ['libxml2-wasm'],
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
        platform: 'node', target: 'node22', format: 'cjs', logLevel: 'silent', external: ['libxml2-wasm'], footer: { js: 'module.exports = module.exports.default;' },
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
