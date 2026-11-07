import {notFound} from 'next/navigation';
import {requireUser} from '../../../services/auth';
import {assertOpeningWorkspace} from '../../../services/financial-opening-workspace';
import ChartOfAccountsWorkspace from '../../../components/financial-reports/ChartOfAccountsWorkspace';
import SetupReturnLink from '../../../components/settings/SetupReturnLink';
export const dynamic='force-dynamic';
export default async function ChartOfAccountsPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{organization?:string;fromSetup?:string;setupEmbed?:string;template?:string}>}){
 try{assertOpeningWorkspace()}catch{notFound()}
 await requireUser();const [{locale},{organization,fromSetup,setupEmbed,template}]=await Promise.all([params,searchParams]);
 return <><SetupReturnLink locale={locale} organization={organization} visible={fromSetup==='1'} embedded={setupEmbed==='1'}/><ChartOfAccountsWorkspace locale={locale} preferredOrg={organization} preferredTemplate={template}/></>;
}
