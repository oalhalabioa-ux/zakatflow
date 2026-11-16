import {appOrigin, safeNext} from '../routing';
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
  return appOrigin(trimOrigin(currentOrigin));
}

/** A reverse proxy may expose its internal bind address in Request.url. */
export function getAuthServerOrigin(requestUrl: string, configuredOrigin?: string): string {
  const request = new URL(requestUrl);
  const internal = ['0.0.0.0', '127.0.0.1', 'localhost', '[::]', '[::1]'].includes(request.hostname);
  if (internal && configuredOrigin?.trim()) {
    const configured = new URL(configuredOrigin.trim());
    if (configured.protocol !== 'https:' && configured.protocol !== 'http:') {
      throw new Error('INVALID_AUTH_APP_URL');
    }
    return appOrigin(configured.origin);
  }
  return request.origin;
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
  return getAuthCallbackUrl(currentOrigin, locale, configuredOrigin, null, `/auth/reset-password?lang=${locale === 'en' ? 'en' : 'ar'}`);
}

export function getAuthCallbackUrl(
  currentOrigin: string,
  locale: string,
  configuredOrigin?: string,
  invite?: string | null,
  next: string = `/${locale}/dashboard`,
): string {
  const recovery = /^\/auth\/reset-password(?:\?lang=(?:ar|en))?$/.test(next);
  const params = new URLSearchParams({next: recovery ? next : safeNext(next, locale), lang: locale === 'en' ? 'en' : 'ar'});
  if (invite) params.set('invite', invite);
  return `${getAuthOrigin(currentOrigin, configuredOrigin)}/auth/callback?${params.toString()}`;
}

/** Put the locale first so Supabase's standard Go templates can select copy
 * without relying on a user's previously saved profile language. */
export function getEmailAuthCallbackUrl(currentOrigin:string,locale:string,invite?:string|null,next?:string,signup=false){
 const url=new URL(getAuthCallbackUrl(currentOrigin,locale,undefined,invite,next));
 const params=new URLSearchParams({lang:locale==='en'?'en':'ar'});
 for(const [key,value] of url.searchParams)if(key!=='lang')params.set(key,value);
 if(signup)params.set('flow','signup');
 url.search=params.toString();return url.toString();
}
