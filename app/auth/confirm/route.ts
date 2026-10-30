import {NextResponse} from 'next/server';
import {supabaseServer} from '../../../lib/supabase/server';
import {getAuthServerOrigin} from '../../../lib/auth/recovery-redirect';
import {requestLocale,safeNext} from '../../../lib/routing';
import {loginCopy} from '../../../lib/auth/login-copy';
import {verifiedEmail} from '../../../lib/auth/registration';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function origin(req:Request){const fallback=process.env.VERCEL_ENV==='preview'&&process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:process.env.NEXT_PUBLIC_APP_URL;return getAuthServerOrigin(req.url,process.env.NODE_ENV==='production'?fallback:undefined)}
function redirect(url:URL){return NextResponse.redirect(url,{status:303,headers})}
/** strict-origin hides the token URL while preserving Origin on native form POSTs.
 * no-referrer makes browsers send Origin: null, which our same-origin guard rejects.
 * Email scanners may follow GET links. Only an explicit form submission consumes the token. */
export async function GET(req:Request){
 const url=new URL(req.url),locale=requestLocale(url),ar=locale==='ar',copy=loginCopy[locale];
 const type=url.searchParams.get('type'),token=url.searchParams.get('token_hash');
 if(!token||token.length>512||!['signup','email','invite'].includes(type??''))return redirect(new URL(`/${locale}/login?error=${type==='invite'?'invite_invalid':'verification'}`,origin(req)));
 const title=type==='invite'?copy.platformInvite:type==='signup'?copy.confirmEmail:copy.confirmSignIn;
 const hidden=['token_hash','type','lang','next','invite'].map(key=>`<input type="hidden" name="${key}" value="${escapeHtml(key==='lang'?locale:url.searchParams.get(key)??'')}">`).join('');
 return new Response(`<!doctype html><html lang="${locale}" dir="${ar?'rtl':'ltr'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Yaqeen Business</title><link rel="stylesheet" href="/auth/confirm/styles"><main><img src="/brand/owner/logo-navy-gold.png" alt="Yaqeen Business"><h1>${title}</h1><p>${copy.continueSecure}</p><form method="post" action="/auth/confirm">${hidden}<button type="submit">${title}</button></form></main></html>`,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'strict-origin','Content-Security-Policy':"default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
}
export async function POST(req:Request){
 const publicOrigin=origin(req);
 if(req.headers.get('origin')!==publicOrigin)return new Response('Forbidden',{status:403,headers});
 const form=await req.formData(),locale=form.get('lang')==='en'?'en':'ar',type=form.get('type'),token=form.get('token_hash');
 const login=new URL(`/${locale}/login`,publicOrigin);
 login.searchParams.set('error',type==='invite'?'invite_invalid':type==='signup'?'verification':'auth');
 if(typeof token!=='string'||token.length>512||(type!=='signup'&&type!=='email'&&type!=='invite'))return redirect(login);
 const supabase=await supabaseServer();
 const {data,error}=await supabase.auth.verifyOtp({token_hash:token,type});
 if(error||!verifiedEmail(data.user)){if(data.session)await supabase.auth.signOut();return redirect(login)}
 if(type==='invite')return redirect(new URL(`/auth/reset-password?lang=${locale}&purpose=invite`,publicOrigin));
 const invite=form.get('invite');
 if(typeof invite==='string'&&invite){const {error:invitationError}=await supabase.rpc('accept_organization_invitation',{p_token:invite});if(invitationError){await supabase.auth.signOut();login.searchParams.set('error','invite_invalid');return redirect(login)}}
 return redirect(new URL(safeNext(typeof form.get('next')==='string'?String(form.get('next')):null,locale),publicOrigin));
}
