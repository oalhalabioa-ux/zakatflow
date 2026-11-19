/** Offline synthetic CSR comparison against the owner-supplied official SDK.
 * No AWS, database, taxpayer identity, OTP or authority submission. Temporary
 * SDK-generated private keys stay local and are deleted in finally blocks.
 */
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';

const args = process.argv.slice(2);
function argument(name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('REFERENCE_ARGUMENT_REQUIRED');
  return args[index + 1];
}
const java = argument('--java'), jar = argument('--jar'), config = argument('--sdk-config');
const expectedJarSha256 = '48abeb828d453ef6fafba792fddbbb2701da5c7018c24bde918853e80ff5d530';
if (createHash('sha256').update(readFileSync(jar)).digest('hex') !== expectedJarSha256) throw Error('REFERENCE_SDK_HASH_MISMATCH');
const source = fileURLToPath(new URL('../../lib/vat-zatca-csr.ts', import.meta.url));
const compiled = ts.transpileModule(readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { createZatcaCsr } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const fixtures = {
  commonName: 'Yaqeen Synthetic Unit 01', taxpayerVatNumber: '399999999900003', branchName: 'Riyadh QA',
  organizationName: 'Yaqeen Synthetic Company', serialNumber: '1-YaqeenQA|2-1.0|3-12345678-1234-4234-8234-123456789012',
  invoiceType: '1100', registeredAddress: 'RRRD2929', businessCategory: 'Software', email: 'qa@example.invalid',
};
const command = (program, argv, options = {}) => {
  const result = spawnSync(program, argv, { encoding: 'utf8', timeout: 40_000, maxBuffer: 2 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw Error('REFERENCE_COMMAND_FAILED');
  return { stdout: result.stdout, stderr: result.stderr };
};
const cases = [];
let temporaryMaterialRemoved = true;
for (const environment of ['SIMULATION', 'PRODUCTION']) {
  const directory = mkdtempSync(join(tmpdir(), 'yaqeen-csr-reference-'));
  try {
    const properties = join(directory, 'csr.properties'), sdkCsr = join(directory, 'sdk.csr');
    const privateKeyPath = join(directory, 'synthetic.key'), appCsr = join(directory, 'application.csr');
    writeFileSync(properties, Object.entries({
      'csr.common.name': fixtures.commonName, 'csr.serial.number': fixtures.serialNumber,
      'csr.organization.identifier': fixtures.taxpayerVatNumber, 'csr.organization.unit.name': fixtures.branchName,
      'csr.organization.name': fixtures.organizationName, 'csr.country.name': 'SA', 'csr.invoice.type': fixtures.invoiceType,
      'csr.location.address': fixtures.registeredAddress, 'csr.industry.business.category': fixtures.businessCategory,
    }).map(([name, value]) => name + '=' + value).join('\n') + '\n');
    const sdk = command(java, ['-Djdk.sunec.disableNative=false', '-jar', jar,
      ...(environment === 'SIMULATION' ? ['-sim'] : []), '-csr', '-csrConfig', properties,
      '-privateKey', privateKeyPath, '-generatedCsr', sdkCsr, '-pem'], {
      cwd: directory, env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', SDK_CONFIG: config },
    });
    if (!sdk.stdout.includes('ZATCA E-Invoice Java SDK 3.4.8')) throw Error('REFERENCE_SDK_VERSION_MISMATCH');
    const privateKey = createPrivateKey(readFileSync(privateKeyPath));
    const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
    writeFileSync(appCsr, await createZatcaCsr({ ...fixtures, environment }, spki, async bytes => sign('sha256', bytes, privateKey)));
    const inspect = path => {
      const checked = command('openssl', ['req', '-in', path, '-noout', '-verify', '-text']);
      if (!/verify OK/i.test(checked.stderr + checked.stdout)) throw Error('REFERENCE_CSR_SIGNATURE_INVALID');
      const subject = command('openssl', ['req', '-in', path, '-noout', '-subject', '-nameopt', 'RFC2253']).stdout.trim();
      const publicKey = createPublicKey(command('openssl', ['req', '-in', path, '-noout', '-pubkey']).stdout)
        .export({ format: 'der', type: 'spki' });
      const san = checked.stdout.split('\n').find(line => line.trim().startsWith('DirName:'))?.trim();
      const der = Buffer.from(readFileSync(path, 'utf8').replace(/-----[^\n]+-----/g, '').replace(/\s/g, ''), 'base64');
      const template = Buffer.from(environment === 'SIMULATION' ? 'PREZATCA-Code-Signing' : 'ZATCA-Code-Signing');
      const templateTag = [0x0c, 0x13].find(tag => der.includes(Buffer.concat([
        Buffer.from([0x04, template.length + 2, tag, template.length]), template,
      ])));
      return { subject, publicKey, san, templateTag, templateMatches: templateTag !== undefined };
    };
    const sdkResult = inspect(sdkCsr), app = inspect(appCsr);
    const expectedSan = `DirName:/SN=${fixtures.serialNumber}/UID=${fixtures.taxpayerVatNumber}/title=${fixtures.invoiceType}/registeredAddress=${fixtures.registeredAddress}/businessCategory=${fixtures.businessCategory}`;
    const subjectIdentityMatches = [sdkResult, app].every(result =>
      [`CN=${fixtures.commonName}`, `O=${fixtures.organizationName}`, `OU=${fixtures.branchName}`, 'C=SA'].every(value =>
        result.subject.replace(/^subject=/, '').split(',').includes(value)));
    const result = { environment, sdkVersion: '3.4.8', subjectIdentityMatches,
      publicKeyMatches: sdkResult.publicKey.equals(spki) && app.publicKey.equals(spki),
      sanMatches: sdkResult.san === expectedSan && app.san === sdkResult.san,
      templateMatches: sdkResult.templateMatches && app.templateMatches, signaturesVerified: true,
      templateEncodings: { sdk: sdkResult.templateTag === 0x0c ? 'UTF8String' : 'PrintableString',
        application: app.templateTag === 0x0c ? 'UTF8String' : 'PrintableString' },
      requesterEmailDifference: 'Application CSR additionally retains its explicitly saved requester email; certificate may omit it.' };
    if (!result.subjectIdentityMatches || !result.publicKeyMatches || !result.sanMatches || !result.templateMatches) {
      process.stderr.write(JSON.stringify({ environment, ...result, sdkTemplateTag: sdkResult.templateTag, appTemplateTag: app.templateTag,
        sdkSanMatches: sdkResult.san === expectedSan, appSanMatches: app.san === expectedSan }) + '\n');
      throw Error('REFERENCE_CSR_IDENTITY_MISMATCH');
    }
    cases.push(result);
  } finally {
    try { rmSync(directory, { recursive: true, force: true }); }
    catch { temporaryMaterialRemoved = false; }
  }
}
if (!temporaryMaterialRemoved) throw Error('REFERENCE_TEMPORARY_MATERIAL_CLEANUP_FAILED');
// Semantic identity parity does not imply byte-identical CSR encodings or live
// acceptance. The two known template string encodings are reported explicitly.
process.stdout.write(JSON.stringify({ scope: 'SYNTHETIC_CSR_SDK348_IDENTITY_REFERENCE_ONLY', jarSha256: expectedJarSha256,
  authorityRequests: false, awsRequests: false, databaseWrites: false, releaseReady: false,
  temporaryMaterialRemoved, cases }, null, 2) + '\n');
