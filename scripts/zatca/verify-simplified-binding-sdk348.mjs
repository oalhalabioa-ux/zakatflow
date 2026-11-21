// Offline differential, synthetic identities/keys only. This is NOT an invoice
// signer, gateway adapter, compliance submission or authority vulnerability test.
import { build } from 'esbuild';
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify, X509Certificate } from 'node:crypto';
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
const directory = mkdtempSync(join(tmpdir(), 'simplified-binding-sdk348-'));
const digest = bytes => createHash('sha256').update(bytes).digest('base64');
const hexTextDigest = bytes => Buffer.from(createHash('sha256').update(bytes).digest('hex')).toString('base64');
const ds = 'http://www.w3.org/2000/09/xmldsig#', xades = 'http://uri.etsi.org/01903/v1.3.2#';
try {
  mkdirSync(join(directory, 'node_modules'));
  symlinkSync(realpathSync(resolve('node_modules/libxml2-wasm')), join(directory, 'node_modules/libxml2-wasm'), 'dir');
  const bundled = await build({ stdin: { contents: `export {prepareZatcaSdk345QaDocument} from './tests/helpers/zatca-sdk345-qa-profile';
    export {buildUnsignedZatcaXml} from './lib/zatca-phase2-xml';
    export {parseZatca348SdkValidation} from './lib/zatca-sdk-validation';
    export {prepareZatcaInvoiceHash} from './lib/zatca-xml-hash';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', target: 'node22', format: 'cjs', external: ['libxml2-wasm'], logLevel: 'silent' });
  const entry = join(directory, 'probe.cjs'); writeFileSync(entry, bundled.outputFiles[0].text);
  const { prepareZatcaSdk345QaDocument, buildUnsignedZatcaXml, parseZatca348SdkValidation, prepareZatcaInvoiceHash } = createRequire(import.meta.url)(entry);
  const { XmlDocument, XmlC14NMode, ParseOption } = await import('libxml2-wasm');
  const canonical = (xml, xpath) => {
    const document = XmlDocument.fromString(xml, { option: ParseOption.XML_PARSE_NONET | ParseOption.XML_PARSE_NO_XXE });
    try {
      const nodes = document.find(xpath, { ds, xades }); if (nodes.length !== 1) throw Error('AMBIGUOUS_PROBE_ELEMENT');
      return nodes[0].canonicalizeToString({ mode: XmlC14NMode.XML_C14N_1_1, withComments: false });
    } finally { document.dispose(); }
  };
  const openssl = (...a) => execFileSync('/usr/bin/openssl', a, { cwd: directory, stdio: 'pipe', timeout: 10000 });
  openssl('req', '-new', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp256k1', '-nodes', '-keyout', 'root.key', '-out', 'root.pem',
    '-days', '2', '-subj', '/C=SA/O=Yaqeen QA/CN=Synthetic QA Root', '-addext', 'basicConstraints=critical,CA:TRUE');
  openssl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp256k1', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/C=SA/O=Yaqeen QA/CN=Synthetic QA EGS');
  openssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-set_serial', '99331', '-days', '1', '-out', 'leaf.pem');
  const certificate = readFileSync(join(directory, 'leaf.pem'), 'utf8'), key = readFileSync(join(directory, 'leaf.key'));
  const leaf = new X509Certificate(certificate), publicKey = createPublicKey(key);
  const at = new Date(Date.parse(leaf.validFrom) + 1000), local = new Date(at.getTime() + 3 * 3600000).toISOString();
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.certPath = join(directory, 'cert.txt'); config.privateKeyPath = join(directory, 'private-key.pem'); config.pihPath = join(directory, 'pih.txt');
  writeFileSync(config.certPath, leaf.raw.toString('base64'));
  writeFileSync(config.privateKeyPath, createPrivateKey(key).export({ format: 'der', type: 'sec1' }).toString('base64'), { mode: 0o600 });
  const localConfig = join(directory, 'sdk-config.json'); writeFileSync(localConfig, JSON.stringify(config));
  const run = parameters => spawnSync(java, ['-jar', jar, ...parameters], { cwd: directory, encoding: 'utf8', timeout: 40000,
    maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', SDK_CONFIG: localConfig } });
  const signature = xml => Buffer.from(/<ds:SignatureValue>([^<]+)<\/ds:SignatureValue>/.exec(xml)?.[1] ?? '', 'base64');
  const setSignature = (xml, bytes) => {
    const encoded = bytes.toString('base64');
    let result = xml.replace(/<ds:SignatureValue>[^<]+<\/ds:SignatureValue>/, `<ds:SignatureValue>${encoded}</ds:SignatureValue>`);
    const pattern = /(<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text\/plain">)([^<]+)(<\/cbc:EmbeddedDocumentBinaryObject>)/;
    const qr = pattern.exec(result); if (!qr) throw Error('QR_PROBE_REQUIRED');
    const source = Buffer.from(qr[2], 'base64'), values = []; let offset = 0;
    while (offset < source.length) {
      const tag = source[offset++], length = source[offset++];
      if (tag !== values.length + 1 || offset + length > source.length) throw Error('QR_PROBE_INVALID');
      values.push(source.subarray(offset, offset + length)); offset += length;
    }
    if (values.length !== 9) throw Error('QR_PROBE_INVALID');
    values[6] = Buffer.from(encoded);
    const payload = Buffer.concat(values.map((v, i) => Buffer.concat([Buffer.from([i + 1, v.length]), v]))).toString('base64');
    return result.replace(pattern, (_, open, _old, close) => open + payload + close);
  };
  const results = [];
  for (const kind of ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']) {
    const draft = { organization_id: randomUUID(), invoice_number: 'SYNTHETIC-BINDING-' + kind, document_type: kind, invoice_category: 'SIMPLIFIED',
      issue_date: local.slice(0, 10), issue_time: local.slice(11, 19), seller_name: 'Yaqeen Synthetic QA', seller_vat_number: '399999999900003',
      seller_address: 'Synthetic street', seller_building_number: '1234', seller_district: 'Synthetic district', seller_additional_number: '5678',
      seller_postal_code: '12345', seller_city: 'Riyadh', ...(kind !== 'INVOICE' ? { billing_reference: 'SYNTHETIC-ORIGINAL', note_reason: 'Synthetic correction' } : {}),
      lines: [{ item_name: 'Synthetic item', quantity: 1, unit_price: 1, tax_category: 'S', tax_rate: 15 }] };
    const previous = Buffer.from(createHash('sha256').update('0').digest('hex')).toString('base64');
    const context = { invoiceUuid: randomUUID(), invoiceCounter: '1', previousInvoiceHash: previous, supplyDate: draft.issue_date,
      sellerId: { scheme: 'OTH', value: 'SIMULATIONQA' }, paymentMeansCode: '30' };
    writeFileSync(config.pihPath, previous);
    const legacy = await prepareZatcaSdk345QaDocument(draft, context, { certificate, fingerprintSha256: createHash('sha256').update(leaf.raw).digest('hex'), signingTime: at }, async hash => sign('sha256', hash, key));
    const signedInfo = setSignature(legacy.xml, sign('sha256', Buffer.from(canonical(legacy.xml, '//ds:SignedInfo')), key));
    const changedTime = new Date(at.getTime() + 1000).toISOString().slice(0, 19);
    let tampered = legacy.xml.replace(/<xades:SigningTime>[^<]+<\/xades:SigningTime>/, `<xades:SigningTime>${changedTime}</xades:SigningTime>`);
    const properties = /<xades:SignedProperties\b[^>]*>[\s\S]*?<\/xades:SignedProperties>/.exec(tampered)[0];
    const detached = properties.replace('<xades:SignedProperties ', `<xades:SignedProperties xmlns:xades="${xades}" `)
      .replace(/<ds:(DigestMethod|DigestValue|X509IssuerName|X509SerialNumber)(?=[ >])/g, `<ds:$1 xmlns:ds="${ds}"`);
    tampered = tampered.replace(/(<ds:Reference\b[^>]*URI="#xadesSignedProperties"[^>]*>[\s\S]*?<ds:DigestValue>)[^<]+/, (_, prefix) => prefix + hexTextDigest(detached));
    // Negative control: the changed properties/reference cannot retain a valid
    // SignedInfo signature. Keep signature/QR bytes fixed; do not re-sign.
    const changedInfoWithOriginalSignature = setSignature(tampered, signature(signedInfo));
    if (verify('sha256', Buffer.from(canonical(changedInfoWithOriginalSignature, '//ds:SignedInfo')), publicKey, signature(signedInfo)))
      throw Error('SIGNED_INFO_TAMPER_CONTROL_FAILED');
    const unsignedPath = join(directory, kind + '-unsigned.xml'), sdkPath = join(directory, kind + '-sdk.xml');
    writeFileSync(unsignedPath, buildUnsignedZatcaXml(draft, context).xml);
    const signing = run(['-sign', '-invoice', unsignedPath, '-signedInvoice', sdkPath]);
    if (signing.status !== 0 || signing.error) throw Error('REFERENCE_SIGNING_FAILED');
    const sdkXml = readFileSync(sdkPath, 'utf8');
    const profiles = [['SYNTHETIC_COMPATIBILITY_CONTROL', legacy.xml], ['CHANGED_PROPERTIES_WITHOUT_RESIGNING', tampered],
      ['SAME_SERIALIZATION_SIGNED_INFO_SIGNATURE', signedInfo], ['OFFICIAL_SDK_SIGNED_CONTROL', sdkXml]];
    for (const [profile, xml] of profiles) {
      const path = join(directory, kind + '-' + profile + '.xml'); writeFileSync(path, xml);
      const execution = run(['-validate', '-invoice', path]);
      const checked = parseZatca348SdkValidation(String(execution.stdout) + String(execution.stderr), execution.status, 'SIMPLIFIED');
      const invoiceHash = (await prepareZatcaInvoiceHash(xml)).invoiceHashBase64;
      const info = canonical(xml, '//ds:SignedInfo'), sig = signature(xml);
      const row = { kind, profile, sdkPassed: checked.passed, stages: checked.stages, codes: checked.codes,
        invoiceHashUnchanged: invoiceHash === legacy.invoiceHashBase64,
        invoiceHashMatchesEmbeddedReference: new RegExp(`<ds:Reference\\b[^>]*Id="invoiceSignedData"[^>]*>[\\s\\S]*?<ds:DigestValue>${invoiceHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</ds:DigestValue>`).test(xml),
        signatureUnchanged: sig.equals(signature(legacy.xml)),
        verifiesInvoiceHash: verify('sha256', Buffer.from(invoiceHash, 'base64'), publicKey, sig),
        verifiesCanonicalSignedInfo: verify('sha256', Buffer.from(info), publicKey, sig),
        xmlSha256: createHash('sha256').update(xml).digest('hex'), canonicalSignedInfoSha256: digest(info) };
      results.push(row); console.log(JSON.stringify(row));
    }
  }
  const expected = results.length === 12 && results.every(r => r.invoiceHashMatchesEmbeddedReference
    && (r.invoiceHashUnchanged || r.profile === 'OFFICIAL_SDK_SIGNED_CONTROL') && (r.profile === 'SAME_SERIALIZATION_SIGNED_INFO_SIGNATURE'
    ? !r.sdkPassed && r.verifiesCanonicalSignedInfo && !r.verifiesInvoiceHash
      && r.codes.length === 1 && r.codes[0] === 'signatureValue' && r.stages.length === 6
      && r.stages.find(s => s.stage === 'SIGNATURE')?.result === 'FAILED'
      && r.stages.filter(s => s.stage !== 'SIGNATURE').every(s => s.result === 'PASSED')
    : r.sdkPassed && r.verifiesInvoiceHash && !r.verifiesCanonicalSignedInfo
      && (r.profile !== 'CHANGED_PROPERTIES_WITHOUT_RESIGNING' || r.signatureUnchanged)));
  console.log(JSON.stringify({ scope: 'SDK_348_OFFLINE_SYNTHETIC_BINDING_DIFFERENTIAL_ONLY', sdkJarSha256: jarDigest,
    observationsReproduced: expected, signedInfoTamperControlsRejected: 3, cases: results.length, authorityRequests: 0, activationAllowed: false }));
  if (!expected) process.exitCode = 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
