'use client';
import {useRef,useState} from 'react';
import {RoyalIcon} from './RoyalIcon';
import type {FeasibilityStudy} from '@/lib/feasibility/engine';
import {evaluateStudy} from '@/lib/feasibility/engine';
import {handoffReadiness} from '@/lib/feasibility/handoff';
import {evaluateWater,studyReportReadiness} from '@/lib/feasibility/water-model';
import {downloadFeasibilityCsv} from '@/lib/feasibility/report-export';
import WaterModelPanel from './WaterModelPanel';

const exportSections = ['summary','finance','governance','notes'] as const;
type ExportSection = typeof exportSections[number];

export default function FeasibilityReport({study,locale,allowExport=true}:{study:FeasibilityStudy;locale:string;allowExport?:boolean}){
 const l=(ar:string,en:string)=>locale==='ar'?ar:en;
 const report=useRef<HTMLDivElement>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 const [sections,setSections]=useState<ExportSection[]>([...exportSections]);
 const sectionLabels:Record<ExportSection,string>={
  summary:l('الملخص التنفيذي','Executive summary'),finance:l('الافتراضات والتوقعات المالية','Financial assumptions and forecast'),
  governance:l('التراخيص والمهام والمخاطر','Licences, tasks and risks'),notes:l('ملاحظات الدراسة','Study notes')
 };
 function printSelected() {
  const wrapper=report.current;
  if(!wrapper||!sections.length)return;
  dialog.current?.close();
  const hidden=Array.from(wrapper.querySelectorAll<HTMLElement>('[data-report-section]')).filter(
   element=>!sections.includes(element.dataset.reportSection as ExportSection));
  hidden.forEach(element=>element.classList.add('fs-omit-print'));
  const restore=()=>hidden.forEach(element=>element.classList.remove('fs-omit-print'));
  window.addEventListener('afterprint',restore,{once:true});
  try { window.print(); } catch { window.removeEventListener('afterprint',restore);restore(); }
 }
 const {openCritical,openTasks,highRisks}=studyReportReadiness(study);
 const verified=study.legal.filter(item=>item.status==='VERIFIED').length;
 const fmt=(value:number|null)=>value===null?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
 const money=(value:number|null)=>value===null?'—':fmt(value)+' '+study.currency;
 const base=evaluateStudy(study);
 const water=study.water?evaluateWater(study.water):null;
 const ready=handoffReadiness(study);
 const reportMetrics = [
  ['NPV', money(water ? water.ready ? water.npv : null : base.npv)],
  ['IRR', (water ? water.ready ? water.irr : null : base.irr) === null ? '—' : fmt(water ? water.irr : base.irr) + '%'],
  [l('الجاهزية','Readiness'),ready.checks.filter(check=>check.passed).length+' / '+ready.checks.length]
 ];
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
 return <div ref={report} className="fs-block fs-print-report">
  <section className="card fs-panel" data-report-section="summary">
   <h3 className="fs-royal-report-title"><RoyalIcon name="file"/>{l('التقرير الشامل','Feasibility report')}</h3>
   <p>{[study.country,study.region,study.preparedBy,study.studyDate,study.currency].filter(Boolean).join(' · ')}</p>
   <p>{l('تقدير أولي للقرار الاستثماري. اعتمد المدخلات والوثائق بصورة مستقلة قبل الالتزام بالتمويل.','Preliminary investment assessment. Independently verify inputs and documents before committing funds.')}</p>
   {allowExport&&<div className="fs-actions">
    <button className="fs-btn" type="button" onClick={()=>dialog.current?.showModal()}>
     <RoyalIcon name="file"/>{l('خيارات تصدير التقرير','Report export options')}</button>
    <button className="fs-btn fs-btn--secondary" type="button" onClick={()=>window.print()}>{l('طباعة / PDF','Print / PDF')}</button>
    <button className="fs-btn fs-btn--secondary" type="button" onClick={tasks}>{l('تصدير المهام CSV','Export tasks CSV')}</button>
   </div>}
  </section>
  {allowExport&&<dialog ref={dialog} className="fs-dialog fs-royal-dialog" aria-labelledby="fs-report-export-title">
   <div className="fs-royal-heading"><h2 id="fs-report-export-title"><RoyalIcon name="file"/>{l('التقرير الاستثماري الشامل','Investment report export')}</h2>
    <button type="button" className="fs-royal-close" aria-label={l('إغلاق','Close')} onClick={()=>dialog.current?.close()}>×</button></div>
   <div className="fs-royal-scenario-cards fs-royal-report-metrics">{reportMetrics.map(([label,value])=>
    <div className="fs-metric" key={label}><small>{label}</small><strong dir="auto">{value}</strong></div>)}</div>
   <p className="fs-hint">{l('اختر أقسام نسخة PDF. يمكنك تنزيل جداول التوقعات والمهام بصيغة CSV من التقرير.','Select sections for the PDF. Forecast and task tables can be downloaded as CSV from the report.')}</p>
   {exportSections.filter(section=>section!=='notes'||study.notes).map(section=><label className="fs-check" key={section}>
    <input type="checkbox" checked={sections.includes(section)} onChange={event=>{
     const checked=event.currentTarget.checked;
     setSections(current=>checked?[...current,section]:current.filter(item=>item!==section));
    }}/><span>{sectionLabels[section]}</span>
   </label>)}
   <div className="fs-actions">
    <button className="fs-btn" type="button" disabled={!sections.some(section=>section!=='notes'||study.notes)}
     onClick={printSelected}>{l('طباعة الأقسام المحددة / PDF','Print selected sections / PDF')}</button>
    <button className="fs-btn fs-btn--secondary" type="button" onClick={()=>dialog.current?.close()}>{l('إلغاء','Cancel')}</button>
   </div>
  </dialog>}
  {study.water?<div data-report-section="finance"><WaterModelPanel water={study.water} locale={locale} currency={study.currency} tab="report" allowExport={allowExport} onChange={()=>{}}/></div>:
   <section className="card fs-panel" data-report-section="finance">
    <h3>{l('الملخص والتوقعات المالية الأساسية','Base-case financial summary and projections')}</h3>
    <ul className="fs-notes">
     <li>{l('الاستثمار الاقتصادي','Economic investment')} · {money(base.totalInvestment)}</li>
     <li>{l('صافي القيمة الحالية','NPV')} · {money(base.npv)}</li>
     <li>{l('العائد الداخلي %','IRR %')} · {fmt(base.irr)}</li>
     <li>{l('فجوة التمويل النقدي','Net funding gap')} · {money(base.cashFundingGap)}</li>
     <li>{l('الملكية الاقتصادية للممول %','Investor economic ownership %')} · {fmt(base.investorShare)}</li>
    </ul>
    {allowExport&&<div className="fs-actions"><button className="fs-btn fs-btn--secondary" type="button"
     onClick={()=>downloadFeasibilityCsv('feasibility-projections.csv',[
      [...metrics.map(x=>x.label),l('العملة','Currency')],...financeRows.map(row=>[...row,study.currency])
     ])}>{l('تصدير التوقعات CSV','Export forecast CSV')}</button></div>}
    <div className="fs-table-wrap"><table className="fs-table">
     <thead><tr>{metrics.map(({key,label})=><th key={key} scope="col">{label}</th>)}</tr></thead>
     <tbody>{financeRows.map((row,index)=><tr key={index}>{row.map((value,i)=><td key={i}>{fmt(value)}</td>)}</tr>)}</tbody>
    </table></div>
   </section>}
  <section className="card fs-panel" data-report-section="governance">
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
  {study.notes&&<section className="card fs-panel" data-report-section="notes"><h3>{l('ملاحظات الدراسة','Study notes')}</h3><p>{study.notes}</p></section>}
 </div>;
}
