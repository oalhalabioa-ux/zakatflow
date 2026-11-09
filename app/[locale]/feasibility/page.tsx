import {notFound,redirect} from 'next/navigation';
import {supabaseServer} from '@/lib/supabase/server';
import FeasibilityWorkspace from '@/components/FeasibilityWorkspace';
import {evaluateFeasibilityAccess} from '@/lib/feasibility/access';
import './feasibility.css';

export const dynamic='force-dynamic';
export default async function FeasibilityPage({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;
 // Public navigation flags are not authorization. Block direct URL access when this QA-only module is disabled.
 if(process.env.NEXT_PUBLIC_FEASIBILITY_STUDIES!=='true')notFound();
 const supabase=await supabaseServer();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user)redirect('/'+locale+'/login');
 const {data:grant,error}=await supabase.from('feasibility_access_grants')
  .select('status,starts_at,ends_at').eq('user_id',user.id).maybeSingle();
 if(error)throw new Error('FEASIBILITY_ENTITLEMENT_LOOKUP_FAILED');
 const access=evaluateFeasibilityAccess(grant);
 if(!access.canRead)notFound();
 return <FeasibilityWorkspace locale={locale} userId={user.id} readOnly={!access.canWrite}/>;
}
