function trimOrigin(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Keep PKCE verifier storage and every auth callback on one browser origin.
 * Each deployment keeps its own session and database context. A stable
 * callback origin may be explicitly configured; previews must not silently
 * switch to another branch and its data.
 */
export function getAuthOrigin(currentOrigin: string, configuredOrigin?: string): string {
  const configured = configuredOrigin?.trim();
  if (configured) return trimOrigin(configured);
  return trimOrigin(currentOrigin);
}

export function canonicalizeAuthUrl(currentHref: string, configuredOrigin?: string): string {
  const current = new URL(currentHref);
  const canonical = new URL(getAuthOrigin(current.origin, configuredOrigin));
  if (canonical.origin === current.origin) return current.toString();
  current.protocol = canonical.protocol;
  current.host = canonical.host;
  return current.toString();
}

export function getRecoveryRedirectUrl(currentOrigin: string, locale: string, configuredOrigin?: string): string {
  return getAuthCallbackUrl(currentOrigin, locale, configuredOrigin, null, '/auth/reset-password');
}

export function getAuthCallbackUrl(
  currentOrigin: string,
  locale: string,
  configuredOrigin?: string,
  invite?: string | null,
  next: string = `/${locale}/dashboard`,
): string {
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : `/${locale}/dashboard`;
  const params = new URLSearchParams({next: safeNext});
  if (invite) params.set('invite', invite);
  return `${getAuthOrigin(currentOrigin, configuredOrigin)}/auth/callback?${params.toString()}`;
}
