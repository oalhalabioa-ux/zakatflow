import {notFound} from 'next/navigation';
import {assertOpeningWorkspace} from '../../../services/financial-opening-workspace';
import {requireUser} from '../../../services/auth';
import LiveOpeningBalances from '../../../components/financial-reports/LiveOpeningBalances';
import SetupReturnLink from '../../../components/settings/SetupReturnLink';
export const dynamic='force-dynamic';
export default async function OpeningBalancesPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{organization?:string;fiscalStart?:string;fromSetup?:string}>}){
 try{assertOpeningWorkspace()}catch{notFound()}
 await requireUser();const[{locale},{organization,fiscalStart,fromSetup}]=await Promise.all([params,searchParams]);return <><SetupReturnLink locale={locale} organization={organization} visible={fromSetup==='1'}/><LiveOpeningBalances locale={locale} key={organization+":"+fiscalStart} preferredOrg={organization} preferredFiscalStart={fiscalStart}/></>;
}
