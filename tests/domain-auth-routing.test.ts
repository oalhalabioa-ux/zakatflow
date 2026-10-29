import {describe,it,expect} from 'vitest';
import {appOrigin,requestLocale,routingRedirect,safeNext,languageSwitch,externalRequestUrl} from '../lib/routing';
import {getAuthCallbackUrl,getRecoveryRedirectUrl} from '../lib/auth/recovery-redirect';
import {verifySupabaseEnvironment} from '../lib/supabase/config';
import {friendlyAuthError,authCopy} from '../lib/auth/copy';
import {ownerEnglish} from '../lib/i18n/owner';

describe('domain boundaries',()=>{
 it('uses a known external host behind an internal reverse proxy',()=>{
  const url=externalRequestUrl(new URL('http://0.0.0.0:3000/en/login'),'www.yaqeenbiz.com');
  expect(routingRedirect(url,'en')?.href).toBe('https://app.yaqeenbiz.com/en/login');
  expect(externalRequestUrl(new URL('https://preview.vercel.app/en/login'),'evil.test').hostname).toBe('preview.vercel.app');
 });
 it('supports unprefixed legacy module links and localized recovery aliases',()=>{
  expect(routingRedirect(new URL('https://yaqeenbiz.com/assets?lang=en'),'en')?.pathname).toBe('/en/assets');
  expect(routingRedirect(new URL('https://app.yaqeenbiz.com/en/forgot-password'),'en')?.searchParams.get('mode')).toBe('reset');
 });
 for(const host of ['yaqeenbiz.com','www.yaqeenbiz.com'])for(const lang of ['ar','en'] as const){
  it(`${host} ${lang}: directs login and all workspace routes to app`,()=>{
   for(const path of [`/${lang}/login`,`/${lang}/assets`,`/${lang}/users`,'/admin/payments']){
    const source=new URL(`https://${host}${path}?lang=${lang}&next=%2Fadmin&invite=test-invite`);
    const result=routingRedirect(source,requestLocale(source));
    expect(result?.origin).toBe('https://app.yaqeenbiz.com');expect(result?.pathname).toBe(path);expect(result?.searchParams.get('invite')).toBe('test-invite');
    expect(routingRedirect(result!,lang)).toBeNull();
   }
  });
  it(`${host} ${lang}: never forwards old OAuth credentials between origins`,()=>{
   const target=routingRedirect(new URL(`https://${host}/auth/callback?code=must-not-cross&lang=${lang}`),lang)!;
   expect(target.pathname).toBe(`/${lang}/login`);expect(target.searchParams.has('code')).toBe(false);
  });
 }
 it('keeps previews and local development independent',()=>{
  for(const origin of ['https://preview.vercel.app','http://localhost:3000']){
   expect(appOrigin(origin)).toBe(origin);expect(routingRedirect(new URL(origin+'/en/login'),'en')).toBeNull();
  }
 });
 it('resolves legacy aliases and query language without a redirect loop',()=>{
  for(const alias of ['/login','/auth/login','/sign-in','/signin','/forgot-password','/reset-password']){
   const url=new URL('https://www.yaqeenbiz.com'+alias+'?lang=en&next=%2Fen%2Faccount');
   const target=routingRedirect(url,requestLocale(url))!;expect(target.pathname).toBe('/en/login');expect(routingRedirect(target,'en')).toBeNull();
  }
 });
 it('gives explicit language priority over saved preference',()=>{
  expect(requestLocale(new URL('https://yaqeenbiz.com/?lang=ar'),'en')).toBe('ar');
  expect(requestLocale(new URL('https://app.yaqeenbiz.com/en/login?lang=ar'))).toBe('en');
 });
 it('switches login language while preserving invitation and return route',()=>{
  const value=languageSwitch('/ar/login?next=%2Far%2Faccount&invite=qa&mode=reset','en');const url=new URL(value,'https://app.yaqeenbiz.com');
  expect(url.pathname).toBe('/en/login');expect(url.searchParams.get('next')).toBe('/en/account');expect(url.searchParams.get('invite')).toBe('qa');expect(url.searchParams.get('mode')).toBe('reset');
 });
 for(const unsafe of ['https://evil.test','//evil.test','/\\evil.test','/%2f%2fevil.test','/%5cevil.test','/\n/evil.test','/en/login','/auth/callback','/%zz']){
  it(`rejects unsafe return destination ${JSON.stringify(unsafe)}`,()=>expect(safeNext(unsafe,'en')).toBe('/en/dashboard'));
 }
 it('keeps an owner return route',()=>expect(safeNext('/admin?lang=en','en')).toBe('/admin?lang=en'));
 it('changes the owner return language with the login language',()=>{
  const switched=languageSwitch('/ar/login?next=%2Fadmin%3Flang%3Dar','en');
  expect(new URL(switched,'https://app.yaqeenbiz.com').searchParams.get('next')).toBe('/admin?lang=en');
 });
});

describe('localized recovery and errors',()=>{
 for(const lang of ['ar','en'])it(`${lang}: shares one PKCE callback and preserves recovery language`,()=>{
  const url=new URL(getRecoveryRedirectUrl('https://preview.vercel.app',lang));
  expect(url.pathname).toBe('/auth/callback');expect(url.searchParams.get('next')).toBe(`/auth/reset-password?lang=${lang}`);expect(url.searchParams.get('lang')).toBe(lang);
  expect(new URL(getAuthCallbackUrl('https://preview.vercel.app',lang)).pathname).toBe('/auth/callback');
 });
 it('maps authentication failures without exposing provider messages',()=>{
  expect(friendlyAuthError('Invalid login credentials','en')).toBe(authCopy.en.invalidCredentials);
  expect(friendlyAuthError('email not confirmed','ar')).toBe(authCopy.ar.confirmEmail);
  expect(friendlyAuthError('unexpected secret from remote','en')).toBe(authCopy.en.requestFailed);
 });
 it('has English translations for every owner dictionary key',()=>{
  expect(Object.keys(ownerEnglish).length).toBeGreaterThan(100);
  for(const value of Object.values(ownerEnglish))expect(value).not.toMatch(/[\u0600-\u06ff]/);
 });
});

describe('QA database isolation',()=>{
 it('fails closed if QA points to Production or an unexpected project',()=>{
  for(const ref of ['ejpzcsfwqziqxwhvqnay',undefined,'other'])expect(()=>verifySupabaseEnvironment('https://ejpzcsfwqziqxwhvqnay.supabase.co','qa',ref)).toThrow('QA_DATABASE_ISOLATION_REQUIRED');
 });
 it('accepts only the explicitly selected QA project',()=>expect(verifySupabaseEnvironment('https://weucywfwbdnomtlkjurl.supabase.co','qa','weucywfwbdnomtlkjurl')).toContain('weucywfwbdnomtlkjurl'));
});
