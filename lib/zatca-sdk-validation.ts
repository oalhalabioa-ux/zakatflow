/** Interpret the observed legacy Java SDK 3.0.8 console format only.
 * Its process exits zero even on GLOBAL FAILED. Never infer compliance from an
 * exit code, a partial schema pass or absence of parsed error codes. This helper
 * is not an authority acceptance/issuance operation and has no production caller.
 */
export function parseLegacyZatcaSdkValidation(output: string, exitCode: number | null) {
  if (output.length > 1024 * 1024) throw new Error('SDK_OUTPUT_TOO_LARGE');
  const versions = [...output.matchAll(/ZATCA E-Invoice Java SDK ([0-9]+\.[0-9]+\.[0-9]+)/g)].map(m => m[1]);
  const summaries = [...output.matchAll(/GLOBAL VALIDATION RESULT\s*=\s*(PASSED|FAILED)\b/g)].map(m => m[1]);
  const stages = [...output.matchAll(/\[(XSD|EN|KSA)\] validation result\s*:\s*(PASSED|FAILED)\b/g)].map(m => ({ stage: m[1], result: m[2] }));
  const codes = [...new Set([...output.matchAll(/CODE\s*:\s*([A-Za-z0-9_.-]+)/g)].map(m => m[1]))];
  const complete = ['XSD', 'EN', 'KSA'].every(name => stages.filter(s => s.stage === name).length === 1)
    && stages.length === 3 && stages.every(s => s.result === 'PASSED');
  const supportedFormat = versions.length === 1 && versions[0] === '3.0.8';
  const passed = supportedFormat && exitCode === 0 && summaries.length === 1 && summaries[0] === 'PASSED'
    && complete && !codes.length && !/\[ERROR\]|Exception|\bFAILED\b/.test(output);
  return { sdkVersion: versions.length === 1 ? versions[0] : null, supportedFormat, passed, stages, codes, scope: 'LEGACY_SDK_CHECK_ONLY' as const };
}

/** Observed owner-supplied Java 3.4.8 console format, offline diagnostic only.
 * This SDK also exits zero on validation failures. Require every stage for the
 * requested category, not just GLOBAL PASSED or a process status. A pass does
 * not establish signed-properties security, CA trust or authority acceptance.
 */
export function parseZatca348SdkValidation(output: string, exitCode: number | null, category: 'STANDARD' | 'SIMPLIFIED') {
  if (output.length > 1024 * 1024) throw new Error('SDK_OUTPUT_TOO_LARGE');
  const versions = [...output.matchAll(/ZATCA E-Invoice Java SDK ([0-9]+\.[0-9]+\.[0-9]+)/g)].map(m => m[1]);
  const summaries = [...output.matchAll(/GLOBAL VALIDATION RESULT\s*=\s*(PASSED|FAILED)\b/g)].map(m => m[1]);
  const stages = [...output.matchAll(/\[([A-Z]+)\] validation result\s*:\s*(PASSED|FAILED)\b/g)]
    .map(m => ({ stage: m[1], result: m[2] }));
  const codes = [...new Set([...output.matchAll(/CODE\s*:\s*([A-Za-z0-9_.-]+)/g)].map(m => m[1]))];
  const required = category === 'STANDARD' ? ['XSD', 'EN', 'KSA', 'PIH']
    : category === 'SIMPLIFIED' ? ['XSD', 'EN', 'KSA', 'QR', 'SIGNATURE', 'PIH'] : [];
  const complete = required.length > 0 && stages.length === required.length
    && required.every(name => stages.filter(s => s.stage === name).length === 1)
    && stages.every(s => s.result === 'PASSED');
  const supportedFormat = versions.length === 1 && versions[0] === '3.4.8';
  const passed = supportedFormat && exitCode === 0 && summaries.length === 1 && summaries[0] === 'PASSED'
    && complete && codes.length === 0 && !/\[(?:ERROR|WARN)\]|Exception|\bFAILED\b/.test(output);
  return { sdkVersion: versions.length === 1 ? versions[0] : null, supportedFormat, passed, stages, codes,
    scope: 'SDK_348_OFFLINE_CHECK_ONLY' as const };
}
