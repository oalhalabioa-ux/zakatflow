'use client';
import type {FeasibilityStudy,IndustrialProductionSchedule,PropertyDevelopmentSchedule,PropertyStage,SectorSchedule} from '@/lib/feasibility/engine';
import {blankIndustrialSchedule,blankPropertySchedule,evaluateIndustrialProduction,evaluatePropertyStages} from '@/lib/feasibility/sector-analysis';

const errors:Record<string,[string,string]>={
 SECTOR_MISMATCH:['نوع المشروع لا يوافق النموذج.','The project does not match the model sector.'],
 INVALID_INPUT:['هناك مدخلات عددية غير صالحة.','Invalid numeric inputs.'],
 CAPACITY_INCOMPLETE:['أكمل الطاقة وأشهر التشغيل ونسب الاستغلال والجودة.','Complete capacity, operating months, utilisation and yield.'],
 DEMAND_OR_PRICE_MISSING:['أدخل طلب العملاء والسعر في صفحة التشغيل.','Enter sales demand and price in Operations.'],
 NONFINITE_RESULT:['تعذر احتساب النتائج؛ تحقق من المبالغ.','Unable to calculate the results.'],
 BAD_HORIZON:['مدة الدراسة يجب أن تكون بين سنة وعشرين سنة.','Forecast horizon must be between one and twenty years.'],
 STAGES_MISSING:['أضف سنة إنشاء أو تعاقد أولًا.','Add a construction or sales year first.'],
 INVALID_STAGE:['راجع سنوات المشروع والوحدات والمبالغ.','Review project years, units and amounts.'],
 DUPLICATE_YEAR:['تكررت السنة؛ اجمع الأرقام في صف واحد.','Duplicate year; combine its amounts in a single row.'],
 PRICE_REQUIRED:['الوحدات المتعاقد عليها تحتاج سعرًا موجبًا.','Contracted units need a positive unit price.'],
 COLLECTIONS_EXCEED_CONTRACTS:['التحصيل المتراكم يتجاوز العقود المبرمة.','Cumulative collections exceed booked contracts.'],
 NO_CONTRACTS:['لم تُدخل تعاقدات للمشروع بعد.','No project contracts have been entered.']
};
const n=(v:number|null|undefined)=>v===null||v===undefined||!Number.isFinite(v)?'—':
 new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(v);
