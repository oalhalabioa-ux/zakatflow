import {describe, expect, it} from 'vitest';
import {
  canonicalizeAuthUrl,
  getAuthCallbackUrl,
  getAuthOrigin,
  getRecoveryRedirectUrl,
} from '../lib/auth/recovery-redirect';

describe('deployment recovery redirect flow', () => {
  it('keeps a unique preview on its own origin before auth operations', () => {
    const unique = 'https://zakatflow-9h16dlmm1-oalhalabioa-9334.vercel.app/ar/login?invite=qa-safe';
    const canonical = canonicalizeAuthUrl(unique);
    expect(canonical).toBe(unique);
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

  it('keeps forgot-password, callback, and reset on the same preview', () => {
    const origin = 'https://zakatflow-9h16dlmm1-oalhalabioa-9334.vercel.app';
    expect(getRecoveryRedirectUrl(origin, 'ar')).toBe(`${origin}/auth/callback?next=%2Fauth%2Freset-password`);
    expect(getAuthCallbackUrl(origin, 'ar')).toBe(
      `${origin}/auth/callback?next=%2Far%2Fdashboard`,
    );
  });

  it('supports an explicitly configured callback origin without dropping the invite', () => {
    const stable = 'https://staging.example.com';
    expect(canonicalizeAuthUrl('https://preview.example.com/ar/login?invite=safe', `${stable}/`)).toBe(`${stable}/ar/login?invite=safe`);
    expect(getAuthCallbackUrl('https://preview.example.com', 'ar', stable, 'safe')).toBe(`${stable}/auth/callback?next=%2Far%2Fdashboard&invite=safe`);
  });

  it('preserves the safe callback next target', () => {
    const callback = getAuthCallbackUrl(
      'https://zakatflow-9h16dlmm1-oalhalabioa-9334.vercel.app',
      'ar',
    );
    expect(new URL(callback).searchParams.get('next')).toBe('/ar/dashboard');
  });
});
