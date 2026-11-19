'use client';
import type {CapitalCategory,FeasibilityStudy} from '@/lib/feasibility/engine';
import {evaluateStudy} from '@/lib/feasibility/engine';
import {RoyalBars} from './RoyalCharts';
import {RoyalIcon} from './RoyalIcon';

const categories:Record<CapitalCategory,{ar:string;en:string}>={
 BUILDINGS:{ar:'مبانٍ وإنشاءات',en:'Buildings'},EQUIPMENT:{ar:'معدات',en:'Equipment'},
 UTILITIES:{ar:'مرافق',en:'Utilities'},LICENCES:{ar:'رسوم وتأسيس',en:'Licences and setup'},OTHER:{ar:'أخرى',en:'Other'},
};

export default function GeneralInvestmentPanel({study,locale,onChange}:{
 study:FeasibilityStudy;locale:string;onChange:(patch:Partial<FeasibilityStudy>)=>void;
}){
 const ar=locale==='ar',l=(a:string,e:string)=>ar?a:e,model=evaluateStudy(study);
 const money=(n:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(n)+(study.currency?' '+study.currency:'');
 const change=(id:string,patch:Partial<FeasibilityStudy['capex'][number]>)=>onChange({capex:study.capex.map(x=>x.id===id?{...x,...patch}:x)});
 return <section className="fs-block fs-royal-capex fs-royal-general-investment">
  <div className="fs-kpis">{[
   [l('بنود الاستثمار النقدية','Cash capital items'),model.capex],
   [l('الأرض العينية','In-kind land'),model.landAsset],
   [l('رأس المال العامل','Working capital'),study.workingCapital],
   [l('إجمالي الاستثمار الاقتصادي','Total economic investment'),model.totalInvestment],
  ].map(([label,value])=><div className="fs-metric" key={label}><small>{label}</small><strong><bdi>{money(value as number)}</bdi></strong></div>)}</div>
  <section className="card fs-panel">
   <h3 className="fs-royal-report-title"><RoyalIcon name="coins"/>{l('جدول البنود الاستثمارية','Investment cost schedule')}</h3>
   <p className="fs-hint">{l('أدخل بنود الإنشاء والتجهيز النقدية. تُسجّل الأرض العينية في الشراكة ولا تضاف هنا مرة ثانية.','Enter cash construction and commissioning items. In-kind land is recorded in Partnership and is not added here again.')}</p>
   <div className="fs-table-wrap fs-royal-water-sales-table" role="region" tabIndex={0} aria-label={l('جدول تكاليف الاستثمار، قابل للتمرير أفقيًا','Investment cost schedule, horizontally scrollable')}>
    <table className="fs-table"><thead><tr>{[l('م','No.'),l('البند الاستثماري','Investment item'),l('التصنيف','Classification'),l('القيمة','Amount'),l('نوع المساهمة','Contribution type'),l('إجراء','Action')].map(x=><th key={x} scope="col">{x}</th>)}</tr></thead>
     <tbody>{study.capex.map((item,i)=><tr key={item.id}>
      <th scope="row">{i+1}</th>
      <td><label className="fs-field"><span>{l('البند الاستثماري','Investment item')+' '+(i+1)}</span><input maxLength={300} value={item.label} onChange={e=>change(item.id,{label:e.currentTarget.value})}/></label></td>
      <td><label className="fs-field"><span>{l('تصنيف البند','Item classification')+' '+(i+1)}</span><select value={item.category} onChange={e=>change(item.id,{category:e.currentTarget.value as CapitalCategory})}>
       {Object.entries(categories).map(([key,label])=><option value={key} key={key}>{ar?label.ar:label.en}</option>)}</select></label></td>
      <td><label className="fs-field"><span>{l('قيمة البند','Item amount')+' '+(i+1)}</span><input type="number" min={0} max={1e12} step="any" value={item.amount} onChange={e=>change(item.id,{amount:Number(e.currentTarget.value)||0})}/></label></td>
      <td><span className="fs-royal-tag">{l('نقدي','Cash')}</span></td>
      <td><button type="button" className="fs-btn fs-btn--secondary" aria-label={l('حذف البند','Remove item')+' '+(i+1)} onClick={()=>onChange({capex:study.capex.filter(x=>x.id!==item.id)})}><RoyalIcon name="trash"/></button></td>
     </tr>)}</tbody>
     <tfoot><tr><th colSpan={3} scope="row">{l('إجمالي البنود النقدية','Total cash items')}</th><td><bdi>{money(model.capex)}</bdi></td><td colSpan={2}/></tr></tfoot>
    </table>
   </div>
   <div className="fs-actions"><button type="button" className="fs-btn" disabled={study.capex.length>=500} onClick={()=>onChange({capex:[...study.capex,
    {id:crypto.randomUUID(),label:l('بند جديد','New item'),category:'OTHER',amount:0}]})}><RoyalIcon name="plus"/>{l('إضافة بند استثماري','Add investment item')}</button></div>
  </section>
  <div className="fs-royal-profile-grid">
   <RoyalBars title={l('توزيع الاستثمار حسب الفئة','Investment costs by category')} locale={locale} unit={study.currency}
    data={Object.entries(categories).map(([key,label])=>({label:ar?label.ar:label.en,value:study.capex.filter(x=>x.category===key).reduce((sum,x)=>sum+x.amount,0)})).filter(x=>x.value>0)}/>
   <section className="card fs-panel">
    <h3 className="fs-royal-report-title"><RoyalIcon name="settings"/>{l('رأس المال العامل والصيانة','Working capital and maintenance')}</h3>
    <div className="fs-form-grid">
     <label className="fs-field"><span>{l('رأس المال العامل الأولي','Opening working capital')}</span><input type="number" min={0} max={1e12} value={study.workingCapital} onChange={e=>onChange({workingCapital:Number(e.currentTarget.value)||0})}/></label>
     <label className="fs-field"><span>{l('الصيانة الرأسمالية السنوية التقريبية','Indicative yearly maintenance')}</span><input type="number" min={0} max={1e12} value={study.annualMaintenance} onChange={e=>onChange({annualMaintenance:Number(e.currentTarget.value)||0})}/></label>
    </div>
    <p className="fs-hint">{l('هذه افتراضات النموذج العام. تُراجع سياسات الإهلاك والدين ودورة النقد في النموذج المالي المتقدم.','These are general-model assumptions. Review depreciation, debt and cash-cycle policies in Advanced model.')}</p>
   </section>
  </div>
 </section>;
}
