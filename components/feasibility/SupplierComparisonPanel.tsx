'use client';
import type {StudySupplier} from '@/lib/feasibility/engine';
import {compareSupplierQuotes} from '@/lib/feasibility/supplier-analysis';

const format=(v:number|null)=>v===null||!Number.isFinite(v)?'—':
 new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(v);

export default function SupplierComparisonPanel({suppliers,currency,locale}:{
 suppliers:readonly StudySupplier[];currency:string;locale:string;
}){
 const ar=locale==='ar',t=(a:string,b:string)=>ar?a:b;
 const result=compareSupplierQuotes(suppliers);
 const money=(amount:number|null)=>amount===null?'—':format(amount)+' '+currency;
 return <section className="fs-block" aria-label={t('مقارنة عروض الموردين','Supplier quote comparison')}>
  <h3>{t('مقارنة الأسعار الأولية','Preliminary price comparison')}</h3>
  <p className="fs-hint">{t(
   'تُجمع العروض ذات اسم البند نفسه للمقارنة الأولية فقط. لا تعني أقل قيمة أن العروض متكافئة من حيث المواصفات أو الكمية أو الضمان أو الشحن أو الضريبة. لا تُرحّل النتائج تلقائيًا إلى تكاليف الاستثمار أو أوامر الشراء.',
   'Only identical item labels are grouped for an indicative comparison. The lowest price does not prove equivalent specifications, quantity, warranty, shipping or taxes. No value is posted to investment costs or purchase orders.'
  )}</p>
  {result.incompleteCount>0&&<p className="fs-handoff-note" role="status">
   {t('عروض غير مكتملة أو بأسعار غير صالحة: ','Incomplete or invalid quotes: ')}{result.incompleteCount}
  </p>}
  {result.groups.length===0?
   <p className="fs-hint">{t('أضف اسم البند والمورد وقيمة موجبة للعروض لبدء المقارنة.','Add an item, vendor and positive quote amount to compare offers.')}</p>:
   <div className="fs-table-wrap"><table className="fs-table">
    <thead><tr>
     <th>{t('البند','Item')}</th><th>{t('الموردون المستقلون','Distinct vendors')}</th>
     <th>{t('أقل عرض','Lowest offer')}</th><th>{t('أعلى عرض','Highest offer')}</th>
     <th>{t('فرق الأسعار','Price spread')}</th><th>{t('الأقل سعرًا','Lowest-priced vendor')}</th>
     <th>{t('حالة المقارنة','Comparison status')}</th>
    </tr></thead>
    <tbody>{result.groups.map(group=><tr key={group.item.toLowerCase()}>
     <td>{group.item}</td><td dir="ltr">{group.vendorCount}</td>
     <td dir="ltr">{money(group.lowestOffer)}</td>
     <td dir="ltr">{money(group.highestOffer)}</td>
     <td dir="ltr">{group.priceSpread===null?'—':money(group.priceSpread)+' ('+format(group.spreadPercent)+'%)'}</td>
     <td>{group.lowestVendors.length?group.lowestVendors.join('، '):'—'}</td>
     <td>{group.comparable?t('صالحة لمراجعة الأسعار فقط','Price review only'):
      group.issues.includes('DUPLICATE_VENDOR')?
       t('تكرار عروض المورد نفسه؛ يلزم توضيح','Same vendor has duplicate quotes; review needed'):
       t('يلزم عرض من مورد آخر','Another vendor quote required')}</td>
    </tr>)}</tbody>
   </table></div>}
 </section>;
}
