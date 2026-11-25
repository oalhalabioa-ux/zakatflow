import {redirect} from 'next/navigation';
import {requireUser} from './auth';

/** A personal account does not need an institution to open its own dashboard. */
export async function requireDashboardScope(scope:'PERSONAL'|'ORGANIZATION',locale:string){
 const {supabase}=await requireUser();
 if(scope==='PERSONAL')return;
 const {data:needsOnboarding,error}=await supabase.rpc('organization_onboarding_required');
 if(error)throw error;
 if(needsOnboarding)redirect('/'+locale+'/onboarding');
}
