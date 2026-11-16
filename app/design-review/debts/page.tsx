import {notFound} from 'next/navigation';
import CorporateShell from '../../../components/CorporateShell';
import {DisplayCurrencyProvider} from '../../../components/DisplayCurrency';
import {ActionIconGlyph} from '../../../components/ActionButton';
import '../../corporate.css';
import '../../yaqeen-theme.css';
import '../../[locale]/financial-register.css';
import '../../[locale]/debt-finance.css';
export const metadata={title:'Debt indicator design review',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{w?:string}>}){
 if(process.env.NODE_ENV==='production'&&process.env.VERCEL_ENV!=='preview')notFound();
 const q=await searchParams;if(q.w){const w=[320,390,820].includes(Number(q.w))?Number(q.w):390;return <main style={{padding:12,background:'#eef2f6',minHeight:'100vh'}}><iframe title="مراجعة المؤشرات على الجوال" src="/design-review/debts" width={w} height={844} style={{border:0,display:'block',margin:'auto'}}/></main>}
 const cards=[['لنا — ذمم مدينة',84250,'collect'],['علينا — ذمم دائنة',14500,'pay'],['متأخر لنا',12500,'history'],['متأخر علينا',500,'history'],['دفعات مقدمة مدفوعة',18000,'receipt'],['دفعات مقدمة مستلمة',7500,'receipt'],['تحصيل خلال 7 أيام',9200,'collect'],['سداد خلال 7 أيام',3500,'pay']] as const;
 return <DisplayCurrencyProvider locale="ar"><CorporateShell locale="ar"><section className="finance-workspace debt-finance-workspace"><header className="finance-header"><div className="finance-heading"><div><h1>الذمم والتمويل</h1><p>معاينة تصميمية — جميع الأرقام أمثلة توضيحية</p></div></div></header><div className="debt-kpis">{cards.map(([label,value,icon])=><article key={label} className="card debt-kpi" data-tone={icon}><div><small>{label} · SAR</small><ActionIconGlyph name={icon}/></div><strong>{value.toLocaleString('en-US',{minimumFractionDigits:2})} SAR</strong></article>)}</div><h2 style={{fontSize:18}}>الذمم الدائنة</h2><div className="finance-metrics">{cards.slice(0,4).map(([label,value,icon])=><article key={label} className="card finance-metric" data-tone={icon}><span className="finance-icon"><ActionIconGlyph name={icon}/></span><div><small>{label}</small><strong>{value.toLocaleString('en-US',{minimumFractionDigits:2})} SAR</strong><p>الأرصدة الفعلية ضمن النطاق والفلاتر</p></div></article>)}</div></section></CorporateShell></DisplayCurrencyProvider>;
}
