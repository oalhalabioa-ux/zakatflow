import SettingsFrame from '@/components/settings/SettingsFrame';
import BillingOrganizationPicker from '@/components/settings/BillingOrganizationPicker';
import SubscriptionBillingWorkspace from '@/components/settings/SubscriptionBillingWorkspace';
export default async function Billing({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;
 return <SettingsFrame locale={locale}>
  <BillingOrganizationPicker locale={locale}/>
  <SubscriptionBillingWorkspace locale={locale}/>
 </SettingsFrame>;
}
