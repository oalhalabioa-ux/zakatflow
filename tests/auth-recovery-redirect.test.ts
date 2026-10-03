import {describe, expect, it} from 'vitest';
import {
  QA_AUTH_ORIGIN,
  getAuthCallbackUrl,
  getAuthOrigin,
  getRecoveryRedirectUrl,
} from '@/lib/auth/recovery-redirect';

describe('QA recovery redirect flow', () => {
  it('normalizes Vercel deployment hosts to the stable QA origin', () => {
    expect(getAuthOrigin('https://zakatflow-9h16dlmm1-oalhalabioa-9334.vercel.app'))
      .toBe(QA_AUTH_ORIGIN);
    expect(getRecoveryRedirectUrl('https://zakatflow-9h16dlmm1-oalhalabioa-9334.vercel.app'))
      .toBe(`${QA_AUTH_ORIGIN}/auth/reset-password`);
  });

  it('keeps local development on its own origin', () => {
    expect(getAuthOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('builds a callback URL with the reset-compatible same origin', () => {
    const callback = getAuthCallbackUrl(
      'https://zakatflow-9h16dlmm1-oalhalabioa-9334.vercel.app',
      'ar',
    );
    expect(callback).toBe(
      `${QA_AUTH_ORIGIN}/auth/callback?next=%2Far%2Fdashboard`,
    );
  });
});
