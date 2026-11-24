'use client';

import {useState} from 'react';
import type {MonthlyLiquidity} from '@/lib/feasibility/monthly-liquidity';
import {liquidityMonthLabel} from '@/lib/feasibility/monthly-liquidity';
import {evaluateLandPhasedLiquidity} from '@/lib/feasibility/land-phased-liquidity';
import type {RawLand} from '@/lib/feasibility/raw-land';
import type {Partnership} from '@/lib/feasibility/partnership';

export default function LandPhasedLiquidity({land,plan,partnership,locale,currency}:{
 land:RawLand;plan:MonthlyLiquidity;partnership?:Partnership;locale:string;currency:string;
}){
 const [enabled,setEnabled]=useState(false);
 const [yearIndex,setYearIndex]=useState(0);
 const ar=locale.startsWith('ar');
 const l=(arText:string,enText:string)=>ar?arText:enText;
 const title=l('السيولة الشهرية على كامل مدة تطوير الأرض','Monthly cash flow over the full land development period');
 const result=enabled?evaluateLandPhasedLiquidity(land,plan,partnership):null;
 const format=new Intl.NumberFormat(locale,{minimumFractionDigits:2,maximumFractionDigits:2});
 const money=(value:number)=>format.format(Math.abs(value)<.005?0:value);
 const monthLabel=(month:number)=>liquidityMonthLabel(plan.startMonth,month,locale);
 const messages={
  'annual-model':l('استكمل نموذج الأرض السنوي وحصص الاستخدام ومراحل البيع والتطوير أولًا.','Complete the annual land model, land-use allocation, and sales and development phases first.'),
  'quantity-costs':l('راجع الكميات وأسعار الوحدات ومصادر التكلفة في ميزانية التطوير أولًا.','Review quantities, unit prices and cost sources in the development budget first.'),
  'rent-assumption':l('أدخل الإيجار السنوي. أدخل صفرًا إذا كانت الأرض متاحة بلا إيجار.','Enter annual rent. Use zero if the land is available rent-free.'),
  'installment-dates':l('حدد شهر البداية وتاريخ حصر الدفعات وأدخل دفعة واحدة على الأقل.','Set the start month and payment cutoff, and enter at least one installment.'),
  'partner-loan-service':l('يتعذر احتساب السيولة لكامل المدة قبل تحديد جدول سداد أصل قروض الشركاء وفوائدها بشكل مستقل عن تسهيل المشروع.','The full forecast needs a partner loan principal and interest schedule separate from the project facility.')
 };
 const year=result?.issue===null?result.years[Math.min(yearIndex,result.years.length-1)]:null;
 const columns=[
  ['opening',l('الرصيد الافتتاحي','Opening cash')],['collections',l('التحصيلات','Collections')],
  ['investment',l('شراء الأرض نقدًا','Cash land acquisition')],['costs',l('التطوير والتشغيل','Development and operating costs')],
  ['debtDraw',l('سحب التسهيل','Facility draws')],['equity',l('المساهمات النقدية','Cash equity')],
  ['principal',l('سداد أصل القرض','Principal')],['interest',l('الفائدة','Interest')],
  ['yearEnd',l('تسويات نهاية السنة','Year-end adjustments')],['net',l('صافي التدفق','Net cash flow')],
  ['closing',l('الرصيد الختامي','Closing cash')]
 ] as const;
 return <>
  <label className="fs-check">
   <input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.currentTarget.checked)}/>
   <span>{title}</span>
  </label>
  {result?.issue&&<p className="fs-warning" role="status">{messages[result.issue]}</p>}
  {result?.issue===null&&year&&<>
   <p className="fs-hint">{l(
    'يُستخدم السيناريو الأساسي، وتُوزّع التدفقات السنوية حسب أشهر التحصيل والصرف المحددة في الجدول لكل سنة. هذا عرض تقديري لا يغيّر الدراسة المحفوظة.',
    'This estimate uses the base scenario and applies the selected collection and payment months in each year. It leaves the saved study unchanged.'
   )}</p>
   {result.beforeStartAcquisition>0&&<p className="fs-hint">{l('شراء الأرض قبل الشهر الأول','Land purchased before month one')} · <bdi>{money(result.beforeStartAcquisition)} {currency}</bdi></p>}
   {result.excludedEquity>0&&<p className="fs-warning">{l('مساهمات نقدية مستبعدة بسبب تواريخ ناقصة أو خارج مدة التوقع','Cash equity excluded because dates are missing or outside the forecast')} · <bdi>{money(result.excludedEquity)} {currency}</bdi></p>}
   {result.closingDebt>.005&&<p className="fs-warning">{l('يبقى رصيد من التسهيل بعد آخر شهر','Facility debt remains after the final month')} · <bdi>{money(result.closingDebt)} {currency}</bdi></p>}
   {result.timingConflict&&<p className="fs-warning">{l('تبدأ خدمة التسهيل قبل أول سحب في إحدى السنوات. راجع توقيت السحب والسداد.','Facility service begins before the first draw in one of the years. Review the draw and payment months.')}</p>}
   <div className="fs-kpis" aria-live="polite">
    <div className="fs-metric"><small>{l('أكبر عجز نقدي تقديري','Largest estimated cash shortfall')}</small><strong dir="ltr">{money(result.fundingGap)} {currency}</strong></div>
    <div className="fs-metric"><small>{l('توقيت أكبر عجز','Peak shortfall timing')}</small><strong>{result.peakMonth===null?'—':result.peakMonth===0?l('قبل الشهر الأول','Before month one'):monthLabel(result.peakMonth)}</strong></div>
    <div className="fs-metric"><small>{l('النقد في نهاية المشروع','End-of-project cash')}</small><strong dir="ltr">{money(result.closing)} {currency}</strong></div>
   </div>
   <label className="fs-field"><span>{l('سنة التوقع','Forecast year')}</span>
    <select value={result.years.indexOf(year)} onChange={event=>setYearIndex(Number(event.currentTarget.value))}>
     {result.years.map((row,index)=><option key={row.year} value={index}>{new Intl.NumberFormat(locale,{useGrouping:false}).format(row.year)}</option>)}
    </select>
   </label>
   <div className="fs-table-wrap" role="region" aria-label={title} tabIndex={0}>
    <table className="fs-table">
     <thead><tr><th scope="col">{l('الشهر','Month')}</th>{columns.map(([key,label])=><th scope="col" key={key}>{label}</th>)}</tr></thead>
     <tbody>{year.rows.map(row=><tr key={row.month}><th scope="row">{monthLabel(row.month)}</th>
      {columns.map(([key])=><td key={key}><bdi>{money(row[key])}</bdi></td>)}
     </tr>)}</tbody>
    </table>
   </div>
  </>}
 </>;
}
