import {feasibilitySelfServeEnabled,readFeasibilityGrant} from '@/lib/feasibility/grant';
import FeasibilityEnrollment from '@/components/feasibility/FeasibilityEnrollment';
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
 const {data:grant,error}=await readFeasibilityGrant(supabase,user.id);
 if(error)throw new Error('FEASIBILITY_ENTITLEMENT_LOOKUP_FAILED');
 const access=evaluateFeasibilityAccess(grant);
 const organizationSharing=process.env.FEASIBILITY_ORG_SHARING==='true'&&process.env.FEASIBILITY_ORG_QA==='true';
 if(!access.canRead){
  if(!feasibilitySelfServeEnabled())notFound();
  return <FeasibilityEnrollment locale={locale} organizationSharing={organizationSharing}/>;
 }
 return <FeasibilityWorkspace locale={locale} userId={user.id} readOnly={!access.canWrite} organizationSharing={organizationSharing}/>;
}
