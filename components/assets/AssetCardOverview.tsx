'use client';

import {ActionIconGlyph,type ActionIcon} from '../ActionButton';
import type {readAssetStatement} from '../../services/asset-statement';

export type AssetCardStatement = Awaited<ReturnType<typeof readAssetStatement>>;

export function assetCardNumber(value:string|null|undefined){
 if(value==null)return '—';
 const [whole,fraction]=value.split('.');
 return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction:'');
}

export function AssetCardOverview({statement,ar,loading}:{statement:AssetCardStatement|null;ar:boolean;loading:boolean}){
 const t=(arabic:string,english:string)=>ar?arabic:english;
 const currency=statement?.baseCurrency;
 const unit=ar&&statement?.asset.unit==='g'?'غ':statement?.asset.unit;
 const cards:[string,ActionIcon,string|null|undefined,string|undefined][]=[
  [t('الكمية المتبقية','Remaining quantity'),'operations',statement?.closing.quantity,unit],
  [statement?.asset.organizational?t('صافي القيمة الدفترية','Net book value'):t('التكلفة المتبقية','Remaining cost'),'details',statement?.closing.cost,currency],
  [t('القيمة السوقية الحالية','Current market value'),'investment',statement?.valuation?.value,currency],
  [t('صافي الربح أو الخسارة المحققة','Net realized gain or loss'),'trend',statement?.realized,currency],
 ];
 return <section className="asset-card-overview" aria-label={t('ملخص رصيد الأصل','Asset balance summary')} aria-busy={loading}>
  <dl>{cards.map(([label,icon,value,suffix])=><div className="asset-card-kpi" key={label}>
   <dt><ActionIconGlyph name={icon}/>{label}</dt>
   <dd><bdi>{loading?'…':assetCardNumber(value)}{!loading&&value!=null&&suffix?` ${suffix}`:''}</bdi></dd>
  </div>)}</dl>
 </section>;
}

export function AssetCardZakat({statement,hawlLots,zakatable,organizational,ar}:{statement:AssetCardStatement|null;
 hawlLots:{id:string;hawl_start_date?:string;current_hawl_start_date?:string}[];zakatable:boolean;organizational:boolean;ar:boolean}){
 const t=(arabic:string,english:string)=>ar?arabic:english;
 const dates=[...new Set(hawlLots.map(lot=>lot.current_hawl_start_date??lot.hawl_start_date).filter(Boolean))].sort();
 const sales=statement?.rows.filter(row=>row.type==='SALE'&&['ACTUAL','RECORDED','UNVERIFIED'].includes(row.status))??[];
 return <section className="asset-card-impact" aria-label={t('أثر العمليات على الزكاة','Zakat impact of operations')}>
  {organizational?<p>{t('يظهر البيع في كشف حركة الأصل بعد الترحيل. تسجيل القبض وإضافته إلى حساب النقد أو البنك إجراء مالي مستقل.','A sale appears in the asset statement after posting. Collection into a cash or bank account is a separate financial operation.')}</p>:<>
   {zakatable&&<div className="asset-card-notes"><h3>{t('بداية الحول للدفعات المتبقية','Hawl start for remaining lots')}</h3>
    <p>{dates.length?dates.map(date=><bdi className="asset-card-chip" key={date}>{date}</bdi>):t('لا يوجد تاريخ حول مسجّل للدفعات المتبقية.','No Hawl date is recorded for the remaining lots.')}</p></div>}
   <div className="asset-card-notes"><h3>{t('متحصلات البيع واستمرار الحول','Sale proceeds and Hawl continuity')}</h3>
    <p>{t('يعرض هذا القسم القبض المرتبط بسند البيع وتواريخ الحول التي يثبتها سجل دفعة القبض.','This section shows the receipt linked to each sale and any Hawl dates supported by its cash-lot record.')}</p>
    {statement&&sales.length===0&&<p>{t('لا تظهر عمليات بيع منفذة في هذه الصفحة من الكشف.','This statement page has no posted sales.')}</p>}
    {sales.length>0&&<ul>{sales.map(row=><li key={row.id}>
     <strong><bdi>{row.voucher??row.reference??row.date}</bdi></strong>
     {!!row.cashImpact?.sourceHawlDates.length&&<span>{t('تواريخ حول الدفعات المباعة','Hawl dates of sold lots')}{' '}
      {row.cashImpact.sourceHawlDates.map(date=><bdi className="asset-card-chip" key={date}>{date}</bdi>)}</span>}
     {row.cashImpact?.receipt?<>
      <span>{t('سُجّل القبض في','Recorded in')} <bdi>{row.cashImpact.receipt.account}</bdi> · <bdi>{assetCardNumber(row.sale?.proceeds)} {statement?.baseCurrency}</bdi></span>
      <span>{row.cashImpact.receipt.inheritedHawlDates.length?t('بداية الحول الموروثة المسجلة','Recorded inherited Hawl start'):
       t('استمرار الحول من دفعات هذا الأصل غير مثبت في سجل القبض.','The receipt record does not establish Hawl continuity from this asset’s lots.')}{' '}
       {row.cashImpact.receipt.inheritedHawlDates.map(date=><bdi className="asset-card-chip" key={date}>{date}</bdi>)}</span>
     </>:<span>{t('لا يظهر سند قبض نقدي مرتبط بهذه العملية.','No linked cash receipt is available for this sale.')}</span>}
    </li>)}</ul>}
   </div>
  </>}
  <p>{t('تظل الاحتسابات النهائية المحفوظة كما اعتُمدت.','Saved final assessments retain their approved results.')}</p>
 </section>;
}
