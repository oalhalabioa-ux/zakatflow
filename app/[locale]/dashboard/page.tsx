import Link from 'next/link';
import type {ReactNode} from 'react';
import {unstable_rethrow} from 'next/navigation';
import {getDashboard} from '@/services/dashboard';
import {getPlatformOverview} from '@/services/platform-overview';
import ZakatMetricsRefresh from '@/components/ZakatMetricsRefresh';
import './platform-dashboard.css';

const fmt=(v:unknown)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v)||0);
const count=(v:number|null|undefined)=>v==null?'—':new Intl.NumberFormat('en-US').format(v);
function ModuleIcon({kind}:{kind:'assets'|'tax'|'cash'|'budget'}) {
 const paths={assets:<><path d="M3 8h18v12H3zM7 4h10v4M8 12h8M8 16h5"/></>,tax:<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h3"/></>,cash:<><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18m-5 5h2M7 3v2"/></>,budget:<><path d="M4 20h16M6 16V9m6 7V4m6 12v-5"/></>};
 return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg>;
}
function Module({kind,title,description,href,children,links,ar}:{kind:'assets'|'tax'|'cash'|'budget';title:string;description:string;href:string;children:ReactNode;links:Array<{title:string;href:string}>;ar:boolean}) {
 return <section className="card platform-module"><div className="platform-module-head"><span className="platform-module-icon"><ModuleIcon kind={kind}/></span><div><h2>{title}</h2><p>{description}</p></div></div><dl className="platform-module-metrics">{children}</dl><nav className="platform-module-links" aria-label={title}>{links.map(x=><Link key={x.href} href={x.href}>{x.title}</Link>)}</nav><Link className="platform-module-open" href={href}>{ar?'فتح لوحة الموديول':'Open module dashboard'} <span aria-hidden="true">{ar?'←':'→'}</span></Link></section>;
}
function Metric({label,value}:{label:string;value:string}) {return <div><dt>{label}</dt><dd>{value}</dd></div>;}
export default async function Dashboard({params}:{params:Promise<{locale:string}>}) {
 const {locale}=await params,ar=locale==='ar';
 const safely=async<T,>(fn:()=>Promise<T>):Promise<T|null>=>{try{return await fn();}catch(e){unstable_rethrow(e);return null;}};
 const [assets,modules]=await Promise.all([safely(getDashboard),safely(getPlatformOverview)]);
 const assetsKnown=!!assets&&assets.dataHealth?.assets!==false;
 const liabilityKnown=!!assets&&(['assessments','cycles','allocations','payments'] as const).every(key=>assets.dataHealth?.[key]!==false);
 const money=(v:unknown,known=liabilityKnown)=>known?`${fmt(v)} SAR`:'—';
 const url=(path:string)=>`/${locale}/${path}`;
 const links=(items:Array<[string,string]>)=>items.map(([path,title])=>({href:url(path),title}));
 const incomplete=!assetsKnown||!liabilityKnown||!modules||Object.values(modules).some(x=>x==null);
 return <main className="container platform-dashboard"><ZakatMetricsRefresh/>
  <header className="platform-welcome"><div><span className="platform-eyebrow">ZAKATFLOW</span><h1>{ar?'اللوحة الرئيسية':'Main dashboard'}</h1><p>{ar?'نظرة موحدة على الموديولات، مع لوحة متخصصة لكل مجال.':'A unified overview with a dedicated dashboard for each module.'}</p></div><Link className="btn secondary" href={url('organizations')}>{ar?'المنشآت والصلاحيات':'Organizations & access'}</Link></header>
  {incomplete&&<p role="alert" className="notice">{ar?'تعذر تحديث بعض المؤشرات؛ تظهر علامة — بدلاً من أرقام غير مؤكدة. افتح الموديول لإعادة التحقق.':'Some indicators could not be refreshed. Unavailable values show —. Open the module to check.'}</p>}
  <section className="platform-summary" aria-label={ar?'ملخص الأصول والزكاة':'Assets and Zakat summary'}>
   <div className="card"><small>{ar?'القيمة الحالية للأصول':'Current asset value'}</small><strong>{money(assets?.totalCurrentSar,assetsKnown)}</strong><Link href={url('assets')}>{ar?'عرض الأصول':'View assets'}</Link></div>
   <div className="card"><small>{ar?'المتبقي النهائي للزكاة':'Final Zakat outstanding'}</small><strong>{money(assets?.remainingZakahSar)}</strong><Link href={url('payments')}>{ar?'دفعات الزكاة':'Zakat payments'}</Link></div>
   <div className="card"><small>{ar?'تقدير الدورة المفتوحة':'Open-cycle estimate'}</small><strong>{money(assets?.openCycleEstimateSar)}</strong><Link href={url('assessments')}>{ar?'فتح الاحتساب':'Open assessment'}</Link></div>
   <div className="card"><small>{ar?'الإجمالي حتى آخر احتساب':'Balance as of latest assessment'}</small><strong>{money(assets?.asOfZakahBalanceSar)}</strong><span>{ar?'المتبقي النهائي + التقدير المفتوح':'Final outstanding + open estimate'}</span></div>
  </section>
  <div className="platform-section-heading"><h2>{ar?'موديولات المنصة':'Platform modules'}</h2><p>{ar?'السجلات المتاحة لحسابك؛ التفاصيل والأرصدة داخل كل موديول بحسب المنشأة والعملة.':'Records available to your account; detailed balances use each module’s organization and currency scope.'}</p></div>
  <div className="platform-modules">
   <Module ar={ar} kind="assets" title={ar?'الأصول والزكاة':'Assets & Zakat'} description={ar?'المحفظة والحول والاحتساب والسداد':'Portfolio, Hawl, assessments and payments'} href={url('assets/dashboard')} links={links([['assets',ar?'الأصول':'Assets'],['transactions',ar?'العمليات':'Transactions'],['assessments',ar?'الاحتساب':'Assessments'],['payments',ar?'الدفعات':'Payments']])}>
    <Metric label={ar?'الأصول النشطة':'Active assets'} value={count(assetsKnown?assets?.assetCount:null)}/><Metric label={ar?'الدورات الزكوية':'Zakat cycles'} value={count(liabilityKnown?assets?.cycleCount:null)}/><Metric label={ar?'وزن الذهب':'Gold weight'} value={assetsKnown?`${assets?.goldWeightKg} kg`:'—'}/><Metric label={ar?'وزن الفضة':'Silver weight'} value={assetsKnown?`${assets?.silverWeightKg} kg`:'—'}/>
   </Module>
   <Module ar={ar} kind="tax" title={ar?'الضرائب والفوترة':'Tax & invoicing'} description={ar?'الفواتير والفترات الضريبية والفوترة الإلكترونية':'Invoices, tax periods and e-invoicing'} href={url('vat?section=dashboard')} links={links([['vat?section=aggregate',ar?'الفترات الضريبية':'Tax periods'],['invoice-register',ar?'سجل الفواتير':'Invoice register'],['vat?section=einvoicing',ar?'الفوترة الإلكترونية':'E-invoicing']])}>
    <Metric label={ar?'مستندات الضريبة':'Tax documents'} value={count(modules?.taxDocuments)}/><Metric label={ar?'سجلات الفوترة الإلكترونية':'E-invoice records'} value={count(modules?.eInvoices)}/>
   </Module>
   <Module ar={ar} kind="cash" title={ar?'إدارة السيولة':'Liquidity management'} description={ar?'الحسابات والتدفقات والتحويلات والجهات':'Accounts, cash flows, transfers and counterparties'} href={url('liquidity?tab=overview')} links={links([['liquidity?tab=position',ar?'المركز النقدي':'Cash position'],['liquidity?tab=calendar',ar?'التقويم النقدي':'Cash calendar'],['liquidity?tab=transfers',ar?'التحويلات':'Transfers']])}>
    <Metric label={ar?'الحسابات النشطة':'Active accounts'} value={count(modules?.cashAccounts)}/><Metric label={ar?'سجلات التدفقات':'Cash-flow records'} value={count(modules?.cashFlows)}/><Metric label={ar?'جهات التعامل':'Counterparties'} value={count(modules?.parties)}/>
   </Module>
   <Module ar={ar} kind="budget" title={ar?'التخطيط المالي والموازنات':'Planning & budgets'} description={ar?'الموازنات والفعلي والتوقعات والتدفقات المخططة':'Budgets, actuals, forecasts and planned cash flows'} href={url('budget-planning?tab=dashboard')} links={links([['budget-planning?tab=monthly',ar?'الموازنة الشهرية':'Monthly budget'],['budget-planning?tab=variance',ar?'الفعلي والموازنة':'Actual vs budget'],['budget-planning?tab=forecast',ar?'التوقعات':'Forecast']])}>
    <Metric label={ar?'الموازنات المحفوظة':'Saved budget plans'} value={count(modules?.budgetPlans)}/><Metric label={ar?'الموازنات المعتمدة':'Approved budget plans'} value={count(modules?.approvedPlans)}/>
   </Module>
  </div>
  <section className="card platform-administration"><div><h2>{ar?'إدارة المنصة':'Platform administration'}</h2><p>{ar?`${count(modules?.organizations)} منشآت ضمن عضوياتك النشطة`:`${count(modules?.organizations)} organizations with active membership`}</p></div><nav aria-label={ar?'إدارة المنصة':'Platform administration'}><Link href={url('organizations')}>{ar?'الهيكل المؤسسي':'Organizations'}</Link><Link href={url('users')}>{ar?'المستخدمون والصلاحيات':'Users & permissions'}</Link><Link href={url('account')}>{ar?'الإعدادات':'Settings'}</Link></nav></section>
 </main>;
}
