import {notFound} from 'next/navigation';
import {assertOpeningWorkspace} from '../../../../services/financial-opening-workspace';
import {requireUser} from '../../../../services/auth';
import BranchOpeningDistribution from '../../../../components/financial-reports/BranchOpeningDistribution';
export const dynamic='force-dynamic';
export default async function BranchOpeningPage({params,searchParams}:{
 params:Promise<{locale:string}>;searchParams:Promise<{organization?:string;fiscalStart?:string}>
}){
 try{assertOpeningWorkspace();if(process.env.FINANCIAL_CENTER_BRANCH_REGISTRY!=='true')throw Error('DISABLED')}catch{notFound()}
 await requireUser();
 const [{locale},{organization,fiscalStart}]=await Promise.all([params,searchParams]);
 return <BranchOpeningDistribution dimension locale={locale} organization={organization??''} fiscalStart={fiscalStart??''}/>;
}
