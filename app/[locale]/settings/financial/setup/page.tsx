import {requireUser} from '@/services/auth';
import SettingsFrame from '@/components/settings/SettingsFrame';
import FinancialSetupWizard from '@/components/settings/FinancialSetupWizard';

export const dynamic='force-dynamic';

export default async function FinancialSetupPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{organization?:string}>}){
  await requireUser();
  const [{locale},{organization}]=await Promise.all([params,searchParams]);
  return <SettingsFrame locale={locale}><FinancialSetupWizard locale={locale} preferredOrg={organization}/></SettingsFrame>;
}
