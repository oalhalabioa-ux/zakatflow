import { X509Certificate } from 'node:crypto';
import { z } from 'zod';

function publicUrl(value: string) {
  if (value.length > 2048 || !/^[\x21-\x7e]+$/.test(value)) return false;
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash;
  } catch { return false; }
}
const oidSchema = z.string().max(128).regex(/^[0-2](?:\.[0-9]+)+$/);
const urls = z.array(z.string().refine(publicUrl)).max(8);
export const simulationCertificateDiscoverySchema = z.object({
  issuer: z.string().min(1).max(2048), validFrom: z.string().datetime(), validTo: z.string().datetime(),
  signatureAlgorithmOid: oidSchema, issuerCertificateUrls: urls, ocspUrls: urls, crlDistributionUrls: urls,
  policyOids: z.array(oidSchema).max(8), extendedKeyUsage: z.array(oidSchema).max(12),
  digitalSignature: z.boolean(), keyUsageCritical: z.boolean(), keyCertSign: z.boolean(),
  clientAuthentication: z.boolean(), selfIssued: z.boolean(),
  discoveryHintsTrusted: z.literal(false), trustVerified: z.literal(false), activationAllowed: z.literal(false),
}).strict();
export type SimulationCertificateDiscovery = z.infer<typeof simulationCertificateDiscoverySchema>;

/** Bounded DER discovery, not certificate signature, PKIX, policy or revocation
 * verification. No executable, network, trust store, private key or subject output.
 * Published URIs are UNTRUSTED hints; this function never follows any of them.
 */
