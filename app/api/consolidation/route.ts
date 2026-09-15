import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { consolidate } from '@/engine/consolidation';

export async function GET() {
  const supabase = await createServerClient();
  const { data:{user} } = await supabase.auth.getUser();
  if(!user) return NextResponse.json({error:'Unauthorized'},{status:401});
  const { data:profile } = await supabase.from('profiles').select('base_currency').eq('id',user.id).maybeSingle();
  const { data:rows,error } = await supabase.from('zakat_assessments').select('id,zakatable_value,total_zakat_due,currency,entity_id').eq('user_id',user.id).in('status',['CONFIRMED','PARTIALLY_PAID','PAID']);
  if(error) return NextResponse.json({error:error.message},{status:400});
  const ids=[...new Set((rows||[]).map(r=>r.entity_id).filter(Boolean))];
  const { data:entities } = ids.length ? await supabase.from('organization_entities').select('id,name').in('id',ids) : {data:[] as any[]};
  const names=new Map((entities||[]).map(e=>[e.id,e.name]));
  return NextResponse.json(consolidate((rows||[]).map(r=>({entityId:r.entity_id||'personal',entityName:names.get(r.entity_id)||'Personal',assessmentId:r.id,zakatableValue:r.zakatable_value||0,zakatDue:r.total_zakat_due||0,currency:r.currency})), profile?.base_currency||'SAR'));
}
