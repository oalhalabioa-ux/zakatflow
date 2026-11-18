'use client';
import {useId,useRef,useState} from 'react';
import {RoyalIcon,type RoyalIconName} from './RoyalIcon';
import type {FeasibilityStudy} from '@/lib/feasibility/engine';
import {evaluateStudy} from '@/lib/feasibility/engine';
import {handoffReadiness} from '@/lib/feasibility/handoff';
import {evaluateRawLand} from '@/lib/feasibility/raw-land';
import RawLandPanel from './RawLandPanel';
import {evaluateWater,studyReportReadiness} from '@/lib/feasibility/water-model';
import {downloadFeasibilityCsv} from '@/lib/feasibility/report-export';
import WaterModelPanel from './WaterModelPanel';

const exportSections = ['summary','finance','funding','ownership','governance','decisions','notes'] as const;
type ExportSection = typeof exportSections[number];

export default function FeasibilityReport({study,locale,allowExport=true}:{study:FeasibilityStudy;locale:string;allowExport?:boolean}){
 const l=(ar:string,en:string)=>locale==='ar'?ar:en;
 const report=useRef<HTMLDivElement>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 const dialogTitleId=useId();
 const sectionId=(section:ExportSection)=>dialogTitleId+'-section-'+section;
 const [sections,setSections]=useState<ExportSection[]>([...exportSections]);
 const sectionLabels:Record<ExportSection,string>={
  summary:l('الملخص التنفيذي','Executive summary'),finance:l('الافتراضات والتوقعات المالية','Financial assumptions and forecast'),
  funding:l('هيكل التمويل وقروض المساهمين','Funding and shareholder loans'),
  ownership:l('الشراكة والملكية الاقتصادية','Partnership and economic ownership'),
  governance:l('التراخيص والمهام والمخاطر','Licences, tasks and risks'),
  decisions:l('القرارات والمحاضر','Decisions and minutes'),notes:l('ملاحظات الدراسة','Study notes')
 };
 const sectionDescriptions:Record<ExportSection,string>={
  summary:l('بيانات المشروع والقرار الأولي','Project details and initial decision'),
  finance:l('الاستثمار والتدفقات ومؤشرات العائد','Investment, cash flows and returns'),
  funding:l('مصادر التمويل وخدمة الدين','Sources of funding and debt service'),
  ownership:l('المساهمات النقدية والعينية والحصص','Cash and in-kind contributions and ownership'),
  governance:l('المتطلبات المفتوحة وأدلة التحقق','Open requirements and supporting evidence'),
  decisions:l('القرارات المسجلة ومحاضرها','Recorded decisions and minutes'),
  notes:l('الملاحظات المحفوظة مع الدراسة','Notes saved with the study')
 };
 const availableSections=exportSections.filter(section=>
  (section!=='notes'||study.notes)&&(section!=='decisions'||study.decisions.length>0));
 function printSelected() {
  const wrapper=report.current;
  if(!wrapper||!availableSections.some(section=>sections.includes(section)))return;
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
 const money=(value:number|null)=>value===null?'—':[fmt(value),study.currency].filter(Boolean).join(' ');
 const percent=(value:number|null)=>value===null?'—':fmt(value)+'%';
 const base=evaluateStudy(study);
 const land=study.rawLand?evaluateRawLand(study.rawLand):null;
 const landResult=land?.issue===null&&land.ready?land:null;
 const water=study.water?evaluateWater(study.water):null;
 const deal=study.water?.deal;
 const funding=study.rawLand?[
  [l('التسهيل التمويلي','Financing facility'),money(study.rawLand.finance.facility)],
  [l('تكاليف التطوير النقدية','Cash development costs'),money(landResult?.cashDevelopmentCost??null)],
  [l('ذروة عجز التمويل بعد الدين','Peak funding gap after debt'),money(landResult?.peakEquityDeficit??null)],
  [l('رصيد الدين الختامي','Closing debt'),money(landResult?.annual.at(-1)?.closingDebt??null)]
 ]:water&&study.water&&deal?[
  [l('تكلفة التأسيس مع الرسوم','Establishment costs including fees'),money(water.investment)],
  [l('رأس المال العامل الأولي','Opening working capital'),money(study.water.capex.workingCapital)],
  [l('التمويل النقدي المطلوب عند التأسيس','Initial cash requirement'),money(water.cashRequired)],
  [l('إجمالي رأس مال الممول النقدي','Total investor cash equity'),money(water.investorEquity)],
  [l('قرض المساهم المخصص للتأسيس','Shareholder loan allocated to establishment'),money(water.shareholderLoan)],
  [l('التمويل الإضافي','Additional funding'),money(deal.extraFunding)],
  [l('معالجة التمويل الإضافي','Additional funding classification'),
   deal.extraFunding===0?'—':deal.extraType==='loan'?l('قرض مساهم','Shareholder loan'):l('زيادة رأس المال','Equity injection')],
  [l('إجمالي قروض المساهمين','Total shareholder debt'),money(water.totalLoan)],
  [l('فائدة القرض','Loan interest rate'),water.totalLoan>0?percent(deal.loanInterest):'—'],
  [l('أول سنة للسداد','First repayment year'),water.totalLoan>0?fmt(Math.max(1,deal.loanStart)):'—'],
  [l('مدة السداد بالسنوات','Repayment term in years'),water.totalLoan>0?fmt(Math.max(1,deal.loanYears)):'—'],
  [l('الرصيد بعد آخر سنة من التوقعات','Balance after last forecast year'),money(water.annual.at(-1)?.debtBalance??water.totalLoan)]
 ]:[
  [l('تكلفة الاستثمار النقدية','Cash investment costs'),money(base.capex)],
  [l('رأس المال العامل الأولي','Opening working capital'),money(study.workingCapital)],
  [l('إجمالي الاحتياج النقدي','Total cash requirement'),money(base.totalInvestment-base.landAsset)],
  [l('إجمالي رأس المال النقدي','Total cash equity'),money(base.cashEquity)],
  [l('قرض الممول إلى الشركة','Investor shareholder loan'),money(study.investorLoan)],
  [l('تمويل ديون أخرى','Other debt'),money(study.otherDebt)],
  [l('صافي فجوة التمويل النقدي','Net funding gap'),money(base.cashFundingGap)]
 ];
 const ownership=study.rawLand?[
  [l('طريقة تقديم الأرض','Land contribution method'),study.rawLand.site.landPaymentMethod==='in_kind'?l('حصة عينية','In kind'):l('شراء نقدي','Cash purchase')],
  [l('قيمة الأرض','Land value'),money(landResult?.land??null)],
  [l('حافز المطور','Developer incentive'),money(landResult?.developerIncentive??null)],
  [l('حافز المدير','Manager incentive'),money(landResult?.managerIncentive??null)]
 ]:water&&deal?[
  [l('معالجة الأرض','Land arrangement'),{
   transfer:l('نقل الملكية','Title transfer'),lease:l('إيجار','Lease'),right:l('حق انتفاع مقوّم','Valued right of use')
  }[deal.landMode]],
  [l('الحصة العينية للأرض أو الحق','Land or right-of-use in-kind contribution'),money(water.land)],
  [l('قيمة الرخصة للمراجعة','Licence value for review'),money(deal.licenseValue)],
  [l('رأس مال الممول النقدي','Investor cash equity'),money(water.investorEquity)],
  [l('إجمالي رأس المال الاقتصادي','Total economic equity'),money(water.totalEquity)],
  [l('الملكية الاقتصادية للممول','Investor economic ownership'),percent(water.investorShare)],
  [l('الملكية الاقتصادية لصاحب الأرض','Land partner economic ownership'),percent(water.partnerShare)]
 ]:[
  [l('رأس مال الممول النقدي','Investor cash equity'),money(study.investorEquity)],
  [l('مساهمة الشريك النقدية','Partner cash contribution'),money(study.partnerCashEquity)],
  [l('الحصة العينية للأرض','Land in-kind contribution'),money(base.landAsset)],
  [l('إجمالي رأس المال الاقتصادي','Total economic equity'),money(base.equity)],
  [l('الملكية الاقتصادية للممول','Investor economic ownership'),percent(base.investorShare)],
  [l('الملكية الاقتصادية للشريك','Partner economic ownership'),percent(base.partnerShare)]
 ];
 const ready=handoffReadiness(study);
 const readyCount=ready.checks.filter(check=>check.passed).length;
 const reviewedSource=study.handoff?.reviewedSourceUpdatedAt;
 const currentReview=ready.ready&&reviewedSource===study.updatedAt;
 const reviewState=currentReview
  ?l('مراجعة داخلية مسجّلة','Internal review recorded')
  :reviewedSource?l('تحتاج إعادة مراجعة','Review needs renewal'):l('لم تُسجّل مراجعة','Review not recorded');
 const readiness=new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:1}).format(readyCount/ready.checks.length);
 const npv=money(study.rawLand?landResult?.npv??null:water?water.ready?water.npv:null:base.npv);
 const irr=percent(study.rawLand?landResult?.irr??null:water?water.ready?water.irr:null:base.irr);
 const investment=money(study.rawLand?landResult?.totalCost??null:water?water.cashRequired+water.land:base.totalInvestment);
 const summaryMetrics:{label:string;value:string;icon:RoyalIconName}[]=[
  {label:l('إجمالي الاستثمار الاقتصادي','Economic investment'),value:investment,icon:'coins'},
  {label:'NPV',value:npv,icon:'chart'},
  {label:'IRR',value:irr,icon:'target'},
  {label:l('الجاهزية','Readiness'),value:readiness,icon:'check'}
 ];
 const reportMetrics=[['NPV',npv],['IRR',irr],[l('الجاهزية','Readiness'),readiness]];
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
  <section className="fs-block" id={sectionId('summary')} tabIndex={-1} data-report-section="summary">
   <h3 className="fs-royal-report-title"><RoyalIcon name="file"/>{l('التقرير الشامل','Feasibility report')}</h3>
   <div className="fs-kpis fs-royal-overview-kpis fs-royal-report-summary-kpis">
    {summaryMetrics.map(({label,value,icon})=><div className="fs-metric" key={label}>
     <RoyalIcon name={icon}/><small>{label}</small><strong><bdi>{value}</bdi></strong>
    </div>)}
   </div>
   <section className="card fs-panel">
    <h3 className="fs-royal-report-title"><RoyalIcon name="target"/>{l('ملخص تنفيذي وتوصية مشروطة','Executive summary and conditional recommendation')}</h3>
    <p className="fs-royal-report-notice"><RoyalIcon name="shield"/>{ready.ready
     ?l('استوفت الدراسة شروط الجاهزية الداخلية. راجع الافتراضات والمستندات قبل اعتماد القرار الاستثماري.',
        'The study passed the internal readiness checks. Verify assumptions and evidence before approving the investment.')
     :l('استكمل متطلبات الجاهزية المفتوحة وتحقق من الافتراضات والمستندات قبل الالتزام بالتمويل.',
        'Complete the open readiness checks and verify assumptions and evidence before committing funds.')}</p>
     {allowExport&&<div className="fs-actions fs-royal-report-output">
     <button className="fs-btn" type="button" onClick={()=>window.print()}>{l('طباعة / PDF','Print / PDF')}</button>
     <button className="fs-btn fs-btn--secondary" type="button" onClick={()=>dialog.current?.showModal()}>
      <RoyalIcon name="file"/>{l('خيارات تصدير التقرير','Report export options')}</button>
     <button className="fs-btn fs-btn--secondary" type="button" onClick={tasks}>{l('تصدير المهام CSV','Export tasks CSV')}</button>
    </div>}
   </section>
   <div className="fs-royal-profile-grid fs-royal-report-summary-details">
    <nav className="card fs-panel fs-royal-report-index" aria-labelledby={dialogTitleId+'-contents'}>
     <h3 id={dialogTitleId+'-contents'} className="fs-royal-report-title"><RoyalIcon name="clipboard"/>
      {l('الأقسام التي يشملها التقرير','Report contents')}
     </h3>
     <ul className="fs-royal-checks">{availableSections.map(section=><li key={section}>
      <a href={'#'+sectionId(section)}>{sectionLabels[section]}<RoyalIcon name="chevron"/></a>
     </li>)}</ul>
    </nav>
    <section className="card fs-panel fs-royal-report-detail">
     <h3 className="fs-royal-report-title"><RoyalIcon name="clipboard"/>{l('تنبيهات مهنية وإصدار التقرير','Professional notice and report issuance')}</h3>
     <p className="fs-royal-report-notice fs-royal-report-issuance"><RoyalIcon name="check"/>
      {l('تعكس النسخة الحالية مدخلات الدراسة. سجّل القرار في قسم القرارات بعد التحقق من الافتراضات والأدلة.',
       'This version reflects the study inputs. Record the decision in the Decisions section after verifying the assumptions and evidence.')}
     </p>
     <dl className="fs-royal-checks">{[
      [l('معدّ الدراسة','Prepared by'),study.preparedBy],
      [l('تاريخ الدراسة','Study date'),study.studyDate],
      [l('حالة مراجعة النسخة','Revision review status'),reviewState],
      [l('موقع المشروع','Project location'),[study.region,study.country].filter(Boolean).join(' · ')],
      [l('عملة الدراسة','Study currency'),study.currency],
     ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'—'}</dd></div>)}</dl>
    </section>
   </div>
   <section className="card fs-panel">
    <h3 className="fs-royal-report-title"><RoyalIcon name="check"/>{l('متطلبات مراجعة التقرير','Report review requirements')}</h3>
    <ul className="fs-royal-checks">{ready.checks.map(check=><li key={check.key}>
     <span>{locale==='ar'?check.ar:check.en}</span>
     <strong className="fs-royal-tag" data-complete={check.passed}>{check.passed?l('مكتمل','Complete'):l('يحتاج مراجعة','Review needed')}</strong>
    </li>)}</ul>
   </section>
  </section>
  {allowExport&&<dialog ref={dialog} className="fs-dialog fs-royal-dialog fs-royal-report-dialog" aria-labelledby={dialogTitleId}>
   <div className="fs-royal-heading"><h2 id={dialogTitleId}><RoyalIcon name="layers"/>{l('التقرير الاستثماري الشامل','Investment report export')}</h2>
    <button type="button" className="fs-royal-close" aria-label={l('إغلاق النافذة','Close dialog')} onClick={()=>dialog.current?.close()}>×</button></div>
   <div className="fs-royal-scenario-cards fs-royal-report-metrics">{reportMetrics.map(([label,value])=>
    <div className="fs-metric" key={label}><small>{label}</small><strong><bdi>{value}</bdi></strong></div>)}</div>
   <p className="fs-royal-report-notice"><RoyalIcon name="alert"/>{l('تحقّق من الافتراضات المالية والأدلة القانونية قبل اعتماد التقرير.','Verify the financial assumptions and legal evidence before approving the report.')}</p>
   <fieldset className="fs-study-scope fs-royal-report-sections">
    <legend>{l('الأقسام التي يشملها ملف PDF','Sections included in the PDF')}</legend>
    {availableSections.map(section=>{
     const labelId=dialogTitleId+'-'+section;
     const descriptionId=labelId+'-description';
     return <label className="fs-royal-report-option" key={section}>
      <strong id={labelId}>{sectionLabels[section]}</strong>
      <small id={descriptionId}>{sectionDescriptions[section]}</small>
      <span className="fs-royal-report-check">
       <input type="checkbox" aria-labelledby={labelId} aria-describedby={descriptionId} checked={sections.includes(section)} onChange={event=>{
        const checked=event.currentTarget.checked;
        setSections(current=>checked?[...current,section]:current.filter(item=>item!==section));
       }}/>
       <RoyalIcon name="check"/>
      </span>
     </label>;
    })}
   </fieldset>
   <div className="fs-actions fs-royal-report-footer">
    <button className="fs-btn fs-btn--secondary" type="button" onClick={()=>dialog.current?.close()}>
     <RoyalIcon name="chevron"/>{l('إغلاق','Close')}
    </button>
    <button className="fs-btn" type="button" disabled={!availableSections.some(section=>sections.includes(section))}
     onClick={printSelected}><RoyalIcon name="print"/>{l('طباعة / PDF','Print / PDF')}</button>
   </div>
  </dialog>}
  {study.rawLand?<div id={sectionId('finance')} tabIndex={-1} data-report-section="finance"><RawLandPanel model={study.rawLand} locale={locale} currency={study.currency} tab="report" allowExport={allowExport}/></div>:
   study.water?<div id={sectionId('finance')} tabIndex={-1} data-report-section="finance"><WaterModelPanel water={study.water} locale={locale} currency={study.currency} tab="report" allowExport={allowExport} onChange={()=>{}}/></div>:
   <section className="card fs-panel" id={sectionId('finance')} tabIndex={-1} data-report-section="finance">
    <h3>{l('الملخص والتوقعات المالية الأساسية','Base-case financial summary and projections')}</h3>
    <ul className="fs-notes">
     <li>{l('الاستثمار الاقتصادي','Economic investment')} · {money(base.totalInvestment)}</li>
     <li>{l('صافي القيمة الحالية','NPV')} · {money(base.npv)}</li>
     <li>{l('العائد الداخلي %','IRR %')} · {fmt(base.irr)}</li>
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
  <section className="card fs-panel fs-royal-report-detail" id={sectionId('funding')} tabIndex={-1} data-report-section="funding">
   <h3 className="fs-royal-report-title"><RoyalIcon name="coins"/>{sectionLabels.funding}</h3>
   <dl className="fs-royal-checks">{funding.map(([label,value])=><div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}</dl>
   {!!deal?.extraFunding&&<p className="fs-hint">{l('حدّد أوجه استخدام التمويل الإضافي قبل اعتماد الدراسة.',
    'Allocate the additional funding to specific uses before approving the study.')}</p>}
  </section>
  <section className="card fs-panel fs-royal-report-detail" id={sectionId('ownership')} tabIndex={-1} data-report-section="ownership">
   <h3 className="fs-royal-report-title"><RoyalIcon name="users"/>{sectionLabels.ownership}</h3>
   <dl className="fs-royal-checks">{ownership.map(([label,value])=><div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}</dl>
   {!!study.rawLand?.distribution?.partners.length&&<RawLandPanel model={study.rawLand} locale={locale}
    currency={study.currency} tab="distribution-report"/>}
   <p className="fs-hint">{l('هذه الحصص اقتصادية تقديرية. تُثبت الملكية القانونية بالمستندات والإجراءات المعتمدة.',
    'These are indicative economic shares. Legal ownership is established through the authorized documents and procedures.')}</p>
   {water&&<p className="fs-hint">{l('قيمة الرخصة للمراجعة وتُستثنى من الحصص الاقتصادية.',
    'The licence valuation is for review and is excluded from economic shares.')}</p>}
   {deal?.landMode==='lease'&&<p className="fs-hint">{l('وثّق حقوق المنشآت على الأرض المستأجرة في العقد.',
    'Document rights to improvements on the leased land in the agreement.')}</p>}
   {deal&&deal.landMode!=='lease'&&deal.leaseMonth>0&&<p className="fs-hint">{l('راجع احتمال الجمع بين إيجار الأرض والحصة العينية.',
    'Check for overlap between land rent and the in-kind contribution.')}</p>}
  </section>
  <section className="card fs-panel" id={sectionId('governance')} tabIndex={-1} data-report-section="governance">
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
  {study.decisions.length>0&&<section className="card fs-panel" id={sectionId('decisions')} tabIndex={-1} data-report-section="decisions">
   <h3 className="fs-royal-report-title"><RoyalIcon name="clipboard"/>{sectionLabels.decisions}</h3>
   <dl className="fs-royal-checks">{study.decisions.map(item=><div key={item.id}>
    <dt>{item.title}</dt><dd>{[item.date,item.owner,item.notes].filter(Boolean).join(' · ')||'—'}</dd>
   </div>)}</dl>
  </section>}
  {study.notes&&<section className="card fs-panel" id={sectionId('notes')} tabIndex={-1} data-report-section="notes"><h3>{l('ملاحظات الدراسة','Study notes')}</h3><p>{study.notes}</p></section>}

 </div>;
}
