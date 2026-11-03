import {notFound} from 'next/navigation';
import {assertOpeningWorkspace} from '../../../services/financial-opening-workspace';
import {requireUser} from '../../../services/auth';
import LiveOpeningBalances from '../../../components/financial-reports/LiveOpeningBalances';
export const dynamic='force-dynamic';
export default async function OpeningBalancesPage({params}:{params:Promise<{locale:string}>}){
 try{assertOpeningWorkspace()}catch{notFound()}
 await requireUser();const{locale}=await params;return <LiveOpeningBalances locale={locale}/>;
}
