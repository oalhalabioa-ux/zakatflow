import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// One intentional source-pinned preview package; no deployment or cloud call.
if (execFileSync('git', ['status','--porcelain'], { encoding: 'utf8' }).trim()) throw Error('CLEAN_COMMITTED_SOURCE_REQUIRED');
const sourceSha = execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw Error('COMMITTED_SOURCE_REQUIRED');
const output = resolve(process.argv[2] || '../artifacts/yaqeen-fatoora-simulation-preview');
await mkdir(output + '/api', { recursive: true }); await mkdir(output + '/public', { recursive: true });
await build({ entryPoints: ['scripts/zatca/simulation-qa-entry.ts'], outfile: output + '/api/simulation.js',
  bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: false, sourcemap: false,
  external: ['libxml2-wasm'],
  footer: { js: 'module.exports = module.exports.default;' },
  define: { __YAQEEN_SIMULATION_QA_SOURCE_SHA__: JSON.stringify(sourceSha) } });
for (const [source, target] of [['simulation-qa-ui.html','index.html'],['simulation-qa-ui.js','simulation-qa-ui.js']])
  await writeFile(output + '/public/' + target, await readFile('scripts/zatca/' + source));
const packageJson = { name: 'yaqeen-fatoora-simulation-qa', private: true, version: '1.0.0', engines: { node: '22.x' }, dependencies: { 'libxml2-wasm': '0.7.1' } };
await writeFile(output + '/package.json', JSON.stringify(packageJson));
const locked = JSON.parse(await readFile('package-lock.json', 'utf8')).packages['node_modules/libxml2-wasm'];
if (locked.version !== '0.7.1' || !locked.integrity || locked.dependencies) throw Error('PINNED_WASM_PACKAGE_REQUIRED');
await writeFile(output + '/package-lock.json', JSON.stringify({ name: packageJson.name, version: packageJson.version, lockfileVersion: 3, requires: true,
  packages: { '': { name: packageJson.name, version: packageJson.version, dependencies: packageJson.dependencies, engines: packageJson.engines }, 'node_modules/libxml2-wasm': locked } }));
await writeFile(output + '/vercel.json', JSON.stringify({ version: 2, buildCommand: '',
  functions: { 'api/simulation.js': { maxDuration: 60, includeFiles: 'node_modules/libxml2-wasm/lib/**' } },
  headers: [{ source: '/(.*)', headers: [
    { key: 'Cache-Control', value: 'private, no-store' }, { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Content-Security-Policy', value: "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" },
  ] }], git: { deploymentEnabled: { '**': false, main: true } } }));
await writeFile(output + '/source.json', JSON.stringify({ sourceSha, diagnosticOnly: true, productionAllowed: false }));
console.log(JSON.stringify({ output, sourceSha, deployed: false }));
