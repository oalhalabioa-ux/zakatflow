import AssetsDashboardWorkspace from '@/components/AssetsDashboardWorkspace';
import {getDashboard} from '@/services/dashboard';
import {unstable_rethrow} from 'next/navigation';
import '../../dashboard/dashboard.css';
import '../../dashboard/elegant-dashboard.css';
import './organization-assets.css';
import '../../../yaqeen-assets-overview.css';

export default async function Dashboard({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{scope?:string}>}){
 const [{locale},q]=await Promise.all([params,searchParams]);const scope=q.scope==='ORGANIZATION'?'ORGANIZATION':'PERSONAL';let data=null;
 if(scope==='PERSONAL')try{data=await getDashboard()}catch(error){unstable_rethrow(error)}
 return <AssetsDashboardWorkspace locale={locale} initialScope={scope} initialData={data}/>;
}
