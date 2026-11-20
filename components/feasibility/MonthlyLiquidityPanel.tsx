'use client';

import type {FeasibilityStudy} from '@/lib/feasibility/engine';
import {defaultMonthlyLiquidity,evaluateMonthlyLiquidity,liquidityMonthLabel,liquidityTiming,
 monthlyCashEquity,monthlyLiquidityAmounts,monthlyLiquiditySchema,type MonthlyLiquidity} from '@/lib/feasibility/monthly-liquidity';
import {RoyalIcon} from './RoyalIcon';

type Stream=keyof MonthlyLiquidity['timing'];

export default function MonthlyLiquidityPanel({study,locale,readOnly,onChange}:{
 study:FeasibilityStudy;locale:string;readOnly:boolean;onChange:(value:MonthlyLiquidity)=>void;
}){
 const ar=locale.startsWith('ar');
 const l=(arText:string,enText:string)=>ar?arText:enText;
 const title=l('السيولة الشهرية لأول 12 شهرًا','First 12 months of cash flow');
 const plan=study.monthlyLiquidity;
 const general=!study.rawLand&&!study.water;
 if(!plan&&readOnly)return null;
 if(!plan)return <section className="card fs-panel fs-monthly-liquidity">
  <h3 className="fs-royal-report-title"><RoyalIcon name="coins"/>{title}</h3>
  <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>onChange(general?{...defaultMonthlyLiquidity,cashEquityFromStudy:true}:defaultMonthlyLiquidity)}>
   {l('إعداد جدول السيولة','Set up monthly cash flow')}
  </button>
 </section>;
 const amounts=monthlyLiquidityAmounts(study);
 const result=amounts&&evaluateMonthlyLiquidity(amounts,plan);
 const cashEquity=monthlyCashEquity(amounts,plan);
 const streamAmount=(key:Stream)=>key==='equity'?cashEquity:amounts?.[key]??0;
 const streams:Record<Stream,string>={
  collections:l('التحصيلات','Collections'),
  investment:study.rawLand?l('شراء الأرض نقدًا','Cash land acquisition'):l('الاستثمار الأولي ورأس المال العامل','Initial investment and working capital'),
  costs:study.rawLand?l('تكاليف التطوير','Development costs'):general?l('الثابتة والصيانة','Fixed costs and maintenance'):l('التشغيل والصيانة','Operations and maintenance'),
  variableCosts:l('التكاليف المتغيرة والتوريد','Variable costs and procurement'),
  workingCapital:l('تغير رأس المال العامل','Working capital movement'),
  debtDraw:l('سحب القرض','Loan draw'),
  principal:l('سداد أصل القرض','Principal payments'),
  interest:l('دفع الفائدة','Interest payments'),
  equity:l('ضخ رأس المال النقدي','Cash equity paid in')
 };
 const formatter=new Intl.NumberFormat(locale,{minimumFractionDigits:2,maximumFractionDigits:2});
 const money=(value:number)=>formatter.format(Math.abs(value)<.005?0:value);
 const monthLabel=(month:number)=>liquidityMonthLabel(plan.startMonth,month,locale);
 const monthOptions=Array.from({length:12},(_,index)=>index+1);
 const updateAmount=(key:'openingCash'|'cashEquity',raw:string)=>{
  const value=Number(raw);
  if(Number.isFinite(value)&&value>=0&&value<=1e12)onChange({...plan,[key]:value});
 };
 const updateTiming=(key:Stream,boundary:'from'|'to',value:number)=>{
  const {from,to}=plan.timing[key]??liquidityTiming[key];
  const range=boundary==='from'?{from:value,to:Math.max(value,to)}:{from:Math.min(value,from),to:value};
  onChange({...plan,timing:{...plan.timing,[key]:range}});
 };
 const debtTimingConflict=amounts&&amounts.debtDraw>0&&(['principal','interest'] as const).some(
  key=>amounts[key]<0&&(plan.timing[key]??liquidityTiming[key]).from<(plan.timing.debtDraw??liquidityTiming.debtDraw).from);
 const columns=[
  ['opening',l('الرصيد الافتتاحي','Opening cash')],['collections',streams.collections],['investment',streams.investment],
  ['costs',streams.costs],['variableCosts',streams.variableCosts],['workingCapital',streams.workingCapital],['debtDraw',streams.debtDraw],['equity',streams.equity],
  ['principal',streams.principal],['interest',streams.interest],['yearEnd',l('تسويات نهاية السنة','Year-end adjustments')],
  ['net',l('صافي التدفق','Net cash flow')],['closing',l('الرصيد الختامي','Closing cash')]
 ] as const;
 const visibleColumns=general?columns:columns.filter(([key])=>key!=='variableCosts');
 return <section className="card fs-panel fs-monthly-liquidity">
  <h3 className="fs-royal-report-title"><RoyalIcon name="coins"/>{title}</h3>
  <p className="fs-hint">{l(
   'تُوزّع مبالغ السنة الأولى بالتساوي بين الأشهر المحددة لكل بند. يُقاس العجز بأرصدة نهاية الأشهر بعد السحب والضخ. تغيير التوقيت يُبقي مبالغ القرض والفائدة السنوية كما هي. يمكن إدراج النقد المتاح أصلًا في الرصيد الافتتاحي وإدخال الدفعات الجديدة ضمن ضخ رأس المال.',
   'Year-one amounts are spread evenly over the selected months for each line. The gap uses month-end balances after draws and contributions. Timing changes keep the annual loan and interest amounts fixed. Enter cash already on hand as opening cash and new equity payments as cash equity paid in.'
  )}</p>
  <div className="fs-form-grid">
   <label className="fs-field"><span>{l('شهر بداية الجدول','Schedule start month')}</span>
    <input type="month" min="1900-01" max="2200-12" value={plan.startMonth??''} onChange={event=>{
     const next={...plan,startMonth:event.currentTarget.value||undefined};
     if(monthlyLiquiditySchema.safeParse(next).success)onChange(next);
    }}/></label>
   <label className="fs-field"><span>{l('النقد المتاح قبل بداية الجدول','Cash on hand before month one')}</span>
    <input type="number" inputMode="decimal" min={0} max={1e12} step="any" value={plan.openingCash}
     onChange={event=>updateAmount('openingCash',event.currentTarget.value)}/></label>
   <label className="fs-field"><span>{streams.equity}</span>
    <input type="number" inputMode="decimal" min={0} max={1e12} step="any" value={cashEquity} disabled={general&&plan.cashEquityFromStudy}
     onChange={event=>updateAmount('cashEquity',event.currentTarget.value)}/></label>
  </div>
  {general&&<label className="fs-check"><input type="checkbox" checked={plan.cashEquityFromStudy===true}
   onChange={event=>onChange({...plan,cashEquityFromStudy:event.currentTarget.checked})}/>
   <span>{l('ربط المساهمات النقدية بمدخلات الدراسة','Link cash equity to study inputs')}</span></label>}
  {!amounts||!result?<p className="fs-hint">{l('راجع مدخلات النموذج السنوي لحساب السيولة الشهرية.','Review the annual model inputs to calculate monthly cash flow.')}</p>:<>
   <p className="fs-hint">{study.water?l(
    'يستخدم المصنع إيرادات السنة الأولى أساسًا للتحصيلات مع عرض تغير رأس المال العامل مستقلًا. تُدرج الضريبة التقديرية والتدفقات النهائية المستحقة في الشهر 12.',
    'The water model uses year-one revenue as the basis for collections and shows the working capital movement separately. Estimated tax and any terminal cash flows due appear in month 12.'
   ):study.rawLand?l(
    'يستخدم القالب تحصيلات السنة الأولى من جدول البيع. تنطلق الدفعة النقدية للأرض افتراضيًا في الشهر الأول، وتظهر أتعاب الأداء المستحقة في الشهر 12.',
    'Collections come from the first year of the sales schedule. Cash land acquisition defaults to month one, and any performance fee due appears in month 12.'
   ):l(
    'اضبط أشهر التحصيل والتوريد بحسب آجال العملاء والموردين. أدخل تأخير التحصيل الناتج عن تعتيق المنتجات عند انطباقه. تُدرج تسويات نهاية السنة في الشهر 12.',
    'Set collection and procurement months to reflect trading terms. Allow for any aging period before collections begin. Year-end adjustments fall in month 12.'
   )}</p>
   {general&&<p className="fs-hint">{amounts.general?.basis==='advanced'?
    l('أساس الحساب هو السيناريو الأساسي في النموذج المالي المتقدم.','Based on the advanced financial model’s base scenario.'):
    l('أساس الحساب هو السيناريو الأساسي في النموذج السنوي المبسط.','Based on the simplified annual model’s base scenario.')}</p>}
   <div className="fs-kpis" aria-live="polite">
    <div className="fs-metric"><small>{l('التمويل الإضافي المطلوب','Additional funding required')}</small><strong dir="ltr">{money(result.fundingGap)} {study.currency}</strong></div>
    <div className="fs-metric"><small>{l('شهر أكبر عجز','Peak shortfall month')}</small><strong>{result.peakMonth===null?'—':monthLabel(result.peakMonth)}</strong></div>
    <div className="fs-metric"><small>{l('رصيد نهاية الشهر 12','Month 12 closing cash')}</small><strong dir="ltr">{money(result.closing)} {study.currency}</strong></div>
   </div>
   {amounts.general?.basis==='simple'&&amounts.debtDraw>0&&<p className="fs-warning" role="status">{l(
    'يشمل الجدول سحب التمويل. لاستكمال أصل القرض والفائدة، أدخل شروط القرض واستكمل بيانات النموذج المالي المتقدم.',
    'The schedule includes loan draws. Complete the loan terms and inputs in the advanced financial model to include principal and interest.'
   )}</p>}
   {debtTimingConflict&&<p className="fs-warning" role="status">{l('تبدأ خدمة القرض قبل شهر السحب. راجع توقيت السداد والسحب.','Debt service starts before the loan draw. Review the draw and payment months.')}</p>}
   <details>
    <summary>{l('توقيت التحصيل والصرف والتمويل','Collection, payment and financing timing')}</summary>
    <div className="fs-table-wrap" role="region" aria-label={l('توقيت التدفقات','Cash flow timing')} tabIndex={0}>
     <table className="fs-table">
      <thead><tr><th scope="col">{l('البند','Cash flow line')}</th><th scope="col">{l('المبلغ','Amount')} {study.currency}</th>
       <th scope="col">{l('من شهر','From month')}</th><th scope="col">{l('إلى شهر','To month')}</th></tr></thead>
      <tbody>{(Object.keys(streams) as Stream[]).filter(key=>streamAmount(key)!==0).map(key=><tr key={key}>
       <th scope="row">{streams[key]}</th><td><bdi>{money(streamAmount(key))}</bdi></td>
       {(['from','to'] as const).map(boundary=><td key={boundary}><select aria-label={streams[key]+' '+(
        boundary==='from'?l('من شهر','from month'):l('إلى شهر','to month'))}
        value={(plan.timing[key]??liquidityTiming[key])[boundary]}
        onChange={event=>updateTiming(key,boundary,Number(event.currentTarget.value))}>
        {monthOptions.map(month=><option key={month} value={month}>{monthLabel(month)}</option>)}
       </select></td>)}
      </tr>)}</tbody>
     </table>
    </div>
   </details>
   <div className="fs-table-wrap" role="region" aria-label={title} tabIndex={0}>
    <table className="fs-table">
     <thead><tr><th scope="col">{l('الشهر','Month')}</th>{visibleColumns.map(([key,label])=><th scope="col" key={key}>{label}</th>)}</tr></thead>
     <tbody>{result.rows.map(row=><tr key={row.month}>
      <th scope="row">{monthLabel(row.month)}</th>
      {visibleColumns.map(([key])=><td key={key}><bdi>{money(row[key])}</bdi></td>)}
     </tr>)}</tbody>
    </table>
   </div>
  </>}
 </section>;
}
