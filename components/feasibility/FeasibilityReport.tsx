'use client';
import type {FeasibilityStudy} from '@/lib/feasibility/engine';
import {evaluateStudy} from '@/lib/feasibility/engine';
import {studyReportReadiness} from '@/lib/feasibility/water-model';
import {downloadFeasibilityCsv} from '@/lib/feasibility/report-export';
import WaterModelPanel from './WaterModelPanel';

export default function FeasibilityReport({study,locale}:{study:FeasibilityStudy;locale:string}){
 const l=(ar:string,en:string)=>locale==='ar'?ar:en;
 const {openCritical,openTasks,highRisks}=studyReportReadiness(study);
 const verified=study.legal.filter(item=>item.status==='VERIFIED').length;
 const fmt=(value:number|null)=>value===null?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
 const money=(value:number|null)=>value===null?'—':fmt(value)+' '+study.currency;
 const base=evaluateStudy(study);
 const metrics=[
  {label:l('السنة','Year'),key:'year'},
  {label:l('حجم المبيعات','Sales volume'),key:'volume'},
  {label:l('الإيرادات','Revenue'),key:'revenue'},
  {label:l('المتغيرة','Variable costs'),key:'variable'},
  {label:l('الثابتة','Fixed costs'),key:'fixed'},
  {label:'EBITDA',key:'ebitda'},
  {label:l('الضريبة','Tax'),key:'taxEstimate'},
  {label:l('الصيانة','Maintenance'),key:'maintenance'},
  {label:l('التدفق الحر','Free cash flow'),key:'freeCashFlow'}
 ] as const;
 const financeRows=[
  [0,null,null,null,null,null,null,null,-base.totalInvestment],
  ...base.annual.map(row=>metrics.map(({key})=>row[key]))
 ];
 const tasks=()=>downloadFeasibilityCsv('feasibility-tasks.csv',[
  [l('المهمة','Task'),l('المجال','Phase'),l('الأولوية','Priority'),l('الحالة','Status'),l('المسؤول','Owner'),
   l('الموعد','Due'),l('الملاحظات','Notes')],
  ...study.tasks.map(x=>[x.title,x.phase,x.priority,x.status,x.owner,x.due,x.notes])
 ]);
 return <div className="fs-block">
  <section className="card fs-panel">
   <h3>{l('التقرير الشامل','Feasibility report')}</h3>
   <p>{[study.country,study.region,study.preparedBy,study.studyDate,study.currency].filter(Boolean).join(' · ')}</p>
   <p>{l('تقدير أولي للقرار الاستثماري. اعتمد المدخلات والوثائق بصورة مستقلة قبل الالتزام بالتمويل.','Preliminary investment assessment. Independently verify inputs and documents before committing funds.')}</p>
   <div className="fs-actions">
    <button className="fs-btn fs-btn--secondary" type="button" onClick={()=>window.print()}>{l('طباعة / PDF','Print / PDF')}</button>
    <button className="fs-btn fs-btn--secondary" type="button" onClick={tasks}>{l('تصدير المهام CSV','Export tasks CSV')}</button>
   </div>
  </section>
  {study.water?<WaterModelPanel water={study.water} locale={locale} currency={study.currency} tab="report" onChange={()=>{}}/>:
   <section className="card fs-panel">
    <h3>{l('الملخص والتوقعات المالية الأساسية','Base-case financial summary and projections')}</h3>
    <ul className="fs-notes">
     <li>{l('الاستثمار الاقتصادي','Economic investment')} · {money(base.totalInvestment)}</li>
     <li>{l('صافي القيمة الحالية','NPV')} · {money(base.npv)}</li>
     <li>{l('العائد الداخلي %','IRR %')} · {fmt(base.irr)}</li>
     <li>{l('فجوة التمويل النقدي','Net funding gap')} · {money(base.cashFundingGap)}</li>
     <li>{l('الملكية الاقتصادية للممول %','Investor economic ownership %')} · {fmt(base.investorShare)}</li>
    </ul>
    <div className="fs-actions"><button className="fs-btn fs-btn--secondary" type="button"
     onClick={()=>downloadFeasibilityCsv('feasibility-projections.csv',[
      [...metrics.map(x=>x.label),l('العملة','Currency')],...financeRows.map(row=>[...row,study.currency])
     ])}>{l('تصدير التوقعات CSV','Export forecast CSV')}</button></div>
    <div className="fs-table-wrap"><table className="fs-table">
     <thead><tr>{metrics.map(({key,label})=><th key={key} scope="col">{label}</th>)}</tr></thead>
     <tbody>{financeRows.map((row,index)=><tr key={index}>{row.map((value,i)=><td key={i}>{fmt(value)}</td>)}</tr>)}</tbody>
    </table></div>
   </section>}
  <section className="card fs-panel">
   <h3>{l('الفحص القانوني والمهام والمخاطر','Legal checks, tasks and risks')}</h3>
   <p>{l('الفحص القانوني المكتمل','Legal checks verified')} · {verified}/{study.legal.length}</p>
   {openCritical.length>0&&<>
    <h4>{l('بنود قانونية حاسمة مفتوحة','Open critical legal checks')}</h4>
    <ul>{openCritical.map(item=><li key={item.id}>{[item.title,item.owner,item.due,item.notes].filter(Boolean).join(' · ')}</li>)}</ul>
   </>}
   <h4>{l('المهام المتبقية','Outstanding tasks')} · {openTasks.length}/{study.tasks.length}</h4>
   {openTasks.length>0&&<ul>{openTasks.map(item=><li key={item.id}>{[item.title,item.owner,item.due].filter(Boolean).join(' · ')}</li>)}</ul>}
   <h4>{l('المخاطر العالية المفتوحة','High open risks')} · {highRisks.length}</h4>
   {highRisks.length>0&&<ul>{highRisks.map(item=><li key={item.id}>{item.title} ({item.impact*item.likelihood}/25) {item.response}</li>)}</ul>}
  </section>
  {study.notes&&<section className="card fs-panel"><h3>{l('ملاحظات الدراسة','Study notes')}</h3><p>{study.notes}</p></section>}
 </div>;
}
