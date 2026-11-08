import BillingOrganizationPicker from '@/components/settings/BillingOrganizationPicker';
import SubscriptionBillingWorkspace from '@/components/settings/SubscriptionBillingWorkspace';
import '@/components/settings/settings.css';
export default async function Billing({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;
 return <main className="settings-workspace billing-workspace" dir={locale==='ar'?'rtl':'ltr'}><BillingOrganizationPicker locale={locale}/><SubscriptionBillingWorkspace locale={locale}/></main>;
}
