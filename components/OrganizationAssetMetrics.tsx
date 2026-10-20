'use client';
import {Money} from './DisplayCurrency';
import {ActionIconGlyph,type ActionIcon} from './ActionButton';
import type {organizationAssetDashboard} from '../lib/organization-assets-dashboard';
type Summary=ReturnType<typeof organizationAssetDashboard>[number];
export default function OrganizationAssetMetrics({summary:s,ar}:{summary:Summary;ar:boolean}){
 const share=(value:number)=>s.totalCost>0&&value>=0&&value<=s.totalCost?value/s.totalCost*100:null;
 const percent=(value:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value)+'%';
 const fields:Array<{key:string;label:string;value:number;icon:ActionIcon;note:string;share?:number|null}>=[
 {key:'assets',label:ar?'إجمالي الأصول بالتكلفة':'Total assets at cost',value:s.totalCost,icon:'investment',note:ar?'الأرصدة التشغيلية مع تكلفة أصول السجل':'Operational balances and register asset costs'},
 {key:'market',label:ar?'القيمة الحالية المسجلة':'Recorded current value',value:s.totalMarket,icon:'trend',note:ar?'وفق التقييمات المحفوظة':'Based on saved valuations'},
 {key:'gain',label:ar?'فرق تقييم أصول السجل':'Register valuation difference',value:s.difference,icon:'trend',note:s.cost>0?percent(s.difference/s.cost*100)+(ar?' من تكلفة أصول السجل':' of register asset cost'):(ar?'القيمة الحالية ناقص التكلفة':'Current value minus cost')},
 {key:'current',label:ar?'الأصول المتداولة':'Current assets',value:s.current,icon:'receipt',note:ar?'المخزون والنقد والذمم والدفعات للموردين':'Inventory, cash, receivables and supplier advances',share:share(s.current)},
 {key:'fixed',label:ar?'الأصول الثابتة':'Fixed assets',value:s.fixed,icon:'investment',note:ar?'القيمة الدفترية المسجلة':'Recorded book value',share:share(s.fixed)},
 {key:'intangible',label:ar?'الأصول غير الملموسة':'Intangible assets',value:s.intangible,icon:'certificate',note:ar?'البرمجيات والتراخيص والحقوق المصنفة':'Classified software, licenses and rights',share:share(s.intangible)},
 {key:'investment',label:ar?'الاستثمارات':'Investments',value:s.investment,icon:'investment',note:ar?'القيمة المسجلة للاستثمارات':'Recorded investment value',share:share(s.investment)},
 {key:'other',label:ar?'أصول أخرى تحتاج تصنيفًا':'Other assets needing classification',value:s.other,icon:'details',note:ar?'الأصول غير المصنفة ضمن الفئات السابقة':'Assets not classified in the categories above',share:share(s.other)},
 {key:'cash',label:ar?'النقد والبنوك':'Cash and banks',value:s.cash,icon:'bank',note:ar?'جزء من الأصول المتداولة':'Included in current assets',share:share(s.cash)},
 {key:'receivables',label:ar?'الذمم المدينة والدفعات للموردين':'Receivables and supplier advances',value:s.receivables,icon:'receipt',note:ar?'جزء من الأصول المتداولة':'Included in current assets',share:share(s.receivables)}
 ];
 return <div className="org-assets-metrics" aria-label={ar?'مؤشرات الأصول المؤسسية':'Corporate asset indicators'}>{fields.map(m=><article className={`ed-metric hero-metric org-asset-metric org-asset-metric-${m.key}`} key={m.key} data-negative={m.key==='gain'&&m.value<0||undefined}><div className="ed-metric-heading metric-top"><h2>{m.label}</h2><span className="ed-icon metric-icon" aria-hidden="true"><ActionIconGlyph name={m.icon}/></span></div><strong className="ed-number"><Money value={m.value} currency={s.currency}/></strong><p>{m.note}</p>{m.share!=null&&<div className="org-asset-metric-share"><small>{percent(m.share)} · {ar?'من إجمالي التكلفة':'of total cost'}</small><progress max={100} value={m.share} aria-label={m.label}/></div>}</article>)}</div>;
}
