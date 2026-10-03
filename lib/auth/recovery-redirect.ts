export const QA_AUTH_ORIGIN = 'https://zakatflow-git-feature-auth-password-login-qa-oalhalabioa-9334.vercel.app';

function trimOrigin(value: string): string {
  return value.replace(/\\/+$/, '');
}

/**
 * Keep PKCE verifier storage and the recovery callback on one browser origin.
 * QA Preview uses its stable branch alias; local development keeps its own origin.
 */
export function getAuthOrigin(currentOrigin: string, configuredOrigin?: string): string {
  const configured = configuredOrigin?.trim();
  if (configured) return trimOrigin(configured);
  try {
    const url = new URL(currentOrigin);
    if (url.hostname.endsWith('.vercel.app') && url.hostname.startsWith('zakatflow-')) {
      return QA_AUTH_ORIGIN;
    }
  } catch {
    // Fall back to the caller's origin below.
  }
  return trimOrigin(currentOrigin);
}

export function getRecoveryRedirectUrl(currentOrigin: string, configuredOrigin?: string): string {
  return `${getAuthOrigin(currentOrigin, configuredOrigin)}/auth/reset-password`;
}

export function getAuthCallbackUrl(currentOrigin: string, locale: string, configuredOrigin?: string, invite?: string | null): string {
  const params = new URLSearchParams({ next: `/${locale}/dashboard` });
  if (invite) params.set('invite', invite);
  return `${getAuthOrigin(currentOrigin, configuredOrigin)}/auth/callback?${params.toString()}`;
}
