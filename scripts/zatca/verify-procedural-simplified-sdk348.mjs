// Offline, synthetic-only check of the exact procedural SIMPLIFIED experiment factory. No
// authority/cloud operation, real taxpayer/credential or bundled SDK private key.
import { build } from 'esbuild';
import { createHash, randomUUID, sign, X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const argument = name => { const at = args.indexOf(name); if (at < 0 || !args[at + 1] || args[at + 1].startsWith('--')) throw Error('REFERENCE_ARGUMENT_REQUIRED'); return resolve(args[at + 1]); };
const java = argument('--java'), jar = argument('--jar'), configPath = argument('--sdk-config');
const jarDigest = createHash('sha256').update(readFileSync(jar)).digest('hex');
if (jarDigest !== '48abeb828d453ef6fafba792fddbbb2701da5c7018c24bde918853e80ff5d530') throw Error('REFERENCE_SDK_HASH_MISMATCH');
const directory = mkdtempSync(join(tmpdir(), 'procedural-sdk348-'));
try {
  mkdirSync(join(directory, 'node_modules'));
  symlinkSync(realpathSync(resolve('node_modules/libxml2-wasm')), join(directory, 'node_modules/libxml2-wasm'), 'dir');
  const bundle = await build({ stdin: { contents: "export {createProceduralSimplifiedComplianceQa} from './scripts/zatca/procedural-simplified-compliance-qa'; export {parseZatca348SdkValidation} from './lib/zatca-sdk-validation';", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', target: 'node22', format: 'cjs', external: ['libxml2-wasm'], logLevel: 'silent' });
  const entry = join(directory, 'sample.cjs'); writeFileSync(entry, bundle.outputFiles[0].text);
  const { createProceduralSimplifiedComplianceQa, parseZatca348SdkValidation } = createRequire(import.meta.url)(entry);
  const command = (...args) => execFileSync('/usr/bin/openssl', args, { cwd: directory, stdio: 'pipe', timeout: 10000 });
  command('req','-new','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:secp256k1','-nodes','-keyout','root.key','-out','root.pem','-days','2','-subj','/CN=eInvoicing','-addext','basicConstraints=critical,CA:TRUE');
  command('req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:secp256k1','-nodes','-keyout','leaf.key','-out','leaf.csr','-subj','/CN=Synthetic EGS');
  command('x509','-req','-in','leaf.csr','-CA','root.pem','-CAkey','root.key','-set_serial','99331','-days','1','-out','leaf.pem');
  const cert = new X509Certificate(readFileSync(join(directory, 'leaf.pem'))), key = readFileSync(join(directory, 'leaf.key'));
  const map = new Map(), organizationId = randomUUID();
  const api = createProceduralSimplifiedComplianceQa({ sign: async bytes => sign('sha256', bytes, key), load: async () => ({ organizationId, legalName: 'شركة ' + 'ص'.repeat(31) + 'QA', vatNumber: '399999999900003',
    certificate: cert.raw.toString('base64'), fingerprint: createHash('sha256').update(cert.raw).digest('hex'), standardManifestDigest: 'e'.repeat(64), previousInvoiceHash: Buffer.alloc(32, 7).toString('base64'), originalDigest: 'a'.repeat(64), responseDigest: 'b'.repeat(64), token: 'SYNTHETIC_UNUSED', secret: 'SYNTHETIC_UNUSED' }),
    read: async name => map.get(name) ?? null, create: async (name, version, content) => { if (map.has(name)) throw Error('EXISTS'); map.set(name, { version, content }); return { version }; },
    assertCreateOnly: async () => { throw Error('NO_CLOUD_IN_OFFLINE_CHECK'); }, transport: async () => { throw Error('NO_NETWORK_IN_OFFLINE_CHECK'); } },
    { street: 'Synthetic street', building: '1234', district: 'Synthetic district', additional: '5678', postal: '12345', city: 'Riyadh' }, 'c'.repeat(40));
  await api.prepare(); const manifest = JSON.parse(map.get('simplified-procedural-compliance/original-suite').content);
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.certPath = join(directory, 'cert.txt'); writeFileSync(config.certPath, cert.raw.toString('base64')); config.privateKeyPath = join(directory, 'NO_PRIVATE_KEY'); config.pihPath = join(directory, 'pih.txt');
  const localConfig = join(directory, 'sdk-config.json'); writeFileSync(localConfig, JSON.stringify(config));
  let previous = Buffer.alloc(32, 7).toString('base64'); const results = [];
  for (const a of manifest.artifacts) {
    const path = join(directory, a.kind + '.xml'); writeFileSync(path, a.xml); writeFileSync(config.pihPath, previous);
    const run = spawnSync(java, ['-jar', jar, '-validate', '-invoice', path], { cwd: directory, encoding: 'utf8', timeout: 40000,
      maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', SDK_CONFIG: localConfig } });
    const checked = parseZatca348SdkValidation(String(run.stdout) + String(run.stderr), run.status, 'SIMPLIFIED');
    results.push({ kind: a.kind, passed: checked.passed, stages: checked.stages, codes: checked.codes }); previous = a.invoiceHash;
  }
  console.log(JSON.stringify({ scope: 'SDK_348_OFFLINE_SIMPLIFIED_PROCEDURAL_EXPERIMENT_ONLY', sdkJarSha256: jarDigest, results, passed: results.every(r => r.passed), authorityRequests: 0, activationAllowed: false }));
  if (!results.every(r => r.passed)) process.exitCode = 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
