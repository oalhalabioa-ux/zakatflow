import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { establishRecoverySession } from '@/lib/auth/recovery-session';
import { getAuthServerOrigin } from '@/lib/auth/recovery-redirect';
import {requestLocale, safeNext} from '@/lib/routing';
import {verifiedEmail} from '@/lib/auth/registration';

export const dynamic = 'force-dynamic';
function redirectPrivate(url: URL) {
 const response = NextResponse.redirect(url);
 response.headers.set('Cache-Control', 'private, no-store');
 response.headers.set('Referrer-Policy', 'no-referrer');
 return response;
}

export async function GET(req:Request){
 const url=new URL(req.url);const code=url.searchParams.get('code');const invite=url.searchParams.get('invite');
 const locale=requestLocale(url, url.searchParams.get('next')?.startsWith('/en/')?'en':undefined);
 const requested=url.searchParams.get('next');
 const next=requested&&/^\/auth\/reset-password(?:\?lang=(?:ar|en))?$/.test(requested)?`/auth/reset-password?lang=${locale}`:safeNext(requested,locale);
 const fallback=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:process.env.NEXT_PUBLIC_APP_URL;
 const origin=getAuthServerOrigin(req.url,process.env.NODE_ENV==='production'?fallback:undefined);
 if(url.searchParams.has('token_hash')){
  const confirm=new URL('/auth/confirm',origin);
  for(const key of ['token_hash','type','lang','next','invite']){const value=url.searchParams.get(key);if(value)confirm.searchParams.set(key,value)}
  return redirectPrivate(confirm);
 }
 if(code){
  const supabase=await supabaseServer();
  const {session,error}=await establishRecoverySession(supabase,code);
  if(session&&!error){
   if(next.startsWith('/auth/reset-password')===false&&!verifiedEmail((await supabase.auth.getUser()).data.user)){
    await supabase.auth.signOut();
    return redirectPrivate(new URL(`/${locale}/login?state=verify`,origin));
   }
   if(invite){
    const {error:inviteError}=await supabase.rpc('accept_organization_invitation',{p_token:invite});
    if(inviteError){
     await supabase.auth.signOut();
     const login=new URL(`/${locale}/login`,origin);
     login.searchParams.set('error',inviteError.message.includes('EMAIL_MISMATCH')?'invite_email':'invite_invalid');
     return redirectPrivate(login);
    }
   }
   return redirectPrivate(new URL(next,origin));
  }
 }
 const login = new URL(`/${locale}/login`,origin);
 login.searchParams.set('error',url.searchParams.get('flow')==='signup'?'verification':'auth'); login.searchParams.set('next',safeNext(requested,locale));
 if(invite)login.searchParams.set('invite',invite);
 return redirectPrivate(login);
}
