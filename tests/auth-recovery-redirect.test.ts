import {describe, expect, it} from 'vitest';
import {
  canonicalizeAuthUrl,
  getAuthCallbackUrl,
  getAuthOrigin,
  getAuthServerOrigin,
  getRecoveryRedirectUrl,
} from '../lib/auth/recovery-redirect';

describe('deployment recovery redirect flow', () => {
  it('uses the public app origin when Hostinger exposes its internal bind address', () => {
    const origin = getAuthServerOrigin('https://0.0.0.0:3000/auth/callback?code=example', 'https://www.yaqeenbiz.com/');
    expect(new URL('/ar/dashboard', origin).href).toBe('https://app.yaqeenbiz.com/ar/dashboard');
    expect(new URL('/ar/login?error=auth', origin).href).toBe('https://app.yaqeenbiz.com/ar/login?error=auth');
  });

  it('keeps public previews on their own origin even when app URL points to production', () => {
    expect(getAuthServerOrigin('https://preview.example.com/auth/callback', 'https://www.yaqeenbiz.com')).toBe('https://preview.example.com');
    expect(getAuthServerOrigin('http://localhost:3000/auth/callback')).toBe('http://localhost:3000');
  });

  it('rejects non-web schemes in the configured proxy fallback', () => {
    expect(() => getAuthServerOrigin('http://0.0.0.0:3000/auth/callback', 'javascript:alert(1)')).toThrow('INVALID_AUTH_APP_URL');
  });
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
        `${origin}/auth/callback?next=%2Fauth%2Freset-password%3Flang%3Dar&lang=ar`,
      );
      expect(getAuthCallbackUrl(origin, 'ar')).toBe(
        `${origin}/auth/callback?next=%2Far%2Fdashboard&lang=ar`,
      );
    }
  });

  it('keeps local development on its own origin', () => {
    expect(getAuthOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('keeps forgot-password, callback, and reset on the same preview', () => {
    const origin = 'https://zakatflow-9h16dlmm1-oalhalabioa-9334.vercel.app';
    expect(getRecoveryRedirectUrl(origin, 'ar')).toBe(`${origin}/auth/callback?next=%2Fauth%2Freset-password%3Flang%3Dar&lang=ar`);
    expect(getAuthCallbackUrl(origin, 'ar')).toBe(
      `${origin}/auth/callback?next=%2Far%2Fdashboard&lang=ar`,
    );
  });

  it('supports an explicitly configured callback origin without dropping the invite', () => {
    const stable = 'https://staging.example.com';
    expect(canonicalizeAuthUrl('https://preview.example.com/ar/login?invite=safe', `${stable}/`)).toBe(`${stable}/ar/login?invite=safe`);
    expect(getAuthCallbackUrl('https://preview.example.com', 'ar', stable, 'safe')).toBe(`${stable}/auth/callback?next=%2Far%2Fdashboard&lang=ar&invite=safe`);
  });

  it('preserves the safe callback next target', () => {
    const callback = getAuthCallbackUrl(
      'https://zakatflow-9h16dlmm1-oalhalabioa-9334.vercel.app',
      'ar',
    );
    expect(new URL(callback).searchParams.get('next')).toBe('/ar/dashboard');
  });
});
