import {CurrencyScope} from '@/components/DisplayCurrency';
import ZakatMetricsRefresh from '@/components/ZakatMetricsRefresh';
import {getDashboard} from '@/services/dashboard';
import CustomDashboard from '@/components/CustomDashboard';
import ElegantDashboard from '@/components/ElegantDashboard';
import DashboardOperations from '@/components/DashboardOperations';
import '../../dashboard/dashboard.css';
import '../../dashboard/elegant-dashboard.css';
import {unstable_rethrow} from 'next/navigation';

export default async function Dashboard({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<{currency?: string}>}) {
  const {locale} = await params, q = await searchParams;
  const currency = 'SAR';
  let d: any;
  try { d = await getDashboard(); }
  catch (error) { unstable_rethrow(error); d = {loadError: true}; }
  return <>
    <CurrencyScope currency="SAR"/><ZakatMetricsRefresh/>
    <ElegantDashboard d={d} locale={locale} currency={currency}/>
    <DashboardOperations label={locale === 'ar' ? 'التخصيص وإدارة الدورة' : 'Customization & cycle management'}>
      <CustomDashboard d={d} locale={locale} currency={currency}/>
    </DashboardOperations>
  </>;
}
