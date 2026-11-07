import {redirect} from 'next/navigation';
import {supabaseServer} from '@/lib/supabase/server';
import FeasibilityWorkspace from '@/components/FeasibilityWorkspace';
import './feasibility.css';

export const dynamic='force-dynamic';
export default async function FeasibilityPage({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;
 const supabase=await supabaseServer();
 const {data:{user}}=await supabase.auth.getUser();
 if(!user)redirect('/'+locale+'/login');
 return <FeasibilityWorkspace locale={locale} userId={user.id}/>;
}
