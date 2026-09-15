import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth';

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params; const {supabase,user}=await requireUser();
  const {data:profile}=await supabase.from('profiles').select('role').eq('id',user.id).single();
  if(!profile || !['SYSTEM_ADMIN','SHARIA_REVIEWER'].includes(profile.role)) return NextResponse.json({error:'FORBIDDEN'},{status:403});
  const body=await req.json();
  if(!['APPROVED','REJECTED','CHANGES_REQUESTED'].includes(body.decision)) return NextResponse.json({error:'INVALID_DECISION'},{status:400});
  const {error:ruleError}=await supabase.from('zakat_rules').update({review_status:body.decision,review_notes:body.notes??null}).eq('id',id);
  if(ruleError) return NextResponse.json({error:ruleError.message},{status:400});
  const {data,error}=await supabase.from('sharia_rule_reviews').insert({rule_id:id,reviewer_id:user.id,decision:body.decision,notes:body.notes??null,reviewed_at:new Date().toISOString()}).select().single();
  if(error) return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json(data);
}
