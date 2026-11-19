import { describe, expect, it } from 'vitest';
import { parseLegacyZatcaSdkValidation } from './zatca-sdk-validation';

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
