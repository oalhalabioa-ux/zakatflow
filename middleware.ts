import {createServerClient} from '@supabase/ssr';
import {NextResponse, type NextRequest} from 'next/server';
import {requestLocale, routingRedirect, MARKETING_HOSTS, externalRequestUrl} from './lib/routing';
import {supabaseUrl} from './lib/supabase/config';

export async function middleware(request: NextRequest) {
  const publicUrl=externalRequestUrl(request.nextUrl,request.headers.get('host'));
  const locale = requestLocale(publicUrl, request.cookies.get('yaqeen-locale')?.value);
  const target = routingRedirect(publicUrl, locale);
  if (target) return NextResponse.redirect(target, 307);
  const headers = new Headers(request.headers);
  headers.set('x-yaqeen-locale', locale);
  let response = NextResponse.next({request: {headers}});
  const privateRoute = !MARKETING_HOSTS.has(publicUrl.hostname) &&
    (/^\/(ar|en)\/(?!login(?:\/|$))/.test(request.nextUrl.pathname) || /^\/admin(?:\/|$)/.test(request.nextUrl.pathname));
  // These seven pages each verify getUser and the current database owner role
  // before reading any administrative data. Do not repeat Auth in middleware:
  // getClaims still calls Auth for symmetric signing keys.
  const ownerPage = /^\/admin(?:\/(?:users|companies|subscriptions|payments|analytics|settings))?\/?$/.test(request.nextUrl.pathname);
  if (privateRoute) response.headers.set('Cache-Control', 'private, no-store');
  // Callback and recovery must own their exchange; middleware must never consume their code.
  if (privateRoute && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = createServerClient(supabaseUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      cookieOptions: {sameSite:'lax',secure:publicUrl.protocol==='https:'},
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookies) {
          cookies.forEach(({name, value}) => request.cookies.set(name, value));
          headers.set('cookie', request.cookies.toString());
          response = NextResponse.next({request: {headers}});
          cookies.forEach(({name, value, options}) => response.cookies.set(name, value, options));
        },
      },
    });
    if (ownerPage) {
      // Session maintenance only: refresh cookies here, never authorize from session data.
      // Every owner page independently verifies getUser and the database role.
      await supabase.auth.getSession();
    } else {
      // Claims verification avoids a redundant Auth user-record request on
      // asymmetric JWT projects. Protected pages still check the current user
      // and platform_owner role against the database before returning data.
      const {data: claimsData, error: claimsError} = await supabase.auth.getClaims();
      if (claimsError || !claimsData?.claims?.sub) {
        const login = new URL(`/${locale}/login`, publicUrl);
        login.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
        const redirect = NextResponse.redirect(login);
        response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
        redirect.headers.set('Cache-Control','private, no-store');
        return redirect;
      }
    }
    response.headers.set('Cache-Control', 'private, no-store');
  }
  if (/^\/auth\//.test(publicUrl.pathname) || /^\/(ar|en)\/login\/?$/.test(publicUrl.pathname)) {
    response.headers.set('Cache-Control','private, no-store');
    response.headers.set('Referrer-Policy',['/auth/confirm','/auth/email-action'].includes(publicUrl.pathname)&&request.method==='GET'?'strict-origin':'no-referrer');
  }
  if (request.cookies.get('yaqeen-locale')?.value !== locale) response.cookies.set('yaqeen-locale', locale, {path: '/', sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', maxAge: 31536000});
  return response;
}
export const config = {matcher: ['/((?!_next/|brand/|icons/|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|webp|svg|css|js|woff2?)$).*)']};
