import { describe, expect, it } from 'vitest';
import { parseLegacyZatcaSdkValidation, parseZatca348SdkValidation } from './zatca-sdk-validation';

const banner = 'Welcome to ZATCA E-Invoice Java SDK 3.0.8';
const pass = `${banner}\n[XSD] validation result : PASSED\n[EN] validation result : PASSED\n[KSA] validation result : PASSED\n*** GLOBAL VALIDATION RESULT = PASSED`;
describe('legacy SDK result interpretation', () => {
  it('recognizes a complete legacy pass while retaining its limited scope', () => {
    expect(parseLegacyZatcaSdkValidation(pass, 0)).toMatchObject({ passed: true, sdkVersion: '3.0.8', scope: 'LEGACY_SDK_CHECK_ONLY' });
  });
  it('rejects the observed zero-exit failure rather than reporting compliance', () => {
    const log = `${banner}\n[XSD] validation result : PASSED\n[EN] validation result : PASSED\n[KSA] validation result : FAILED\n[ERROR] CODE : BR-KSA-27, MESSAGE : QR required\n*** GLOBAL VALIDATION RESULT = FAILED`;
    expect(parseLegacyZatcaSdkValidation(log, 0)).toMatchObject({ passed: false, codes: ['BR-KSA-27'] });
  });
  it.each([null, 1, 137])('rejects an unsuccessful or unfinished process %s', code => {
    expect(parseLegacyZatcaSdkValidation(pass, code).passed).toBe(false);
  });
  it.each([
    '', banner, pass.replace('[KSA] validation result : PASSED', ''),
    pass + '\nGLOBAL VALIDATION RESULT = PASSED', pass + '\n[EN] validation result : PASSED',
    pass.replace('3.0.8', '3.4.6'), pass + '\n[ERROR] validation interrupted', pass + '\njava.lang.RuntimeException',
    pass + '\nCODE : BR-S-10, MESSAGE : conflicting result',
  ])('rejects incomplete, unsupported or contradictory reports', output => {
    expect(parseLegacyZatcaSdkValidation(output, 0).passed).toBe(false);
  });
});

const sdk348Banner = 'Welcome to ZATCA E-Invoice Java SDK 3.4.8';
const sdk348Report = (stages: string[]) => `${sdk348Banner}\n${stages.map(stage => `[${stage}] validation result : PASSED`).join('\n')}\nGLOBAL VALIDATION RESULT = PASSED`;
const standard348 = sdk348Report(['XSD', 'EN', 'KSA', 'PIH']);
const simplified348 = sdk348Report(['XSD', 'EN', 'KSA', 'QR', 'SIGNATURE', 'PIH']);
describe('owner-supplied SDK 3.4.8 offline diagnostics', () => {
  it('recognizes observed standard and simplified reports without promoting their scope', () => {
    expect(parseZatca348SdkValidation(standard348, 0, 'STANDARD')).toMatchObject({ passed: true, sdkVersion: '3.4.8', scope: 'SDK_348_OFFLINE_CHECK_ONLY' });
    expect(parseZatca348SdkValidation(simplified348, 0, 'SIMPLIFIED').passed).toBe(true);
    expect(parseLegacyZatcaSdkValidation(standard348, 0).passed).toBe(false);
  });
  it('rejects the observed zero-exit application signature failure', () => {
    const failed = simplified348.replace('[XSD] validation result : PASSED', '[XSD] validation result : FAILED')
      .replace('GLOBAL VALIDATION RESULT = PASSED', 'GLOBAL VALIDATION RESULT = FAILED')
      + '\n[ERROR] CODE : SAXParseException, MESSAGE : SigningCertificateV2 not allowed';
    expect(parseZatca348SdkValidation(failed, 0, 'SIMPLIFIED')).toMatchObject({ passed: false, codes: ['SAXParseException'] });
  });
  it.each(['QR', 'SIGNATURE', 'PIH'])('requires the independent %s stage for simplified documents', missing => {
    const report = simplified348.replace(`[${missing}] validation result : PASSED\n`, '');
    expect(parseZatca348SdkValidation(report, 0, 'SIMPLIFIED').passed).toBe(false);
  });
  it.each([
    '', sdk348Banner, standard348, simplified348 + '\nGLOBAL VALIDATION RESULT = PASSED',
    simplified348 + '\n[SIGNATURE] validation result : PASSED', simplified348 + '\n[OTHER] validation result : PASSED',
    simplified348 + '\n[WARN] CODE : timeStamp, MESSAGE : mismatch', simplified348 + '\n[ERROR] incomplete',
    simplified348 + '\njava.lang.RuntimeException', simplified348.replace('3.4.8', '3.4.5'),
  ])('rejects incomplete, duplicate, unsupported and warning-bearing reports', output => {
    expect(parseZatca348SdkValidation(output, 0, 'SIMPLIFIED').passed).toBe(false);
  });
  it.each([null, 1, 137])('rejects unsuccessful or interrupted processes %s', code => {
    expect(parseZatca348SdkValidation(simplified348, code, 'SIMPLIFIED').passed).toBe(false);
  });
});