export function inspectSimulationCertificateDiscovery(input: Buffer): SimulationCertificateDiscovery {
  const fail = (): never => { throw Error('QA_CERTIFICATE_DISCOVERY_INVALID'); };
  if (!Buffer.isBuffer(input) || !input.length || input.length > 32768) fail();
  const bytes = Buffer.from(input);
  type Node = { tag: number; start: number; end: number };
  function node(offset: number, limit: number): Node {
    if (offset < 0 || offset + 2 > limit || limit > bytes.length) return fail();
    const tag = bytes[offset++]; if ((tag & 31) === 31) return fail();
    let size = bytes[offset++];
    if (size & 128) {
      const n = size & 127;
      if (!n || n > 3 || offset + n > limit || !bytes[offset]) return fail();
      size = 0; for (let i = 0; i < n; i++) size = size * 256 + bytes[offset++];
      if (size < 128) return fail();
    }
    if (offset + size > limit) return fail();
    return { tag, start: offset, end: offset + size };
  }
  function children(n: Node, tag?: number) {
    if (tag !== undefined && n.tag !== tag) return fail();
    const all: Node[] = []; let offset = n.start;
    while (offset < n.end) {
      if (all.length >= 128) return fail();
      const child = node(offset, n.end); all.push(child); offset = child.end;
    }
    return all;
  }
  function oid(n: Node) {
    if (n.tag !== 6 || n.end === n.start || n.end - n.start > 64) return fail();
    const parts: bigint[] = []; let v = BigInt(0), beginning = true;
    for (let i = n.start; i < n.end; i++) {
      const b = bytes[i]; if (beginning && b === 128) return fail();
      v = v * BigInt(128) + BigInt(b & 127); beginning = !(b & 128);
      if (beginning) { parts.push(v); v = BigInt(0); }
    }
    if (!beginning || !parts.length) return fail();
    const first = parts.shift()!, a = first < BigInt(40) ? BigInt(0) : first < BigInt(80) ? BigInt(1) : BigInt(2);
    const value = [a, first - a * BigInt(40), ...parts].join('.');
    if (!oidSchema.safeParse(value).success) return fail();
    return value;
  }
  function wrapped(value: Node, tag: number) {
    if (value.tag !== 4) return fail();
    const inner = node(value.start, value.end);
    if (inner.tag !== tag || inner.end !== value.end) return fail();
    return inner;
  }
  function addUri(n: Node, into: Set<string>) {
    if (n.tag !== 0x86) return;
    const raw = bytes.subarray(n.start, n.end);
    if (raw.some(b => b > 127)) return;
    const value = raw.toString('ascii');
    if (publicUrl(value) && into.size < 8) into.add(value);
  }
  try {
    const cert = new X509Certificate(bytes); if (!cert.raw.equals(bytes)) return fail();
    const root = node(0, bytes.length); if (root.tag !== 0x30 || root.end !== bytes.length) return fail();
    const outer = children(root), tbs = outer[0];
    if (outer.length !== 3 || tbs.tag !== 0x30 || outer[1].tag !== 0x30) return fail();
    const signatureAlgorithmOid = oid(children(outer[1])[0]);
    const wrappers = children(tbs).filter(n => n.tag === 0xa3);
    if (wrappers.length > 1) return fail();
    const extensions = new Map<string, { critical: boolean; value: Node }>();
    if (wrappers.length) {
      const list = children(wrappers[0]); if (list.length !== 1) return fail();
      for (const extension of children(list[0], 0x30)) {
        const fields = children(extension, 0x30);
        if (fields.length !== 2 && fields.length !== 3) return fail();
        const key = oid(fields[0]); if (extensions.has(key)) return fail();
        let critical = false;
        if (fields.length === 3) {
          const flag = fields[1];
          if (flag.tag !== 1 || flag.end - flag.start !== 1 || bytes[flag.start] !== 255) return fail();
          critical = true;
        }
        const value = fields.at(-1)!; if (value.tag !== 4) return fail();
        extensions.set(key, { critical, value });
      }
    }
    const issuers = new Set<string>(), ocsp = new Set<string>(), crls = new Set<string>(), policies = new Set<string>();
    const aia = extensions.get('1.3.6.1.5.5.7.1.1');
    if (aia) for (const access of children(wrapped(aia.value, 0x30))) {
      const fields = children(access, 0x30); if (fields.length !== 2) return fail();
      const method = oid(fields[0]);
      if (method === '1.3.6.1.5.5.7.48.2') addUri(fields[1], issuers);
      if (method === '1.3.6.1.5.5.7.48.1') addUri(fields[1], ocsp);
    }
    const distribution = extensions.get('2.5.29.31');
    if (distribution) for (const point of children(wrapped(distribution.value, 0x30))) {
      for (const field of children(point, 0x30)) if (field.tag === 0xa0) {
        const names = children(field); if (names.length !== 1) return fail();
        if (names[0].tag === 0xa0) for (const name of children(names[0])) addUri(name, crls);
      }
    }
    const policy = extensions.get('2.5.29.32');
    if (policy) for (const info of children(wrapped(policy.value, 0x30))) {
      const fields = children(info, 0x30); if (!fields.length || fields.length > 2) return fail();
      const value = oid(fields[0]); if (policies.size < 8) policies.add(value);
    }
    const usage = extensions.get('2.5.29.15'); let digitalSignature = false, keyCertSign = false;
    if (usage) {
      const value = wrapped(usage.value, 3), n = value.end - value.start, unused = bytes[value.start];
      if (n < 2 || n > 3 || unused > 7 || (bytes[value.end - 1] & ((1 << unused) - 1))) return fail();
      digitalSignature = Boolean(bytes[value.start + 1] & 128); keyCertSign = Boolean(bytes[value.start + 1] & 4);
    }
    const eku = extensions.get('2.5.29.37');
    const extendedKeyUsage = eku ? children(wrapped(eku.value, 0x30)).map(oid) : [];
    return simulationCertificateDiscoverySchema.parse({ issuer: cert.issuer.replace(/[\x00-\x1f\x7f]/g, ' '),
      validFrom: new Date(cert.validFrom).toISOString(), validTo: new Date(cert.validTo).toISOString(), signatureAlgorithmOid,
      issuerCertificateUrls: [...issuers], ocspUrls: [...ocsp], crlDistributionUrls: [...crls], policyOids: [...policies], extendedKeyUsage,
      digitalSignature, keyUsageCritical: usage?.critical ?? false, keyCertSign,
      clientAuthentication: extendedKeyUsage.includes('1.3.6.1.5.5.7.3.2'), selfIssued: cert.checkIssued(cert),
      discoveryHintsTrusted: false, trustVerified: false, activationAllowed: false });
  } catch { return fail(); }
}
