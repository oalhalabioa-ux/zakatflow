import {describe, expect, it} from 'vitest';
import {
  QA_AUTH_ORIGIN,
  canonicalizeAuthUrl,
  getAuthCallbackUrl,
  getAuthOrigin,
  getRecoveryRedirectUrl,
} from '../lib/auth/recovery-redirect';

describe('QA recovery redirect flow', () => {
  it('normalizes a unique preview deployment before any auth operation', () => {
    const unique = 'https://zakatflow-9h16dlmm1-oalhalabioa-9334.vercel.app/ar/login?invite=qa-safe';
    const canonical = canonicalizeAuthUrl(unique);
    expect(canonical).toBe(`${QA_AUTH_ORIGIN}/ar/login?invite=qa-safe`);
    expect(canonicalizeAuthUrl(canonical)).toBe(canonical);
  });

  it('keeps production aliases on their own origin', () => {
    for (const origin of [
      'https://zakatflow-mauve.vercel.app',
      'https://zakatflow-oalhalabioa-9334.vercel.app',
      'https://zakatflow-git-main-oalhalabioa-9334.vercel.app',
    ]) {
      expect(getAuthOrigin(origin)).toBe(origin);
      expect(getRecoveryRedirectUrl(origin, 'ar')).toBe(
        `${origin}/auth/callback?next=%2Fauth%2Freset-password`,
      );
      expect(getAuthCallbackUrl(origin, 'ar')).toBe(
        `${origin}/auth/callback?next=%2Far%2Fdashboard`,
      );
    }
  });

  it('keeps local development on its own origin', () => {
    expect(getAuthOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('uses one QA origin for forgot-password, callback, and reset on previews', () => {
    const origin = 'https://zakatflow-9h16dlmm1-oalhalabioa-9334.vercel.app';
    expect(getRecoveryRedirectUrl(origin, 'ar')).toBe(`${QA_AUTH_ORIGIN}/auth/callback?next=%2Fauth%2Freset-password`);
    expect(getAuthCallbackUrl(origin, 'ar')).toBe(
      `${QA_AUTH_ORIGIN}/auth/callback?next=%2Far%2Fdashboard`,
    );
  });

  it('preserves the safe callback next target', () => {
    const callback = getAuthCallbackUrl(
      'https://zakatflow-9h16dlmm1-oalhalabioa-9334.vercel.app',
      'ar',
    );
    expect(new URL(callback).searchParams.get('next')).toBe('/ar/dashboard');
  });
});