function Field({label,value,onChange,max=1000000000000,integer=false}:{
 label:string;value:number;onChange:(v:number)=>void;max?:number;integer?:boolean
}){
 return <label className="fs-field"><span>{label}</span><input type="number" min={0} max={max}
  step={integer?'1':'any'} value={value} onChange={e=>{
   const x=e.currentTarget.valueAsNumber;
   if(Number.isFinite(x))onChange(integer?Math.trunc(Math.max(0,Math.min(max,x))):Math.max(0,Math.min(max,x)));
   else if(e.currentTarget.value==='')onChange(0);
  }}/></label>;
}
export default function SectorAnalysisPanel({study,locale,onChange}:{
 study:FeasibilityStudy;locale:string;onChange:(value:SectorSchedule)=>void
}){
 const ar=locale==='ar',t=(a:string,b:string)=>ar?a:b;
 const money=(value:number|null|undefined)=>n(value)+' '+study.currency;
 if(study.sector==='INDUSTRIAL'){
  const d=study.sectorSchedule?.kind==='INDUSTRIAL'?study.sectorSchedule:blankIndustrialSchedule();
  const update=(patch:Partial<IndustrialProductionSchedule>)=>onChange({...d,...patch});
  const result=evaluateIndustrialProduction(study);
  return <section className="card fs-panel">
   <h3>{t('إنتاج المصنع ومعدلات الهدر والبيع','Industrial production, rejects and sales')}</h3>
   <p className="fs-hint">{t('تحليل تشغيلي نقدي للسنة الأولى فقط. تؤخذ مبيعات العملاء وسعر الوحدة والتكاليف الثابتة من صفحة التشغيل. التكاليف النقدية تشمل جميع الوحدات المنتجة حتى المرفوضة وغير المباعة، ولا تعد تقييمًا محاسبيًا للمخزون.', 'Year-one cash operating diagnostic. Customer demand, unit price and fixed costs come from Operations. Cash costs include gross production, rejected and unsold units; this is not inventory accounting.')}</p>
   <div className="fs-form-grid">
    <Field label={t('طاقة خط الإنتاج في الشهر','Monthly rated capacity')} value={d.ratedCapacityMonthly} onChange={v=>update({ratedCapacityMonthly:v})}/>
    <Field label={t('أشهر التشغيل في السنة','Operating months')} value={d.operatingMonths} max={12} integer onChange={v=>update({operatingMonths:v})}/>
    <Field label={t('استغلال الطاقة %','Capacity utilisation %')} value={d.utilizationPct} max={100} onChange={v=>update({utilizationPct:v})}/>
    <Field label={t('الإنتاج المقبول للبيع %','Saleable yield %')} value={d.saleableYieldPct} max={100} onChange={v=>update({saleableYieldPct:v})}/>
    <Field label={t('التكلفة النقدية لكل وحدة منتجة إجمالًا','Cash cost per gross unit produced')} value={d.productionCashCostPerGrossUnit}
     onChange={v=>update({productionCashCostPerGrossUnit:v})}/>
   </div>
   {result.blockers.map(code=><p className="fs-handoff-note" key={code}>{ar?errors[code]?.[0]??code:errors[code]?.[1]??code}</p>)}
   {result.ready&&<>
    <div className="fs-kpis">
     <div className="fs-metric"><small>{t('الوحدات المنتجة','Gross units')}</small><strong dir="ltr">{n(result.grossProduction)}</strong></div>
     <div className="fs-metric"><small>{t('الوحدات القابلة للبيع','Saleable units')}</small><strong dir="ltr">{n(result.saleableUnits)}</strong></div>
     <div className="fs-metric"><small>{t('الوحدات المباعة','Sold units')}</small><strong dir="ltr">{n(result.soldUnits)}</strong></div>
     <div className="fs-metric"><small>{t('المساهمة النقدية التشغيلية','Operating cash contribution')}</small><strong dir="ltr">{money(result.operatingCashContribution)}</strong></div>
    </div>
    <div className="fs-table-wrap"><table className="fs-table"><tbody>
     <tr><th>{t('وحدات مرفوضة','Rejected units')}</th><td>{n(result.rejectedUnits)}</td></tr>
     <tr><th>{t('وحدات صالحة غير مباعة','Unsold good units')}</th><td>{n(result.unsoldUnits)}</td></tr>
     <tr><th>{t('المبيعات النقدية النظرية','Indicative sales proceeds')}</th><td>{money(result.revenue)}</td></tr>
     <tr><th>{t('تكاليف الإنتاج النقدية','Gross production cash cost')}</th><td>{money(result.productionCashCosts)}</td></tr>
     <tr><th>{t('التكاليف الثابتة','Fixed annual cash costs')}</th><td>{money(result.fixedCashCosts)}</td></tr>
    </tbody></table></div>
   </>}
  </section>;
 }
 if(study.sector!=='REAL_ESTATE')return null;
 const d=study.sectorSchedule?.kind==='REAL_ESTATE'?study.sectorSchedule:blankPropertySchedule();
 const stages=d.stages.slice().sort((a,b)=>a.year-b.year);
 const result=evaluatePropertyStages(study);
 const nextYear=Array.from({length:Math.max(0,Math.min(20,study.years))},(_,i)=>i+1)
  .find(year=>!stages.some(s=>s.year===year));
 const updateYear=(year:number,patch:Partial<PropertyStage>)=>
  onChange({kind:'REAL_ESTATE',stages:stages.map(s=>s.year===year?{...s,...patch}:s)});
 const addYear=()=>{if(nextYear===undefined)return;onChange({kind:'REAL_ESTATE',stages:[...stages,
  {year:nextYear,contractedUnits:0,contractPricePerUnit:0,cashCollections:0,
   constructionCashCost:0,sellingCashCost:0}]})};
 return <section className="card fs-panel">
  <h3>{t('مراحل الإنشاء والتعاقد والتحصيل','Property construction, contracts and collection stages')}</h3>
  <p className="fs-hint">{t('أدخل قيمة التعاقدات والتحصيلات والتكاليف النقدية لكل سنة بصورة مستقلة. تكاليف صفحة الاستثمار أولية؛ لا تكررها هنا. الأرض المنقولة ملكيتها تكلفة اقتصادية وليست سيولة للصرف. هذا جدول نقدي لا يمثل إيرادات عقارية معترفًا بها محاسبيًا.', 'Enter booked contracts, collections and cash costs by year separately. Investment-tab CAPEX is initial spending; do not duplicate it. Transferred land is economic value, not cash. This is a cash schedule, not accounting revenue recognition.')}</p>
  <div className="fs-table-wrap"><table className="fs-table"><thead><tr>
   <th>{t('السنة','Year')}</th><th>{t('وحدات متعاقد عليها','Units contracted')}</th>
   <th>{t('سعر الوحدة','Unit sale price')}</th><th>{t('المتحصل النقدي','Cash collected')}</th>
   <th>{t('تكلفة الإنشاء','Construction costs')}</th><th>{t('تكلفة البيع والتشغيل','Selling & operating costs')}</th>
   <th>{t('حذف','Remove')}</th>
  </tr></thead><tbody>
   {stages.map(stage=><tr key={stage.year}>
    <td>{stage.year}</td>
    {([
     ['contractedUnits',1000000000,true],['contractPricePerUnit',1000000000000,false],
     ['cashCollections',1000000000000,false],['constructionCashCost',1000000000000,false],
     ['sellingCashCost',1000000000000,false]
    ] as const).map(([field,max,integer])=><td key={field}><input type="number" min={0} max={max}
      step={integer?'1':'any'} value={stage[field]} aria-label={t('سنة','Year')+' '+stage.year+' '+field}
      onChange={e=>{
       const v=e.currentTarget.valueAsNumber;
       if(Number.isFinite(v))updateYear(stage.year,{[field]:integer?Math.trunc(Math.max(0,Math.min(max,v))):Math.max(0,Math.min(max,v))});
       else if(e.currentTarget.value==='')updateYear(stage.year,{[field]:0});
      }}/></td>)}
    <td><button type="button" onClick={()=>onChange({kind:'REAL_ESTATE',stages:stages.filter(s=>s.year!==stage.year)})}
      aria-label={t('حذف السنة','Remove year')+' '+stage.year}>×</button></td>
   </tr>)}
  </tbody></table></div>
  <button className="fs-btn fs-btn--secondary" type="button" onClick={addYear} disabled={nextYear===undefined}>{t('إضافة سنة +','Add year +')}</button>
  {result.blockers.map(code=><p className="fs-handoff-note" key={code}>{ar?errors[code]?.[0]??code:errors[code]?.[1]??code}</p>)}
  {result.ready&&<>
   <div className="fs-kpis">
    <div className="fs-metric"><small>{t('التعاقدات','Booked contracts')}</small><strong dir="ltr">{money(result.bookings)}</strong></div>
    <div className="fs-metric"><small>{t('المحصّل نقدًا','Cash collected')}</small><strong dir="ltr">{money(result.collections)}</strong></div>
    <div className="fs-metric"><small>{t('عقود غير محصلة','Uncollected contracts')}</small><strong dir="ltr">{money(result.outstandingReceivables)}</strong></div>
    <div className="fs-metric"><small>{t('أعلى فجوة تمويل نقدي','Peak cash funding gap')}</small><strong dir="ltr">{money(result.peakCashFundingNeed)}</strong></div>
    <div className="fs-metric"><small>NPV</small><strong dir="ltr">{money(result.projectNpv)}</strong></div>
    <div className="fs-metric"><small>IRR</small><strong dir="ltr">{result.projectIrr===null?'—':n(result.projectIrr)+'%'}</strong></div>
   </div>
   <div className="fs-table-wrap"><table className="fs-table"><thead><tr>
    <th>{t('السنة','Year')}</th><th>{t('قيمة التعاقدات','Contracts')}</th>
    <th>{t('التحصيل','Receipts')}</th><th>{t('البناء','Construction')}</th>
    <th>{t('البيع والتشغيل','Selling and operations')}</th><th>{t('صافي التدفق','Net cash flow')}</th>
    <th>{t('المتبقي غير المحصل','Outstanding contracts')}</th>
   </tr></thead><tbody>
    {result.years.map(y=><tr key={y.year}><td>{y.year}</td><td>{money(y.bookedContracts)}</td>
     <td>{money(y.cashCollections)}</td><td>{money(y.constructionCashCost)}</td>
     <td>{money(y.sellingCashCost)}</td><td>{money(y.netCashFlow)}</td>
     <td>{money(y.outstandingReceivables)}</td></tr>)}
   </tbody></table></div>
   <p className="fs-hint">{t('لا يعترف هذا النموذج بإيرادات محاسبية أو ضرائب أو حساب ضمان. التعاقدات غير المحصلة لا تتحول تلقائيًا إلى نقد عند نهاية الدراسة.','This is not a statutory revenue, tax or escrow schedule. Uncollected contracts do not become terminal cash automatically.')}</p>
  </>}
 </section>;
}
