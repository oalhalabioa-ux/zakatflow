import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(req:Request){
 const url=new URL(req.url);const code=url.searchParams.get('code');let next=url.searchParams.get('next')||'/ar/dashboard';
 if(!next.startsWith('/')||next.startsWith('//')) next='/ar/dashboard';
 if(code){const supabase=await supabaseServer();const {error}=await supabase.auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(new URL(next,url.origin));}
 return NextResponse.redirect(new URL('/ar/login?error=auth',url.origin));
}
