import {notFound} from 'next/navigation';
import {assertLiveStatements} from '../../../services/financial-statement-live';
import {requireUser} from '../../../services/auth';
import ReportingPolicyWorkspace from '../../../components/financial-reports/ReportingPolicyWorkspace';
export const dynamic='force-dynamic';
export default async function PolicyPage({params}:{params:Promise<{locale:string}>}){try{assertLiveStatements()}catch{notFound()}await requireUser();const{locale}=await params;return <ReportingPolicyWorkspace locale={locale}/>}
