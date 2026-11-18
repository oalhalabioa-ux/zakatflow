import {notFound} from 'next/navigation';
import {assertOpeningWorkspace} from '../../../../services/financial-opening-workspace';
import {centerOpeningsEnabled} from '../../../../services/financial-center-report-rollout';
import {requireUser} from '../../../../services/auth';
import BranchOpeningDistribution from '../../../../components/financial-reports/BranchOpeningDistribution';
export const dynamic='force-dynamic';
export default async function BranchOpeningPage({params,searchParams}:{
 params:Promise<{locale:string}>;searchParams:Promise<{organization?:string;fiscalStart?:string}>
}){
 const [{locale},{organization,fiscalStart}]=await Promise.all([params,searchParams]);
 try{assertOpeningWorkspace();if(!centerOpeningsEnabled(organization??null))throw Error('DISABLED')}catch{notFound()}
 await requireUser();
 return <BranchOpeningDistribution dimension locale={locale} organization={organization??''} fiscalStart={fiscalStart??''}/>;
}
