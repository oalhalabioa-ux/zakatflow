'use client';
import Link from 'next/link';
import {Money} from './DisplayCurrency';
import {ActionIconGlyph,type ActionIcon} from './ActionButton';

type Metric={label:string;value:unknown;icon:ActionIcon;featured?:boolean;note?:string;known:boolean;positive?:boolean;negative?:boolean};
export default function YaqeenAssetsSummary({d,locale}:{d:any;locale:string}){
 const ar=locale==='ar',t=(a:string,e:string)=>ar?a:e;
 const health=d.dataHealth||{},assetsKnown=!d.loadError&&health.assets!==false;
 const assessmentKnown=!d.loadError&&health.assessments!==false&&health.cycles!==false;
 const paymentKnown=assessmentKnown&&health.allocations!==false;
 const assets:Metric[]=[
  {label:t('إجمالي التكلفة','Total cost'),value:d.totalPurchaseSar,icon:'investment',known:assetsKnown},
  {label:t('القيمة السوقية','Market value'),value:d.totalCurrentSar,icon:'trend',known:assetsKnown,featured:true},
  {label:t('الربح / الخسارة غير المحققة','Unrealized gain / loss'),value:d.gainSar,icon:'trend',known:assetsKnown,positive:Number(d.gainSar)>0,negative:Number(d.gainSar)<0,note:d.gainPct==null?'—':`${Number(d.gainPct).toFixed(2)}%`},
  {label:t('الوعاء الزكوي','Zakatable amount'),value:d.zakatableValueSar,icon:'certificate',known:assessmentKnown},
 ];
 const zakat:Metric[]=[
  {label:t('المستحق النهائي المثبت','Finalized liability'),value:d.explicitZakahDueSar,icon:'certificate',known:assessmentKnown},
  {label:t('المدفوع المخصص','Allocated payments'),value:d.allocatedZakahPaidSar,icon:'receipt',known:paymentKnown},
  {label:t('المتبقي النهائي','Final outstanding'),value:d.remainingZakahSar,icon:'history',known:paymentKnown},
  {label:t('تقدير الدورة المفتوحة','Open-cycle estimate'),value:d.openCycleEstimateSar,icon:'history',known:assessmentKnown,note:t('قابل لإعادة الاحتساب','Recalculable')},
  {label:t('الإجمالي حتى آخر احتساب','Balance at last assessment'),value:d.asOfZakahBalanceSar,icon:'investment',known:paymentKnown,note:t('بعد الرصيد المرحّل','After carried credit')},
 ];
 const render=(m:Metric)=><article key={m.label} className={`yqa-summary-metric${m.featured?' is-featured':''}`}><div><span>{m.label}</span><ActionIconGlyph name={m.icon}/></div><strong>{m.known?<Money value={m.value} currency="SAR"/>:'—'}</strong>{m.note&&<small className={m.known&&m.positive?'is-positive':m.known&&m.negative?'is-negative':undefined}>{m.note}</small>}</article>;
 const weight=(value:unknown)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:3}).format(Number(value)||0);
 return <section className="yaqeen-only yqa-assets-summary" aria-label={t('ملخص الأصول والزكاة','Assets and Zakat summary')}>
  <header className="yqa-assets-heading"><div><h1>{t('لوحة الأصول والزكاة','Assets & Zakat dashboard')}</h1><p>{t('أصولك وقيمتها واستحقاقات الزكاة وفق البيانات المسجلة','Asset values and Zakat obligations from recorded data')}</p></div><Link className="btn secondary" href={`/${locale}/assessments`}><ActionIconGlyph name="history"/>{d.activeCycle?`${t('الدورة','Cycle')} #${d.activeCycle.cycle_no}`:t('احتساب الزكاة','Zakat assessment')}</Link></header>
  <div className="yqa-summary-groups"><section className="yqa-summary-group"><h2><ActionIconGlyph name="investment"/>{t('الأصول والاستثمارات','Assets & investments')}</h2><div className="yqa-summary-grid">{assets.map(render)}</div></section><section className="yqa-summary-group"><h2><ActionIconGlyph name="certificate"/>{t('الزكاة','Zakat')}</h2><div className="yqa-summary-grid zakat">{zakat.map(render)}</div></section></div>
  <div className="yqa-assets-context"><span>{t('الأصول النشطة','Active assets')}: <b>{assetsKnown?d.assetCount??0:'—'}</b></span><span>{t('الذهب','Gold')}: <b>{assetsKnown?weight(d.goldWeightKg):'—'}</b> {t('كجم','kg')}</span><span>{t('الفضة','Silver')}: <b>{assetsKnown?weight(d.silverWeightKg):'—'}</b> {t('كجم','kg')}</span><span>{t('رصيد زكاة مرحّل','Carried Zakat credit')}: {paymentKnown?<Money value={d.carriedZakahCreditSar} currency="SAR"/>:'—'}</span></div>
 </section>;
}
