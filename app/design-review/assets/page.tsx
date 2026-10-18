import {notFound} from 'next/navigation';
import CorporateShell from '../../../components/CorporateShell';
import {DisplayCurrencyProvider} from '../../../components/DisplayCurrency';
import YaqeenAssetsSummary from '../../../components/YaqeenAssetsSummary';
import YaqeenAssetOverviewCharts from '../../../components/YaqeenAssetOverviewCharts';
import ElegantDashboard from '../../../components/ElegantDashboard';
import ZakatWorkspaceTabs from '../../../components/ZakatWorkspaceTabs';
import '../../corporate.css';
import '../../yaqeen-theme.css';
import '../../yaqeen-dashboard.css';
import '../../[locale]/dashboard/elegant-dashboard.css';
import '../../yaqeen-assets.css';
import '../../yaqeen-assets-overview.css';
export const metadata={title:'Assets design review',robots:{index:false,follow:false}};
const demo={assetCount:6,totalPurchaseSar:'2400000',totalCurrentSar:'2760000',gainSar:'360000',gainPct:'15',zakatableValueSar:'1800000',explicitZakahDueSar:'52000',allocatedZakahPaidSar:'20000',remainingZakahSar:'32000',openCycleEstimateSar:'18000',asOfZakahBalanceSar:'50000',carriedZakahCreditSar:'0',goldWeightKg:'1.25',silverWeightKg:'4',zakatPaymentPct:'38.46',dataHealth:{assets:true,assessments:true,cycles:true,allocations:true,payments:true},asOfDate:'2026-10-18',activeCycle:{cycle_no:2,hawl_start_date:'2026-03-06',hawl_due_date:'2027-02-23'},assetAllocation:[{type:'REAL_ESTATE',value:'1100000'},{type:'INVENTORY',value:'700000'},{type:'STOCK',value:'400000'},{type:'BANK',value:'300000'},{type:'GOLD',value:'160000'},{type:'OTHER',value:'100000'}],latestAssessments:[{id:'demo1',assessment_date:'2026-10-18',zakat_due:'18000'},{id:'demo2',assessment_date:'2026-09-18',zakat_due:'16500'},{id:'demo3',assessment_date:'2026-08-18',zakat_due:'15000'}],recentPayments:[{id:'demo-payment',payment_date:'2026-08-15',amount:'20000',currency:'SAR',beneficiary:'دفعة توضيحية'}],zakatAllocation:[{type:'REAL_ESTATE',value:'600000'},{type:'INVENTORY',value:'500000'},{type:'STOCK',value:'300000'},{type:'BANK',value:'200000'},{type:'GOLD',value:'150000'},{type:'OTHER',value:'50000'}],topAssets:[{id:'demo-asset',name:'أصل توضيحي',value:'900000',type:'REAL_ESTATE'}]};
export default async function Page({searchParams}:{searchParams:Promise<{lang?:string;width?:string}>}){
 if(process.env.VERCEL_ENV==='production')notFound();
 const q=await searchParams,locale=q.lang==='en'?'en':'ar';
 if(q.width){const width=[390,768,1024,1440,1920].includes(Number(q.width))?Number(q.width):390;return <main className="yqo-capture" dir="ltr" style={{padding:12,background:'#DCE7F0',width:width+24}}><style>{`html:has(.yqo-capture),body:has(.yqo-capture){direction:ltr;min-width:${width+24}px;margin:0}`}</style><iframe title="Responsive asset preview" width={width} height={width<500?1400:1100} src={`/design-review/assets/dashboard?lang=${locale}`} style={{display:'block',margin:0,border:0}}/></main>}
 return <DisplayCurrencyProvider locale={locale}><CorporateShell locale={locale}><p className="notice">{locale==='ar'?'معاينة تصميم · جميع البيانات توضيحية':'Design preview · synthetic data only'}</p><ZakatWorkspaceTabs locale={locale}/><YaqeenAssetsSummary d={demo} locale={locale}/><YaqeenAssetOverviewCharts d={demo} locale={locale}/><ElegantDashboard d={demo} locale={locale} currency="SAR"/></CorporateShell></DisplayCurrencyProvider>
}
