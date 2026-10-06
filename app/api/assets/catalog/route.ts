import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth';

export async function GET(){
  try{
    const {supabase,user}=await requireUser();
    const {data:members,error:me}=await supabase.from('organization_members').select('organization_id').eq('user_id',user.id).eq('status','ACTIVE');
    if(me) throw me;
    const ids=[...new Set((members??[]).map((m:any)=>m.organization_id).filter(Boolean))];
    const [classes,types]=await Promise.all([
      supabase.from('asset_classes').select('code,name_en,name_ar,financial_classification_type').eq('active',true).order('code'),
      supabase.from('asset_types_v2').select('code,class_code,name_en,name_ar,default_legacy_asset_type').eq('active',true).order('code')
    ]);
    if(classes.error||types.error) throw classes.error||types.error;
    if(!ids.length) return NextResponse.json({organizations:[],entities:[],cost_centers:[],classes:classes.data??[],types:types.data??[]});
    const [orgs,entities,centers]=await Promise.all([
      supabase.from('organizations').select('id,name,organization_kind').in('id',ids),
      supabase.from('organization_entities').select('id,organization_id,name').in('organization_id',ids).eq('active',true),
      supabase.from('organization_cost_centers').select('id,organization_id,name,center_type').in('organization_id',ids).eq('active',true)
    ]);
    const error=orgs.error||entities.error||centers.error||classes.error||types.error;
    if(error) throw error;
    return NextResponse.json({organizations:orgs.data??[],entities:entities.data??[],cost_centers:centers.data??[],classes:classes.data??[],types:types.data??[]});
  }catch(e:any){
    return NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:500});
  }
}
