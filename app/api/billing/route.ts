import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
export async function GET(){
 const s=await createServerClient(); const {data:{user}}=await s.auth.getUser(); if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 const {data}=await s.from('subscriptions').select('*').eq('user_id',user.id).maybeSingle();
 return NextResponse.json({subscription:data, plans:[{code:'FREE',price:0},{code:'FAMILY',price:9},{code:'PROFESSIONAL',price:29},{code:'BUSINESS',price:79},{code:'ENTERPRISE',price:null}]});
}
