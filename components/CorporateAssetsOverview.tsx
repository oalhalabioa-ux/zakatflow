'use client';
import {useMemo,useState} from 'react';
import Link from './WorkspaceLink';
import {Money} from './DisplayCurrency';
import {ActionIconGlyph,type ActionIcon} from './ActionButton';
import {corporateAssetCategories,corporateAssetCategory,corporateAssetPresentation,type CorporateAssetCategory,type CorporateAssetSummary} from '../lib/corporate-asset-presentation';
import type {RegisterData} from '../lib/financial-register';
const colors={fixed:'#183e5a',current:'#83add0',intangible:'#acba77',investment:'#c69a48',other:'#d9c9aa'};
const labels:Record<CorporateAssetCategory,[string,string]>={current:['أصول متداولة','Current assets'],fixed:['أصول ثابتة','Fixed assets'],intangible:['أصول غير ملموسة','Intangible assets'],investment:['استثمارات','Investments'],other:['أصول أخرى','Other assets']};
const percent=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(n)+'%';
export default function CorporateAssetsOverview({summary:s,locale,entities}:{summary:CorporateAssetSummary;locale:string;entities:RegisterData['entities']}){
 const ar=locale==='ar',t=(a:string,e:string)=>ar?a:e;
 const [query,setQuery]=useState(''),[category,setCategory]=useState(''),[page,setPage]=useState(1);
 const model=useMemo(()=>corporateAssetPresentation(s),[s]),label=(key:CorporateAssetCategory)=>labels[key][ar?0:1];
 const entityNames=useMemo(()=>new Map(entities.map(e=>[e.id,e.name])),[entities]);
 const entityName=(id:string|null)=>id?entityNames.get(id)??'—':'—';
 const filtered=s.assets.filter(a=>(!category||corporateAssetCategory(a)===category)&&(!query||[a.name,label(corporateAssetCategory(a)),entityName(a.entityId)].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
 const pages=Math.max(1,Math.ceil(filtered.length/10)),currentPage=Math.min(page,pages),rows=filtered.slice((currentPage-1)*10,currentPage*10);
 const metrics:Array<{key:string;title:string;value:number;icon:ActionIcon;note:string;count?:boolean}>=[
  {key:'value',title:t('القيمة الحالية المسجلة','Recorded current value'),value:s.totalMarket,icon:'investment',note:t('الأرصدة التشغيلية والتقييمات المحفوظة','Operational balances and saved valuations')},
  {key:'cost',title:t('إجمالي الأصول بالتكلفة','Total assets at cost'),value:s.totalCost,icon:'bank',note:t('النقد والذمم وأصول السجل دون تكرار','Cash, receivables and registered assets without duplication')},
  {key:'gain',title:t('فرق التقييم','Valuation difference'),value:s.difference,icon:'trend',note:s.cost>0?percent(s.difference/s.cost*100)+t(' من تكلفة أصول السجل',' of register asset cost'):t('القيمة الحالية ناقص تكلفة أصول السجل','Current value less register asset cost')},
  {key:'count',title:t('عدد الأصول والاستثمارات','Assets and investments'),value:s.count,icon:'details',note:t('سجلات الأصول والاستثمارات في هذه العملة','Asset and investment records in this currency'),count:true},
 ];
 const allocation=model.categories.filter(c=>c.cost>0);
 const gradient=model.proportional?`conic-gradient(${allocation.map(c=>`${colors[c.key]} ${c.start}% ${c.end}%`).join(',')})`:'#e8edf2';
 return <div className="yaqeen-only cao" aria-label={t('نظرة عامة على الأصول المؤسسية','Corporate asset overview')}>
  <div className="cao-kpis">{metrics.map(m=><article key={m.key} className={`cao-kpi cao-kpi-${m.key}`}><div><h3>{m.title}</h3><span className="cao-kpi-icon"><ActionIconGlyph name={m.icon}/></span></div><strong data-negative={m.key==='gain'&&m.value<0||undefined}>{m.count?new Intl.NumberFormat('en-US').format(m.value):<Money value={m.value} currency={s.currency} precision={0}/>}</strong><p>{m.note}</p></article>)}</div>
  <div className="cao-categories">{model.categories.map(c=><article key={c.key}><span><i style={{background:colors[c.key]}} aria-hidden="true"/>{label(c.key)}</span><strong><Money value={c.cost} currency={s.currency} precision={0}/></strong><small>{c.share==null?'—':percent(c.share)} {t('من إجمالي التكلفة','of total cost')}</small></article>)}</div>
  <div className="cao-analysis">
   <article className="cao-panel"><header><h3>{t('توزيع الأصول حسب الفئة','Assets by category')}</h3><p>{t('التكلفة المسجلة والأرصدة التشغيلية','Recorded costs and operational balances')}</p></header>
    <div className="cao-allocation">{model.proportional?<div className="cao-donut" style={{background:gradient}} role="img" aria-label={t('توزيع تكلفة الأصول حسب الفئة','Asset cost distribution by category')}><div><strong>100%</strong><small>{t('بالتكلفة','At cost')}</small></div></div>:<p className="cao-empty">{t('الرسم النسبي يتطلب أرصدة غير سالبة وإجماليًا موجبًا.','A proportional chart requires nonnegative balances and a positive total.')}</p>}
     <ul>{model.categories.map(c=><li key={c.key}><i style={{background:colors[c.key]}} aria-hidden="true"/><span>{label(c.key)}</span><b><bdi>{c.share==null?'—':percent(c.share)}</bdi></b></li>)}</ul>
    </div>
   </article>
   <article className="cao-panel"><header><h3>{t('التكلفة والقيمة الحالية','Cost and current value')}</h3><p>{t('مقارنة القيم المحفوظة حسب الفئة','Saved values compared by category')}</p></header><div className="cao-legend"><span><i/>{t('التكلفة','Cost')}</span><span><i/>{t('القيمة الحالية','Current value')}</span></div>
    <div className="cao-comparisons">{model.categories.map(c=><div key={c.key} className="cao-comparison"><span>{label(c.key)}</span><div>{[{name:t('التكلفة','Cost'),value:c.cost},{name:t('القيمة الحالية','Current value'),value:c.market}].map((v,i)=><div className="cao-bar-row" key={v.name}><span className={`cao-bar cao-bar-${i}`} style={{width:`${Math.max(0,v.value)/model.comparisonMax*100}%`}} aria-hidden="true"/><small aria-label={v.name}><Money value={v.value} currency={s.currency} precision={0}/></small></div>)}</div></div>)}</div>
   </article>
   <article className="cao-panel cao-current"><header><h3>{t('تفصيل الأصول المتداولة','Current asset breakdown')}</h3><p>{t('أرصدة مرتبطة بالموديولات التشغيلية','Balances linked to operating modules')}</p></header>
    {[{title:t('النقد والبنوك','Cash and banks'),value:s.cash,icon:'bank' as const,route:'cash-and-banks'},{title:t('الذمم المدينة والدفعات للموردين','Receivables and supplier advances'),value:s.receivables,icon:'receipt' as const,route:'receivables'},{title:t('أصول متداولة في السجل','Current register assets'),value:model.currentRegister,icon:'investment' as const,route:'assets'}].map(x=><Link className="cao-current-row" key={x.route} href={`/${locale}/${x.route}?scope=ORGANIZATION`}><span className="cao-current-icon"><ActionIconGlyph name={x.icon}/></span><span>{x.title}<strong><Money value={x.value} currency={s.currency} precision={0}/></strong></span><span aria-hidden="true">{ar?'←':'→'}</span></Link>)}
    <div className="cao-current-total"><span>{t('إجمالي المتداول','Total current assets')}</span><strong><Money value={s.current} currency={s.currency} precision={0}/></strong></div>
   </article>
  </div>
  <section className="cao-register cao-panel"><header><div><h3>{t('الأصول والاستثمارات المسجلة','Registered assets and investments')}</h3><p>{t('القيم الحالية وفق التقييمات المحفوظة','Current values reflect saved valuations')}</p></div><Link className="btn secondary" href={`/${locale}/assets?scope=ORGANIZATION`}><ActionIconGlyph name="details"/>{t('فتح سجل الأصول','Open asset register')}</Link></header>
   <div className="cao-filters"><label><span>{t('البحث في الأصول','Search assets')}</span><input type="search" value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}} placeholder={t('اسم الأصل أو الفئة أو الجهة','Asset, category or entity')}/></label><label><span>{t('الفئة','Category')}</span><select aria-label={t('الفئة','Category')} value={category} onChange={e=>{setCategory(e.target.value);setPage(1)}}><option value="">{t('جميع الفئات','All categories')}</option>{corporateAssetCategories.map(key=><option value={key} key={key}>{label(key)}</option>)}</select></label></div>
   <div className="cao-table-scroll"><table><thead><tr>{[t('اسم الأصل','Asset name'),t('الفئة','Category'),t('الجهة','Entity'),t('التكلفة','Cost'),t('القيمة الحالية','Current value'),t('فرق التقييم','Valuation difference')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(a=><tr key={a.id}><td><strong>{a.name}</strong></td><td><span className="cao-category-label">{label(corporateAssetCategory(a))}</span></td><td>{entityName(a.entityId)}</td><td className="cao-num"><Money value={a.cost} currency={s.currency}/></td><td className="cao-num"><Money value={a.market} currency={s.currency}/></td><td className="cao-num" data-negative={a.market<a.cost||undefined}><Money value={a.market-a.cost} currency={s.currency}/></td></tr>)}{!rows.length&&<tr><td colSpan={6} className="cao-empty">{s.count?t('لا توجد أصول مطابقة للبحث.','No assets match the search.'):t('لا توجد أصول أو استثمارات مسجلة بهذه العملة.','No assets or investments are recorded in this currency.')}</td></tr>}</tbody></table></div>
   <footer className="cao-pagination"><span>{t('عدد النتائج','Results')}: <bdi>{filtered.length}</bdi></span><nav aria-label={t('صفحات سجل الأصول','Asset register pages')}><button type="button" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>{t('السابق','Previous')}</button><span><bdi>{currentPage} / {pages}</bdi></span><button type="button" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>{t('التالي','Next')}</button></nav></footer>
  </section>
  <section className="cao-zakat-link"><span className="cao-current-icon"><ActionIconGlyph name="certificate"/></span><div><h3>{t('تقييم الزكاة المؤسسية','Corporate Zakat assessment')}</h3><p>{t('راجع نماذج التقييم، ثم تابع الاستحقاق والسداد بعد الاعتماد.','Review assessment models, then track liabilities and payments after approval.')}</p></div><Link className="btn secondary" href={`/${locale}/assessments?scope=ORGANIZATION`}>{t('نماذج التقييم','Assessment models')}</Link><Link className="btn secondary" href={`/${locale}/payments?scope=ORGANIZATION`}>{t('الاستحقاقات والسداد','Liabilities and payments')}</Link></section>
 </div>;
}
