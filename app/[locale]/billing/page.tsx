import SettingsFrame from '@/components/settings/SettingsFrame';
import BillingOrganizationPicker from '@/components/settings/BillingOrganizationPicker';
import SubscriptionBillingWorkspace from '@/components/settings/SubscriptionBillingWorkspace';
import OrganizationSubnav from '@/components/settings/OrganizationSubnav';
export default async function Billing({params,searchParams}:{
 params:Promise<{locale:string}>;searchParams:Promise<{organization?:string}>;
}){
 const [{locale},{organization}]=await Promise.all([params,searchParams]);
 return <SettingsFrame locale={locale}>
  <OrganizationSubnav locale={locale} organization={organization} active="billing"/>
  <BillingOrganizationPicker locale={locale}/>
  <SubscriptionBillingWorkspace locale={locale}/>
 </SettingsFrame>;
}
