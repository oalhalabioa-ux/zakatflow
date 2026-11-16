import {redirect} from 'next/navigation';
export default async function LegacyAdmin({params}:{params:Promise<{locale:string}>}){const {locale}=await params;redirect(`/admin?lang=${locale==='en'?'en':'ar'}`)}
