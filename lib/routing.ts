export type Locale = 'ar' | 'en';
export const APP_ORIGIN = 'https://app.yaqeenbiz.com';
export const MARKETING_HOSTS = new Set(['yaqeenbiz.com', 'www.yaqeenbiz.com']);
const workspaceRoutes = new Set(['dashboard','account','assets','assessments','billing','budget-planning','cash-and-banks','debt-advances','debt-collection','debt-openings','debt-report','debts','employee-advances','enterprise','financial-events','financial-position','governance','guide','investments','invoice-register','liquidity','loans','lots','notifications','organizations','payables','payments','prices','qard-loans','receivables','reports','settings','transactions','users','vat','workflow']);
export function externalRequestUrl(requestUrl: URL, host: string | null): URL {
  const hostname = host?.toLowerCase().split(':')[0];
  const result = new URL(requestUrl);
  if (hostname && (MARKETING_HOSTS.has(hostname) || hostname === 'app.yaqeenbiz.com')) {
    result.hostname=hostname;result.port='';result.protocol='https:';
  }
  return result;
}
export function requestLocale(url: URL, saved?: string): Locale {
  const prefix = url.pathname.split('/')[1];
  if (prefix === 'ar' || prefix === 'en') return prefix;
  const query = url.searchParams.get('lang') || url.searchParams.get('locale');
  if (query === 'ar' || query === 'en') return query;
  return saved === 'en' ? 'en' : 'ar';
}
export function appOrigin(origin: string): string {
  const url = new URL(origin);
  return MARKETING_HOSTS.has(url.hostname) ? APP_ORIGIN : url.origin;
}
export function safeNext(value: string | null | undefined, locale: string): string {
  const fallback = `/${locale === 'en' ? 'en' : 'ar'}/dashboard`;
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback;
    const parsed = new URL(value, APP_ORIGIN);
    if (parsed.origin !== APP_ORIGIN || /^\/(?:ar\/|en\/)?(?:login|auth)(?:\/|$)/.test(parsed.pathname)) return fallback;
    return value;
  } catch { return fallback; }
}
export function languageSwitch(href: string, locale: Locale): string {
  const url = new URL(href, APP_ORIGIN);
  url.pathname = `/${locale}/login`;
  url.searchParams.delete('lang'); url.searchParams.delete('locale');
  const next = url.searchParams.get('next');
  if (next) {
    const destination=new URL(safeNext(next.replace(/^\/(ar|en)(?=\/)/, `/${locale}`),locale),APP_ORIGIN);
    if (destination.pathname.startsWith('/admin') || destination.searchParams.has('lang')) destination.searchParams.set('lang',locale);
    url.searchParams.set('next',destination.pathname+destination.search);
  }
  return url.pathname + url.search;
}
/** Redirect before creating a PKCE verifier. Never transport credentials between hosts. */
export function routingRedirect(url: URL, locale: Locale): URL | null {
  const marketing = MARKETING_HOSTS.has(url.hostname);
  const path = url.pathname;
  if (/^\/(ar|en)\/?$/.test(path)) {
    const target = new URL('/', url); target.searchParams.set('lang', locale); return target;
  }
  if (marketing && /^\/auth\/(callback|reset-password)/.test(path)) {
    const target = new URL(`/${locale}/login`, APP_ORIGIN);
    target.searchParams.set('error', path.includes('reset-password') ? 'recovery_origin' : 'auth');
    target.searchParams.set('next', safeNext(url.searchParams.get('next'), locale));
    if (path.includes('reset-password')) target.searchParams.set('mode', 'reset');
    return target;
  }
  // This is the canonical recovery destination, not a legacy login alias.
  if (/^\/auth\/reset-password\/?$/.test(path)) return null;
  const alias = /^\/(?:auth\/)?(login|sign-in|signin|forgot-password|reset-password)\/?$/.exec(path);
  if (alias) {
    const target = new URL(`/${locale}/login`, appOrigin(url.origin));
    for (const key of ['next', 'invite', 'error']) { const value = url.searchParams.get(key); if (value) target.searchParams.set(key, value); }
    if (alias[1].includes('password')) target.searchParams.set('mode', 'reset');
    return target;
  }
  const recoveryAlias = /^\/(ar|en)\/(forgot-password|reset-password)\/?$/.exec(path);
  if (recoveryAlias) {
    const target = new URL(`/${locale}/login`, appOrigin(url.origin));target.searchParams.set('mode','reset');return target;
  }
  if (workspaceRoutes.has(path.split('/')[1])) {
    return new URL(`/${locale}${path}${url.search}`, appOrigin(url.origin));
  }
  if (marketing && (/^\/(ar|en)\//.test(path) || /^\/admin(?:\/|$)/.test(path) || /^\/api(?:\/|$)/.test(path))) {
    const target = new URL(path + url.search, APP_ORIGIN); return target;
  }
  if (url.hostname === 'app.yaqeenbiz.com' && path === '/') return new URL(`/${locale}/dashboard`, url);
  return null;
}
