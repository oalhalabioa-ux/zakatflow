const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const packageDir = resolve(__dirname, '../node_modules/picomatch');
const packageFile = resolve(packageDir, 'package.json');

const digest = (text) => createHash('sha256').update(text).digest('hex');

function guardPicomatch(checkOnly) {
  // Production-only installs do not include the development dependency.
  if (!existsSync(packageFile)) {
    assert.ok(!checkOnly, 'Expected the audited development dependency to be installed');
    return;
  }
  const { version } = JSON.parse(readFileSync(packageFile, 'utf8'));
  if (version !== '4.0.7') {
    assert.ok(!checkOnly, 'The mitigation applies only to picomatch 4.0.7');
    return;
  }
  const parserPath = resolve(packageDir, 'lib/parse.js');
  const parser = readFileSync(parserPath, 'utf8');
  const patchedDigest = 'd754da904e901d943a721346fcd98b66e63482e325ef3ff49dbce79962983f10';
  if (digest(parser) !== patchedDigest) {
    assert.ok(!checkOnly, 'The picomatch parser mitigation is missing');
    assert.equal(digest(parser), '4e1e05447668aa1e94366c5516a2bcd8f5fff800cc92b1d0cd7d77703b8618c4');

    // Block repeated extglobs, including nested branches, before regex generation.
    // The conservative substring check also rejects escaped spellings of these markers.
    const validation = "  if (input.includes('+(') || input.includes('*(')) {\n"
      + "    throw new SyntaxError('Repeated extglobs are disabled (CVE-2026-112366)');\n"
      + "  }\n";
    const normalization = '  input = REPLACEMENTS[input] || input;';
    assert.equal(parser.split(normalization).length, 3, 'Unexpected picomatch entry points');
    const guarded = parser.replaceAll(normalization, validation + normalization);
    assert.equal(digest(guarded), patchedDigest, 'Unexpected guarded picomatch parser');
    writeFileSync(parserPath, guarded);
  }

  const picomatch = require(packageDir);
  for (const pattern of ['+(*)', '+(*a)', '*(*a)', '+(*a?(b))', './*(*a@(b))']) {
    assert.throws(() => picomatch.makeRe(pattern), /Repeated extglobs are disabled/);
    assert.throws(() => picomatch.parse(pattern), /Repeated extglobs are disabled/);
  }
  assert.ok(picomatch('tests/**/*.test.ts')('tests/financial-reports/example.test.ts'));
  assert.ok(!picomatch('tests/**/*.test.ts')('app/example.ts'));
}

module.exports = guardPicomatch;
if (require.main === module) guardPicomatch(false);
