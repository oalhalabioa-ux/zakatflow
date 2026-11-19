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
});
