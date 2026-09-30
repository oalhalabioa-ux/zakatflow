import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(req:Request){
 const url=new URL(req.url);const code=url.searchParams.get('code');const invite=url.searchParams.get('invite');let next=url.searchParams.get('next')||'/ar/dashboard';
 if(!next.startsWith('/')||next.startsWith('//')||next.includes('\\')||/[\u0000-\u001f]/.test(next)) next='/ar/dashboard';
 if(code){
  const supabase=await supabaseServer();
  const {error}=await supabase.auth.exchangeCodeForSession(code);
  if(!error){
   if(invite){
    const {error:inviteError}=await supabase.rpc('accept_organization_invitation',{p_token:invite});
    if(inviteError){
     await supabase.auth.signOut();
     const locale=next.startsWith('/en/')?'en':'ar';
     const login=new URL(`/${locale}/login`,url.origin);
     login.searchParams.set('error',inviteError.message.includes('EMAIL_MISMATCH')?'invite_email':'invite_invalid');
     return NextResponse.redirect(login);
    }
   }
   return NextResponse.redirect(new URL(next,url.origin));
  }
 }
 const locale=next.startsWith('/en/')?'en':'ar';
 return NextResponse.redirect(new URL(`/${locale}/login?error=auth`,url.origin));
}
