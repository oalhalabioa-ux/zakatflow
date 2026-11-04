import {notFound} from 'next/navigation';
import {assertOpeningWorkspace} from '../../../services/financial-opening-workspace';
import {requireUser} from '../../../services/auth';
import LiveOpeningBalances from '../../../components/financial-reports/LiveOpeningBalances';
export const dynamic='force-dynamic';
export default async function OpeningBalancesPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{organization?:string;fiscalStart?:string}>}){
 try{assertOpeningWorkspace()}catch{notFound()}
 await requireUser();const[{locale},{organization,fiscalStart}]=await Promise.all([params,searchParams]);return <LiveOpeningBalances locale={locale} key={organization+":"+fiscalStart} preferredOrg={organization} preferredFiscalStart={fiscalStart}/>;
}
