import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth';

export async function GET(){
  const {supabase,user}=await requireUser();
  const allowed=['SYSTEM_ADMIN','SHARIA_REVIEWER','ORGANIZATION_ADMIN'];
  const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).single();
  if(!profile || !allowed.includes(profile.role)) return NextResponse.json({error:'FORBIDDEN'},{status:403});
  const {data,error}=await supabase.from('zakat_rules').select('*,zakat_methods(code,name_ar,name_en)').order('created_at',{ascending:false});
  if(error) return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json(data);
}

export async function POST(req:Request){
  const {supabase,user}=await requireUser();
  const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).single();
  if(!profile || !['SYSTEM_ADMIN','SHARIA_REVIEWER'].includes(profile.role)) return NextResponse.json({error:'FORBIDDEN'},{status:403});
  const body=await req.json();
  const {data,error}=await supabase.from('zakat_rules').insert({...body,review_status:'PENDING'}).select().single();
  if(error) return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json(data,{status:201});
}
