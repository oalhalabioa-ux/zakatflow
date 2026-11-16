import {NextResponse} from 'next/server';
import {supabaseUrl} from '../../../lib/supabase/config';
import {getAuthServerOrigin} from '../../../lib/auth/recovery-redirect';
import {requestLocale} from '../../../lib/routing';
import {escapeEmail} from '../../../lib/email/design';
import copy from '../../../lib/email/copy.json';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
function origin(req:Request){return getAuthServerOrigin(req.url,process.env.NEXT_PUBLIC_APP_URL)}
function destination(raw:unknown,appOrigin:string){
 if(typeof raw!=='string'||raw.length>4096)return null;
 try{const url=new URL(raw),auth=new URL(supabaseUrl());
  if(url.origin!==auth.origin||url.username||url.password||url.pathname!=='/auth/v1/verify'||url.searchParams.get('type')!=='email_change'||!url.searchParams.get('token'))return null;
  const target=url.searchParams.get('redirect_to');if(target){const u=new URL(target);if(u.origin!==appOrigin||u.pathname!=='/auth/callback')return null;}
  return url;
 }catch{return null}
}
export async function GET(req:Request){
 const url=new URL(req.url),locale=requestLocale(url),c=copy['email-change'][locale],publicOrigin=origin(req),raw=url.searchParams.get('confirmation_url');
 if(!destination(raw,publicOrigin))return NextResponse.redirect(new URL(`/${locale}/login?error=auth`,publicOrigin),{status:303,headers});
 const hidden=escapeEmail(raw!);
 return new Response(`<!doctype html><html lang="${locale}" dir="${locale==='ar'?'rtl':'ltr'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeEmail(c.title)}</title><link rel="stylesheet" href="/auth/confirm/styles"><main><img src="/brand/owner/logo-navy-gold.png" alt="Yaqeen Business"><h1>${escapeEmail(c.title)}</h1><p>${escapeEmail(c.body)}</p><form method="post" action="/auth/email-action"><input type="hidden" name="confirmation_url" value="${hidden}"><input type="hidden" name="lang" value="${locale}"><button type="submit">${escapeEmail(c.action)}</button></form></main></html>`,{headers:{...headers,'Referrer-Policy':'strict-origin','Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
}
export async function POST(req:Request){
 const publicOrigin=origin(req);
 if(req.headers.get('origin')!==publicOrigin)return new Response('Forbidden',{status:403,headers});
 const form=await req.formData(),locale=form.get('lang')==='en'?'en':'ar',url=destination(form.get('confirmation_url'),publicOrigin);
 return NextResponse.redirect(url??new URL(`/${locale}/login?error=auth`,publicOrigin),{status:303,headers});
}
