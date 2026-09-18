import Link from 'next/link';
import {getDashboard} from '@/services/dashboard';
import CustomDashboard from '@/components/CustomDashboard';
import ElegantDashboard from '@/components/ElegantDashboard';
import DashboardOperations from '@/components/DashboardOperations';
import './dashboard.css';
import './elegant-dashboard.css';
import {unstable_rethrow} from 'next/navigation';

export default async function Dashboard({params, searchParams}: {params: Promise<{locale: string}>; searchParams: Promise<{currency?: string}>}) {
  const {locale} = await params, q = await searchParams;
  const currency = q.currency === 'USD' ? 'USD' : 'SAR';
  let d: any;
  try { d = await getDashboard(); }
  catch (error) { unstable_rethrow(error); d = {loadError: true}; }
  return <>
    <ElegantDashboard d={d} locale={locale} currency={currency}/>
    <DashboardOperations label={locale === 'ar' ? 'التخصيص وإدارة الدورة' : 'Customization & cycle management'}>
      <div className="container" style={{paddingBottom: 0}}><div className="pro-currency"><Link className={currency === 'SAR' ? 'active' : ''} href={`/${locale}/dashboard`}>SAR</Link><Link className={currency === 'USD' ? 'active' : ''} href={`/${locale}/dashboard?currency=USD`}>USD</Link></div></div>
      <CustomDashboard d={d} locale={locale} currency={currency}/>
    </DashboardOperations>
  </>;
}
