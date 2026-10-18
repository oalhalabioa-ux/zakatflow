'use client';
import {Money} from './DisplayCurrency';
import {allocationSegments} from '../lib/dashboard-presentation';
const palette=['#0F2D4A','#24496A','#668FB4','#B9D0E3','#BD8B3C','#EAD7B4'];
const labels:Record<string,[string,string]>={GOLD:['الذهب','Gold'],SILVER:['الفضة','Silver'],CASH:['النقد','Cash'],BANK:['الحسابات البنكية','Bank accounts'],STOCK:['الأسهم','Stocks'],REAL_ESTATE:['العقارات','Real estate'],INVENTORY:['المخزون','Inventory'],RECEIVABLE:['الذمم المدينة','Receivables'],OTHER:['أصول أخرى','Other assets']};
function Distribution({title,rows,ar,note}:{title:string;rows:any[];ar:boolean;note:string}){
 const parts=allocationSegments(rows),total=parts.reduce((s,p)=>s+Number(p.value),0);
 const gradient=parts.length?`conic-gradient(${parts.map((p,i)=>`${palette[i%6]} ${p.start}% ${Math.max(p.start,p.end-.3)}%, white ${Math.max(p.start,p.end-.3)}% ${p.end}%`).join(',')})`:'#E4EAF0';
 return <article className="yqo-chart"><header><h2>{title}</h2><p>{note}</p></header>{parts.length?<div className="yqo-distribution"><div className="yqo-donut" style={{background:gradient}} role="img" aria-label={title}><div><strong><Money value={total} currency="SAR"/></strong><small>{ar?'الإجمالي':'Total'}</small></div></div><ul>{parts.map((p,i)=><li key={p.type}><i style={{background:palette[i%6]}} aria-hidden="true"/><span>{labels[p.type]?.[ar?0:1]||p.type}</span><b>{p.percent.toFixed(1)}%</b><small><Money value={p.value} currency="SAR"/></small></li>)}</ul></div>:<p className="yqo-empty">{ar?'لا تتوفر قيم محفوظة لعرض التوزيع.':'No saved values available for this distribution.'}</p>}</article>;
}
export default function YaqeenAssetOverviewCharts({d,locale}:{d:any;locale:string}){
 const ar=locale==='ar',t=(a:string,e:string)=>ar?a:e,known=!d.loadError&&d.dataHealth?.assets!==false;
 const cost=Number(d.totalPurchaseSar),market=Number(d.totalCurrentSar),max=Math.max(cost||0,market||0,1);
 return <section className="yaqeen-only yqo-charts" aria-label={t('تحليل الأصول والوعاء الزكوي','Assets and Zakat pool analysis')}>
  <Distribution title={t('توزيع الأصول','Asset allocation')} rows={known?d.assetAllocation||[]:[]} ar={ar} note={t('وفق القيمة الحالية للأصول النشطة','Current value of active assets')}/>
  <article className="yqo-chart"><header><h2>{t('التكلفة والقيمة السوقية','Cost and market value')}</h2><p>{t('الأصول النشطة · مقارنة القيم المسجلة','Active assets · recorded values')}</p></header>{known&&Number.isFinite(cost)&&Number.isFinite(market)?<div className="yqo-comparison">{[{label:t('التكلفة','Cost'),value:cost,color:palette[0]},{label:t('القيمة السوقية','Market value'),value:market,color:palette[4]}].map(x=><div key={x.label}><strong><Money value={x.value} currency="SAR"/></strong><div className="yqo-bar-space"><span style={{height:`${Math.max(0,x.value)/max*100}%`,background:x.color}}/></div><span>{x.label}</span></div>)}</div>:<p className="yqo-empty">{t('البيانات غير متاحة','Data unavailable')}</p>}</article>
  <Distribution title={t('توزيع الوعاء الزكوي','Zakat pool allocation')} rows={d.dataHealth?.assessmentLines===false?[]:d.zakatAllocation||[]} ar={ar} note={t('بنود مؤهلة من آخر احتساب محفوظ','Eligible lines from the latest saved assessment')}/>
 </section>;
}
