import Link from 'next/link';
import type {ReactNode} from 'react';
import {unstable_rethrow} from 'next/navigation';
import {getDashboard} from '@/services/dashboard';
import {getPlatformOverview} from '@/services/platform-overview';
import {getPlatformFinancialOverview} from '@/services/platform-financial-overview';
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
export default async function Dashboard({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{organization?:string;plan?:string;month?:string}>}) {
 const [{locale},q]=await Promise.all([params,searchParams]),ar=locale==='ar';
 const safely=async<T,>(fn:()=>Promise<T>):Promise<T|null>=>{try{return await fn();}catch(e){unstable_rethrow(e);return null;}};
 const [assets,modules,financial]=await Promise.all([safely(getDashboard),safely(getPlatformOverview),safely(()=>getPlatformFinancialOverview(q))]);
 const assetsKnown=!!assets&&assets.dataHealth?.assets!==false;
 const liabilityKnown=!!assets&&(['assessments','cycles','allocations','payments'] as const).every(key=>assets.dataHealth?.[key]!==false);
 const money=(v:unknown,known=liabilityKnown)=>known?`${fmt(v)} SAR`:'—';
 const url=(path:string)=>`/${locale}/${path}`;
 const links=(items:Array<[string,string]>)=>items.map(([path,title])=>({href:url(path),title}));
 const orgCurrency=financial?.organization?.base_currency??'SAR';
 const orgMoney=(v:unknown,known:boolean)=>known?`${fmt(v)} ${orgCurrency}`:'—';
 const budgetMoney=(v:unknown)=>financial?.budget?`${fmt(v)} ${financial.budget.plan.currency}`:'—';
 const cash=financial?.cash,vat=financial?.vat,budget=financial?.budget;
 const incomplete=(!financial||!!financial.organization&&(!cash||!vat)||!!financial.selectedPlan&&!budget)||!assetsKnown||!liabilityKnown||!modules||Object.values(modules).some(x=>x==null);
 return <main className="container platform-dashboard"><ZakatMetricsRefresh/>
  <header className="platform-welcome"><div><span className="platform-eyebrow">ZAKATFLOW</span><h1>{ar?'اللوحة الرئيسية':'Main dashboard'}</h1><p>{ar?'نظرة موحدة على الموديولات، مع لوحة متخصصة لكل مجال.':'A unified overview with a dedicated dashboard for each module.'}</p></div><Link className="btn secondary" href={url('organizations')}>{ar?'المنشآت والصلاحيات':'Organizations & access'}</Link></header>
  {incomplete&&<p role="alert" className="notice">{ar?'تعذر تحديث بعض المؤشرات؛ تظهر علامة — بدلاً من أرقام غير مؤكدة. افتح الموديول لإعادة التحقق.':'Some indicators could not be refreshed. Unavailable values show —. Open the module to check.'}</p>}
  <form className="card platform-scope" action={url('dashboard')} method="get">
   <label>{ar?'المنشأة · السيولة والضرائب':'Organization · cash and tax'}<select name="organization" defaultValue={financial?.organization?.id??''}><option value="" disabled>{ar?'اختر منشأة':'Select organization'}</option>{financial?.organizations.map(o=><option key={o.id} value={o.id}>{o.name} · {o.base_currency}</option>)}</select></label>
   <label>{ar?'الفترة الضريبية':'Tax period'}<input type="month" name="month" defaultValue={financial?.month}/></label>
   <label>{ar?'الموازنة المعروضة':'Displayed budget'}<select name="plan" defaultValue={financial?.selectedPlan?.id??''}><option value="">{ar?'اختر موازنة':'Select budget'}</option>{financial?.plans.map(p=><option key={p.id} value={p.id}>{p.name} · {p.organization_name} · {p.fiscal_year} · {p.currency}</option>)}</select></label>
   <button className="btn" type="submit">{ar?'تحديث العرض':'Update view'}</button>
  </form>
  <section className="platform-summary" aria-label={ar?'مؤشرات جميع الموديولات':'All module indicators'}>
   {[
    {kind:'assets' as const,label:ar?'القيمة الحالية للأصول':'Current asset value',value:money(assets?.totalCurrentSar,assetsKnown),note:ar?'الأصول الشخصية':'Personal assets',href:url('assets/dashboard')},
    {kind:'assets' as const,label:ar?'المتبقي النهائي للزكاة':'Final Zakat outstanding',value:money(assets?.remainingZakahSar),note:ar?'النهائي بعد السداد':'Final after payments',href:url('payments')},
    {kind:'cash' as const,label:ar?'السيولة المتاحة':'Available cash',value:orgMoney(cash?.available,!!cash),note:financial?.organization?.name??'—',href:url('liquidity?tab=position')},
    {kind:'cash' as const,label:ar?'الذمم الدائنة':'Payables',value:orgMoney(cash?.payables,!!cash),note:financial?.organization?.name??'—',href:url('liquidity?tab=counterparties')},
    {kind:'tax' as const,label:ar?'مبيعات الفترة قبل الضريبة':'Period sales before VAT',value:orgMoney(vat?.totals.salesBase,!!vat),note:vat?`${vat.period.from} — ${vat.period.to}`:'—',href:url('vat?section=dashboard')},
    {kind:'tax' as const,label:ar?'صافي الضريبة المستحقة للفترة':'Period VAT payable',value:orgMoney(vat?.totals.taxPayable,!!vat),note:ar?'قبل طرح السداد الضريبي':'Before tax payments',href:url('vat?section=aggregate')},
    {kind:'budget' as const,label:ar?'إيرادات الموازنة السنوية':'Annual budget revenue',value:budgetMoney(budget?.metrics.revenue),note:financial?.selectedPlan?.name??(ar?'لا توجد موازنة':'No budget'),href:url('budget-planning?tab=monthly')},
    {kind:'budget' as const,label:ar?'النتيجة التشغيلية المخططة · EBITDA':'Budget EBITDA',value:budgetMoney(budget?.metrics.ebitda),note:budget?`${budget.plan.organization_name} · ${budget.plan.fiscal_year}`:'—',href:url('budget-planning?tab=dashboard')},
   ].map(x=><Link className="card platform-summary-card" key={x.label} href={x.href}><span className="platform-summary-icon"><ModuleIcon kind={x.kind}/></span><small>{x.label}</small><strong>{x.value}</strong><span>{x.note}</span></Link>)}
  </section>
  <div className="platform-section-heading"><h2>{ar?'موديولات المنصة':'Platform modules'}</h2><p>{ar?'مؤشرات مالية من مصادر الموديولات. السيولة والضرائب للمنشأة المختارة، والموازنة للخطة المحددة، والأصول والزكاة للنطاق الشخصي.':'Financial indicators from each module. Cash and tax use the selected organization; budgets use the selected plan; assets and Zakat use personal scope.'}</p></div>
  <div className="platform-modules">
   <Module ar={ar} kind="assets" title={ar?'الأصول والزكاة':'Assets & Zakat'} description={ar?'المحفظة والحول والاحتساب والسداد':'Portfolio, Hawl, assessments and payments'} href={url('assets/dashboard')} links={links([['assets',ar?'الأصول':'Assets'],['transactions',ar?'العمليات':'Transactions'],['assessments',ar?'الاحتساب':'Assessments'],['payments',ar?'الدفعات':'Payments']])}>
    <Metric label={ar?'تقدير الدورة المفتوحة':'Open-cycle estimate'} value={money(assets?.openCycleEstimateSar)}/><Metric label={ar?'الإجمالي حتى آخر احتساب':'Balance as of latest assessment'} value={money(assets?.asOfZakahBalanceSar)}/>
    <Metric label={ar?'الأصول النشطة':'Active assets'} value={count(assetsKnown?assets?.assetCount:null)}/><Metric label={ar?'الدورات الزكوية':'Zakat cycles'} value={count(liabilityKnown?assets?.cycleCount:null)}/><Metric label={ar?'وزن الذهب':'Gold weight'} value={assetsKnown?`${assets?.goldWeightKg} kg`:'—'}/><Metric label={ar?'وزن الفضة':'Silver weight'} value={assetsKnown?`${assets?.silverWeightKg} kg`:'—'}/>
   </Module>
   <Module ar={ar} kind="tax" title={ar?'الضرائب والفوترة':'Tax & invoicing'} description={ar?'الفواتير والفترات الضريبية والفوترة الإلكترونية':'Invoices, tax periods and e-invoicing'} href={url('vat?section=dashboard')} links={links([['vat?section=aggregate',ar?'الفترات الضريبية':'Tax periods'],['invoice-register',ar?'سجل الفواتير':'Invoice register'],['vat?section=einvoicing',ar?'الفوترة الإلكترونية':'E-invoicing']])}>
    <Metric label={ar?'ضريبة المخرجات':'Output VAT'} value={orgMoney(vat?.totals.outputTax,!!vat)}/><Metric label={ar?'ضريبة المدخلات القابلة للخصم':'Recoverable input VAT'} value={orgMoney(vat?.totals.inputTax,!!vat)}/><Metric label={ar?'الرصيد الضريبي الدائن':'VAT credit'} value={orgMoney(vat?.totals.taxCredit,!!vat)}/><Metric label={ar?'السداد الضريبي للفترة':'Period tax paid'} value={orgMoney(vat?.totals.paidAmount,!!vat)}/>
    <div className="platform-scope-note"><dt>{ar?"نطاق المؤشرات المالية":"Financial indicator scope"}</dt><dd>{financial?.organization?.name??'—'} · {vat?`${vat.period.from} — ${vat.period.to}`:'—'}{vat&&!vat.profileConfigured?` · ${ar?'إعداد الضريبة غير مكتمل':'Tax setup incomplete'}`:''}</dd></div>
    <Metric label={ar?'مستندات الضريبة · جميع المنشآت':'Tax documents · all organizations'} value={count(modules?.taxDocuments)}/><Metric label={ar?'الفواتير الإلكترونية · جميع المنشآت':'E-invoices · all organizations'} value={count(modules?.eInvoices)}/>
   </Module>
   <Module ar={ar} kind="cash" title={ar?'إدارة السيولة':'Liquidity management'} description={ar?'الحسابات والتدفقات والتحويلات والجهات':'Accounts, cash flows, transfers and counterparties'} href={url('liquidity?tab=overview')} links={links([['liquidity?tab=position',ar?'المركز النقدي':'Cash position'],['liquidity?tab=calendar',ar?'التقويم النقدي':'Cash calendar'],['liquidity?tab=transfers',ar?'التحويلات':'Transfers']])}>
    <Metric label={ar?'الذمم المدينة':'Receivables'} value={orgMoney(cash?.receivables,!!cash)}/><Metric label={ar?'الدائنون المتأخرون':'Overdue payables'} value={orgMoney(cash?.overduePayables,!!cash)}/><Metric label={ar?'تدفقات داخلة · 13 أسبوعاً':'Forecast inflows · 13 weeks'} value={orgMoney(cash?.forecastIn,!!cash)}/><Metric label={ar?'تدفقات خارجة · 13 أسبوعاً':'Forecast outflows · 13 weeks'} value={orgMoney(cash?.forecastOut,!!cash)}/><Metric label={ar?'أدنى سيولة متوقعة':'Lowest forecast cash'} value={orgMoney(cash?.lowest,!!cash)}/>
    <div className="platform-scope-note"><dt>{ar?"نطاق المؤشرات المالية":"Financial indicator scope"}</dt><dd>{financial?.organization?.name??'—'} · {ar?'دون التحويلات الداخلية في التوقعات':'Forecast excludes internal transfers'}</dd></div>
    <Metric label={ar?'الحسابات النشطة · جميع المنشآت':'Active accounts · all organizations'} value={count(modules?.cashAccounts)}/><Metric label={ar?'سجلات التدفقات · جميع المنشآت':'Cash-flow records · all organizations'} value={count(modules?.cashFlows)}/><Metric label={ar?'جهات التعامل · جميع المنشآت':'Counterparties · all organizations'} value={count(modules?.parties)}/>
   </Module>
   <Module ar={ar} kind="budget" title={ar?'التخطيط المالي والموازنات':'Planning & budgets'} description={ar?'الموازنات والفعلي والتوقعات والتدفقات المخططة':'Budgets, actuals, forecasts and planned cash flows'} href={url('budget-planning?tab=dashboard')} links={links([['budget-planning?tab=monthly',ar?'الموازنة الشهرية':'Monthly budget'],['budget-planning?tab=variance',ar?'الفعلي والموازنة':'Actual vs budget'],['budget-planning?tab=forecast',ar?'التوقعات':'Forecast']])}>
    <Metric label={ar?'تكلفة المبيعات المخططة':'Budget cost of sales'} value={budgetMoney(budget?.metrics.cogs)}/><Metric label={ar?'المصاريف التشغيلية المخططة':'Budget operating expenses'} value={budgetMoney(budget?.metrics.opex)}/><Metric label={ar?'النفقات الرأسمالية المخططة':'Budget capital expenses'} value={budgetMoney(budget?.metrics.capex)}/><Metric label={ar?'صافي التدفق المخطط':'Budget net cash flow'} value={budgetMoney(budget?.metrics.netCash)}/><Metric label={ar?'هامش EBITDA المخطط':'Budget EBITDA margin'} value={budget?`${fmt(budget.metrics.ebitdaMargin*100)}%`:'—'}/>
    <div className="platform-scope-note"><dt>{ar?"نطاق المؤشرات المالية":"Financial indicator scope"}</dt><dd>{budget?`${budget.plan.name} · ${budget.plan.organization_name} · ${budget.plan.cost_center} · ${budget.plan.fiscal_year}`:(ar?'لا توجد موازنة محفوظة':'No saved budget')}</dd></div>
    <Metric label={ar?'الموازنات المحفوظة':'Saved budget plans'} value={count(modules?.budgetPlans)}/><Metric label={ar?'الموازنات المعتمدة':'Approved budget plans'} value={count(modules?.approvedPlans)}/>
   </Module>
  </div>
  <section className="card platform-administration"><div><h2>{ar?'إدارة المنصة':'Platform administration'}</h2><p>{ar?`${count(modules?.organizations)} منشآت ضمن عضوياتك النشطة`:`${count(modules?.organizations)} organizations with active membership`}</p></div><nav aria-label={ar?'إدارة المنصة':'Platform administration'}><Link href={url('organizations')}>{ar?'الهيكل المؤسسي':'Organizations'}</Link><Link href={url('users')}>{ar?'المستخدمون والصلاحيات':'Users & permissions'}</Link><Link href={url('account')}>{ar?'الإعدادات':'Settings'}</Link></nav></section>
 </main>;
}
