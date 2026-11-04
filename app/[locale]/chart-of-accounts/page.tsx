import {notFound} from 'next/navigation';
import {requireUser} from '../../../services/auth';
import {assertOpeningWorkspace} from '../../../services/financial-opening-workspace';
import ChartOfAccountsWorkspace from '../../../components/financial-reports/ChartOfAccountsWorkspace';
export const dynamic='force-dynamic';
export default async function ChartOfAccountsPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{organization?:string}>}){
 try{assertOpeningWorkspace()}catch{notFound()}
 await requireUser();const [{locale},{organization}]=await Promise.all([params,searchParams]);
 return <ChartOfAccountsWorkspace locale={locale} preferredOrg={organization}/>;
}
