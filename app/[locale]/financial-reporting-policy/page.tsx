import {notFound} from 'next/navigation';
import {assertLiveStatements} from '../../../services/financial-statement-live';
import {requireUser} from '../../../services/auth';
import ReportingPolicyWorkspace from '../../../components/financial-reports/ReportingPolicyWorkspace';
import SetupReturnLink from '../../../components/settings/SetupReturnLink';
export const dynamic='force-dynamic';
export default async function PolicyPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{organization?:string;fromSetup?:string}>}){try{assertLiveStatements()}catch{notFound()}await requireUser();const[{locale},{organization,fromSetup}]=await Promise.all([params,searchParams]);return <><SetupReturnLink locale={locale} organization={organization} visible={fromSetup==='1'}/><ReportingPolicyWorkspace locale={locale} key={organization} preferredOrg={organization}/></>}
