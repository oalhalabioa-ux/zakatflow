const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const guardedPicomatch = require('./guard-picomatch.cjs');
const { packages } = require('../package-lock.json');

const audit = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--audit-level=moderate', '--json'], {
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
});
process.stdout.write(audit.stdout ?? '');
process.stderr.write(audit.stderr ?? '');
if (audit.error) throw audit.error;
if (audit.status === 0) process.exit(0);
assert.equal(audit.status, 1, 'npm audit itself failed');

const report = JSON.parse(audit.stdout);
assert.equal(report.auditReportVersion, 2);
assert.ok(!report.error && report.vulnerabilities && report.metadata, 'Incomplete npm audit response');
const findings = Object.entries(report.vulnerabilities);
const advisoryUrl = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const isKnownAdvisory = (item) => item.name === 'picomatch' && item.dependency === 'picomatch'
  && item.url === advisoryUrl;
const guardedPackage = 'node_modules/picomatch';
assert.equal(packages[guardedPackage]?.version, '4.0.7');
assert.deepEqual(Object.keys(packages).filter((name) => name.endsWith('/picomatch')), [guardedPackage]);
assert.deepEqual(report.vulnerabilities.picomatch?.nodes, [guardedPackage]);

// npm also reports indirect findings for packages that depend on picomatch.
// Only accept the known advisory and its development-only dependency chain.
const mitigated = new Set();
for (;;) {
  const prev = mitigated.size;
  for (const [name, finding] of findings) {
    if (finding.nodes.length > 0 && finding.nodes.every((node) => packages[node]?.dev === true)
      && finding.via.length > 0 && finding.via.every((item) => typeof item === 'string'
        ? mitigated.has(item) : name === 'picomatch' && isKnownAdvisory(item))) {
      mitigated.add(name);
    }
  }
  if (mitigated.size === prev) break;
}
assert.ok(mitigated.has('picomatch'), 'The exact mitigated advisory could not be verified');
guardedPicomatch(true);
const unresolved = findings.filter(([name, finding]) => !mitigated.has(name) && finding.severity !== 'low' && finding.severity !== 'info');
assert.deepEqual(unresolved.map(([name]) => name), [], 'Unmitigated npm advisories');
console.log('GHSA-fc5q-39xc-vjpf remains in the published package metadata. Verified the local parser mitigation and development-only dependency chain.');
