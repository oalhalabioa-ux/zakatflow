'use client';
import {useId,useRef,useState} from 'react';
import {RoyalIcon,type RoyalIconName} from './RoyalIcon';
import type {FeasibilityStudy} from '@/lib/feasibility/engine';
import {evaluateGeneralForecast} from '@/lib/feasibility/advanced-model';
import {handoffReadiness} from '@/lib/feasibility/handoff';
import {evaluateRawLand} from '@/lib/feasibility/raw-land';
import RawLandPanel from './RawLandPanel';
import {evaluateWater,effectiveWaterInputs,studyReportReadiness,waterPeakFundingGap} from '@/lib/feasibility/water-model';
import {downloadFeasibilityCsv,generalForecastRows} from '@/lib/feasibility/report-export';
import {studyProfileValues,studyTypeLabels} from '@/lib/feasibility/study-profile';
import WaterModelPanel from './WaterModelPanel';
import PartnershipPanel from './PartnershipPanel';
import CostingReport from './CostingReport';
import {evaluateMonthlyLiquidity,liquidityMonthLabel,monthlyLiquidityAmounts} from '@/lib/feasibility/monthly-liquidity';

const exportSections = ['summary','finance','funding','ownership','governance','decisions','notes'] as const;
type ExportSection = typeof exportSections[number];
const sectionChecks:Partial<Record<ExportSection,readonly string[]>>={
 finance:['model','quantity','financial-policy','assumptions'],
 funding:['finance','financing-policy'],
 governance:['legal','blockers','risk','execution'],
 decisions:['decision']
};

export default function FeasibilityReport({study,locale,allowExport=true,titleInWorkspace=false}:{study:FeasibilityStudy;locale:string;allowExport?:boolean;titleInWorkspace?:boolean}){
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
 const profile=studyProfileValues(study);
 const verified=study.legal.filter(item=>item.status==='VERIFIED').length;
 const fmt=(value:number|null)=>value===null?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value);
 const money=(value:number|null)=>value===null?'—':[fmt(value),study.currency].filter(Boolean).join(' ');
 const percent=(value:number|null)=>value===null?'—':fmt(value)+'%';
 const forecast=evaluateGeneralForecast(study);
 const {model:base,advanced}=forecast;
 const land=study.rawLand?evaluateRawLand(study.rawLand):null;
 const landResult=land?.issue===null&&land.ready?land:null;
 const water=study.water?evaluateWater(study.water):null;
 const deal=study.water?effectiveWaterInputs(study.water).deal:undefined;
 const plan=study.monthlyLiquidity;
 const monthlyAmounts=plan&&monthlyLiquidityAmounts(study);
 const partnerScheduleReady=!plan?.usePartnerInstallments||Boolean(
  plan.startMonth&&study.partnership?.asOf&&study.partnership.partners.some(partner=>partner.installments?.length));
 const liquidity=plan&&monthlyAmounts&&partnerScheduleReady?evaluateMonthlyLiquidity(monthlyAmounts,plan,study.partnership):null;
 const funding=study.rawLand?[
  [l('التسهيل التمويلي','Financing facility'),money(study.rawLand.finance.facility)],
  [l('تكاليف التطوير النقدية','Cash development costs'),money(landResult?.cashDevelopmentCost??null)],
  [l('ذروة عجز التمويل بعد الدين','Peak funding gap after debt'),money(landResult?.peakEquityDeficit??null)],
  [l('التزام رأس المال النقدي','Committed cash equity'),money(study.rawLand.quantityDevelopment?.committedEquity??0)],
  [l('العجز غير المغطى بالالتزام النقدي','Deficit not covered by cash commitment'),money(landResult?Math.max(0,landResult.peakEquityDeficit-(study.rawLand.quantityDevelopment?.committedEquity??0)):null)],
  [l('رصيد الدين الختامي','Closing debt'),money(landResult?.annual.at(-1)?.closingDebt??null)],
  ...(landResult?.financeMetrics?.returns?[
   [l('صافي القيمة الحالية للمشروع قبل التمويل','Project NPV before financing'),money(landResult.financeMetrics.returns.unleveredNpv)],
   [l('عائد المشروع قبل التمويل','Project IRR before financing'),percent(landResult.financeMetrics.returns.unleveredIrr)],
   [l('عائد إجمالي حقوق الملكية الاقتصادية','Total economic equity IRR'),percent(landResult.financeMetrics.returns.equityIrr)]
  ]:[])
 ]:water&&study.water&&deal?[
  [l('تكلفة التأسيس مع الرسوم','Establishment costs including fees'),money(water.investment)],
  [l('رأس المال العامل الأولي','Opening working capital'),money(study.water.capex.workingCapital)],
  [l('شراء الأرض ورسوم الاستحواذ النقدية','Cash land purchase and acquisition fees'),money(water.purchaseLand??0)],
  [l('التمويل النقدي المطلوب عند التأسيس','Initial cash requirement'),money(water.cashRequired)],
  [l('ذروة العجز النقدي بعد التأسيس وخدمة الدين','Peak post-establishment cash shortfall after debt service'),
   money(water.ready&&deal.extraFunding===0&&deal.investorLoan<=water.cashRequired?waterPeakFundingGap(water.annual):null)],
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
  [l('تكلفة الاستثمار النقدية','Cash investment costs'),money(base.capex+base.landPurchase+(advanced?.contingency??0))],
  [l('رأس المال العامل الأولي','Opening working capital'),money(advanced?.openingWorkingCapital??study.workingCapital)],
  [l('إجمالي الاحتياج النقدي','Total cash requirement'),money(advanced?.cashNeed??base.cashInvestment)],
  [l('إجمالي رأس المال النقدي','Total cash equity'),money(base.cashEquity)],
  [l('قرض الممول إلى الشركة','Investor shareholder loan'),money(study.investorLoan)],
  [l('تمويل ديون أخرى','Other debt'),money(study.otherDebt)],
  [l('صافي فجوة التمويل النقدي','Net funding gap'),money(advanced?advanced.cashNeed-base.cashEquity-study.investorLoan-study.otherDebt:base.cashFundingGap)],
  ...(advanced?[
   [l('صافي القيمة الحالية لحقوق الملكية','Equity NPV'),money(advanced.equityNpv)],
   [l('العائد الداخلي لحقوق الملكية','Equity IRR'),percent(advanced.equityIrr)]
  ]:[])
 ];
 const ownership=study.rawLand?[
  [l('طريقة تقديم الأرض','Land contribution method'),study.rawLand.site.landPaymentMethod==='lease'?l('إيجار','Lease'):study.rawLand.site.landPaymentMethod==='in_kind'?l('حصة عينية','In kind'):l('شراء نقدي','Cash purchase')],
  [l('قيمة الأرض','Land value'),money(landResult?.land??null)],
  ...(study.rawLand.site.landPaymentMethod==='lease'?[[l('إيجار الأرض سنويًا','Annual land rent'),money(study.rawLand.site.annualLandRent??0)]]:[]),
  [l('حافز المطور','Developer incentive'),money(landResult?.developerIncentive??null)],
  [l('حافز المدير','Manager incentive'),money(landResult?.managerIncentive??null)]
 ]:water&&deal?[
  [l('معالجة الأرض','Land arrangement'),{
   transfer:l('نقل الملكية','Title transfer'),lease:l('إيجار','Lease'),right:l('حق انتفاع مقوّم','Valued right of use'),purchase:l('شراء نقدي','Cash purchase')
  }[deal.landMode]],
  [l('الحصة العينية للأرض أو الحق','Land or right-of-use in-kind contribution'),money(water.land)],
  [l('قيمة الرخصة للمراجعة','Licence value for review'),money(deal.licenseValue)],
  [l('رأس مال الممول النقدي','Investor cash equity'),money(water.investorEquity)],
  [l('إجمالي رأس المال الاقتصادي','Total economic equity'),money(water.totalEquity)],
  [l('الملكية الاقتصادية للممول','Investor economic ownership'),percent(water.investorShare)],
  [l('الملكية الاقتصادية لصاحب الأرض','Land partner economic ownership'),percent(water.partnerShare)]
 ]:[
  ...(study.landArrangement?.mode==='LEASE'?[[l('إيجار الأرض شهريًا','Monthly land rent'),money(study.landArrangement.monthlyRent)]]:[]),
  ...(study.landArrangement?.mode==='PURCHASE'?[[l('شراء الأرض ورسومها','Land purchase with fees'),money(base.landPurchase)]]:[]),
  [l('رأس مال الممول النقدي','Investor cash equity'),money(study.investorEquity)],
  [l('مساهمة الشريك النقدية','Partner cash contribution'),money(study.partnerCashEquity)],
  [l('الحصة العينية للأرض','Land in-kind contribution'),money(base.landAsset)],
  [l('إجمالي رأس المال الاقتصادي','Total economic equity'),money(base.equity)],
  [l('الملكية الاقتصادية للممول','Investor economic ownership'),percent(base.investorShare)],
  [l('الملكية الاقتصادية للشريك','Partner economic ownership'),percent(base.partnerShare)]
 ];
 const ready=handoffReadiness(study);
 const requirementsId=dialogTitleId+'-requirements';
 const openChecks=ready.checks.filter(check=>!check.passed);
 const completeChecks=ready.checks.filter(check=>check.passed);
 const reviewedSource=study.handoff?.reviewedSourceUpdatedAt;
 const currentReview=ready.ready&&reviewedSource===study.updatedAt;
 const reviewState=currentReview
  ?l('مراجعة داخلية مسجّلة','Internal review recorded')
  :reviewedSource?l('تحتاج إعادة مراجعة','Review needs renewal'):l('لم تُسجّل مراجعة','Review not recorded');
 const readiness=new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:1}).format(completeChecks.length/ready.checks.length);
 const npv=money(study.rawLand?landResult?.npv??null:water?water.ready?water.npv:null:advanced?advanced.projectNpv:base.npv);
 const irr=percent(study.rawLand?landResult?.irr??null:water?water.ready?water.irr:null:advanced?advanced.projectIrr:base.irr);
 const investment=money(study.rawLand?landResult?.totalCost??null:water?water.cashRequired+water.land:advanced?.initialInvestment??base.totalInvestment);
 const summaryMetrics:{label:string;value:string;icon:RoyalIconName}[]=[
  {label:l('إجمالي الاستثمار الاقتصادي','Economic investment'),value:investment,icon:'coins'},
  {label:'NPV',value:npv,icon:'chart'},
  {label:'IRR',value:irr,icon:'target'},
  {label:l('الجاهزية','Readiness'),value:readiness,icon:'check'}
 ];
 const reportMetrics=[['NPV',npv],['IRR',irr],[l('الجاهزية','Readiness'),readiness]];
 const metrics=[
  l('السنة','Year'),l('حجم المبيعات','Sales volume'),l('الإيرادات','Revenue'),l('المتغيرة','Variable costs'),
  l('الثابتة','Fixed costs'),'EBITDA',l('الضريبة','Tax'),l('الصيانة','Maintenance'),l('التدفق الحر','Free cash flow'),
  ...(advanced?[l('سداد أصل القرض','Principal'),l('الفائدة','Interest'),l('رصيد الدين الختامي','Closing debt'),
   l('تدفق حقوق الملكية','Equity cash flow')]:[])
 ];
 const financeRows=generalForecastRows(forecast);
 const tasks=()=>downloadFeasibilityCsv('feasibility-tasks.csv',[
  [l('المهمة','Task'),l('المجال','Phase'),l('الأولوية','Priority'),l('الحالة','Status'),l('المسؤول','Owner'),
   l('الموعد','Due'),l('الملاحظات','Notes')],
  ...study.tasks.map(x=>[x.title,x.phase,x.priority,x.status,x.owner,x.due,x.notes])
 ]);
 return <div ref={report} className="fs-block fs-print-report">
  <section className="fs-block" id={sectionId('summary')} tabIndex={-1} data-report-section="summary">
   <h3 className={titleInWorkspace?'fs-royal-report-title fs-report-print-title':'fs-royal-report-title'}><RoyalIcon name="file"/>{l('التقرير الاستثماري الشامل','Comprehensive investment report')}</h3>
   <div className="fs-kpis fs-royal-overview-kpis fs-royal-report-summary-kpis">
    {summaryMetrics.map(({label,value,icon})=><div className="fs-metric" key={label}>
     <RoyalIcon name={icon}/><small>{label}</small><strong><bdi>{value}</bdi></strong>
    </div>)}
   </div>
   <section className="card fs-panel fs-royal-report-recommendation">
    <h3 className="fs-royal-report-title"><RoyalIcon name="target"/>{l('ملخص تنفيذي وتوصية مشروطة','Executive summary and conditional recommendation')}</h3>
    <p className="fs-royal-report-notice"><RoyalIcon name="shield"/>{ready.ready
     ?l('استوفت الدراسة شروط الجاهزية الداخلية. راجع الافتراضات والمستندات قبل اعتماد القرار الاستثماري.',
        'The study passed the internal readiness checks. Verify assumptions and evidence before approving the investment.')
     :l('استكمل متطلبات الجاهزية المفتوحة وتحقق من الافتراضات والمستندات قبل الالتزام بالتمويل.',
        'Complete the open readiness checks and verify assumptions and evidence before committing funds.')}</p>
    {openChecks.length>0&&<a className="fs-report-requirements-link" href={'#'+requirementsId}>
     {l('راجع المتطلبات المفتوحة','Review open requirements')} <bdi>({fmt(openChecks.length)})</bdi>
    </a>}
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
     <ul className="fs-royal-checks">{availableSections.map(section=>{
      const checks=sectionChecks[section];
      const needsReview=checks&&openChecks.some(check=>checks.includes(check.key));
      const labelId=sectionId(section)+'-link';
      const statusId=labelId+'-status';
      return <li key={section}>
       <a href={'#'+sectionId(section)} aria-labelledby={labelId} aria-describedby={checks?statusId:undefined}>
        <span id={labelId}>{sectionLabels[section]}</span>
        {checks&&<span id={statusId} className="fs-royal-tag" data-complete={!needsReview}>
         {needsReview?l('تحتاج مراجعة','Review needed'):l('اكتملت الفحوص','Checks complete')}
        </span>}
        <RoyalIcon name="chevron"/>
       </a>
      </li>;
     })}</ul>
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
      [l('موقع المشروع','Project location'),[study.siteDescription,study.region,study.country].filter(Boolean).join(' · ')],
      [l('المالك القانوني المصرّح به','Declared legal owner'),study.legalOwner],
      [l('نوع الدراسة','Study type'),study.studyType?(locale==='ar'?studyTypeLabels[study.studyType].ar:studyTypeLabels[study.studyType].en):undefined],
      [l('سنة بدء الدراسة','Study start year'),profile.startYear===undefined?undefined:String(profile.startYear)],
      [l('مدة الدراسة المتوقعة (سنوات)','Expected study duration (years)'),fmt(profile.years)],
      [l(study.rawLand?'المساحة قبل الاستبعادات (م²)':'مساحة الأرض (م²)',study.rawLand?'Area before exclusions (m²)':'Land area (m²)'),fmt(profile.area)],
      [l('عملة الدراسة','Study currency'),study.currency],
     ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'—'}</dd></div>)}</dl>
     {!study.rawLand&&profile.startYear!==undefined&&<p className="fs-hint">{l(
      'سنة البدء وصف زمني. التدفقات محسوبة بسنوات نسبية من سنة صفر ولا يُطبّق تأخير أو خصم إضافي بسبب هذا الحقل.',
      'Start year is descriptive. Cash flows use relative years from year zero; this field does not add a deferral or extra discount.')}</p>}
    </section>
   </div>
   <section className="card fs-panel fs-report-requirements" id={requirementsId} tabIndex={-1}>
    <h3 className="fs-royal-report-title"><RoyalIcon name="check"/>{l('متطلبات مراجعة التقرير','Report review requirements')}</h3>
    <ul className="fs-royal-checks">{[...openChecks,...completeChecks].map(check=><li key={check.key}>
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
  {study.rawLand?<div id={sectionId('finance')} tabIndex={-1} data-report-section="finance"><RawLandPanel model={study.rawLand} locale={locale} currency={study.currency} tab="report" allowExport={allowExport}/><CostingReport study={study} locale={locale} allowExport={allowExport}/></div>:
   study.water?<div id={sectionId('finance')} tabIndex={-1} data-report-section="finance"><WaterModelPanel water={study.water} locale={locale} currency={study.currency} tab="report" allowExport={allowExport} onChange={()=>{}}/><CostingReport study={study} locale={locale} allowExport={allowExport}/></div>:
   <section className="card fs-panel" id={sectionId('finance')} tabIndex={-1} data-report-section="finance">
    <h3>{l('الملخص والتوقعات المالية الأساسية','Base-case financial summary and projections')}</h3>
    <ul className="fs-notes">
     <li>{l('الاستثمار الاقتصادي','Economic investment')} · {investment}</li>
     <li>{l('صافي القيمة الحالية للمشروع','Project NPV')} · {npv}</li>
     <li>{l('العائد الداخلي للمشروع','Project IRR')} · {irr}</li>
    </ul>
    {study.advanced&&<p className="fs-hint">{advanced
     ?l('التوقعات من السيناريو الأساسي للنموذج المالي المتقدم.','Projections use the advanced financial model’s base case.')
     :l('التوقعات من النموذج السنوي المبسط حتى تكتمل مدخلات النموذج المتقدم.','Projections use the simplified annual model until the advanced inputs are complete.')}</p>}
    {allowExport&&<div className="fs-actions"><button className="fs-btn fs-btn--secondary" type="button"
     onClick={()=>downloadFeasibilityCsv('feasibility-projections.csv',[
      [...metrics,l('العملة','Currency')],...financeRows.map(row=>[...row,study.currency])
     ],study.productionPlan?.enabled?metrics.map((_,index)=>index===0?'integer':index===1?'quantity':'money'):undefined
     )}>{l('تصدير التوقعات CSV','Export forecast CSV')}</button></div>}
    <div className="fs-table-wrap"><table className="fs-table">
     <thead><tr>{metrics.map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
     <tbody>{financeRows.map((row,index)=><tr key={index}>{row.map((value,i)=><td key={i}>{fmt(value)}</td>)}</tr>)}</tbody>
    </table></div>
   </section>}
  <section className="card fs-panel fs-royal-report-detail" id={sectionId('funding')} tabIndex={-1} data-report-section="funding">
   <h3 className="fs-royal-report-title"><RoyalIcon name="coins"/>{sectionLabels.funding}</h3>
   <dl className="fs-royal-checks">{funding.map(([label,value])=><div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}</dl>
   {liquidity&&<dl className="fs-royal-checks">
    <div><dt>{l('التمويل الإضافي لأول 12 شهرًا','Additional funding for the first 12 months')}</dt><dd><bdi>{money(liquidity.fundingGap)}</bdi></dd></div>
    <div><dt>{l('شهر أكبر عجز','Peak shortfall month')}</dt><dd><bdi>{liquidity.peakMonth===null?'—':liquidityMonthLabel(plan?.startMonth,liquidity.peakMonth,locale)}</bdi></dd></div>
   </dl>}
   {plan?.usePartnerInstallments&&!partnerScheduleReady&&<p className="fs-warning">{l(
    'أكمل تواريخ جدول دفعات الشركاء لعرض فجوة السيولة الشهرية.',
    'Complete the partner installment schedule dates to show the monthly funding gap.'
   )}</p>}
   {liquidity?.partnerFunding&&<p className="fs-hint">{l(
    'تعتمد السيولة الشهرية على تواريخ دفعات الشركاء. وتُستبعد المبالغ المتأخرة أو ناقصة التواريخ إلى حين مراجعتها.',
    'Monthly liquidity uses partner installment dates. Overdue or incomplete dates are excluded pending review.'
   )}</p>}
   {liquidity?.partnerFunding&&Math.abs(liquidity.partnerFunding.scheduledLoan-liquidity.partnerLoanDraw)>.005&&<p className="fs-warning">{l(
    'راجع أصل القروض والفوائد. مبلغ قروض الشركاء المجدول يختلف عن افتراض النموذج المالي.',
    'Review principal and interest because scheduled partner loans differ from the financial model.'
   )}</p>}
   {liquidity&&monthlyAmounts?.general&&<p className="fs-hint">
    {monthlyAmounts.general.basis==='advanced'?
     l('السيولة الشهرية محسوبة من السيناريو الأساسي للنموذج المالي المتقدم.','Monthly liquidity uses the advanced financial model’s base scenario.'):
     l('السيولة الشهرية محسوبة من السيناريو الأساسي للنموذج السنوي المبسط.','Monthly liquidity uses the simplified annual model’s base scenario.')}
    {monthlyAmounts.general.basis==='simple'&&monthlyAmounts.debtDraw>0&&' '+l(
     'أصل القرض والفائدة يتطلبان استكمال النموذج المالي المتقدم.','Complete the advanced financial model to include principal and interest.')}
   </p>}
   {(water||landResult?.financeMetrics?.returns)&&<p className="fs-hint">{water?
    l('يُحسب عجز النموذج السنوي من أرصدة نهاية السنوات مع الاحتفاظ بالفوائض.','The annual model measures its shortfall from year-end balances and assumes surpluses are retained.'):
    l('العائد قبل التمويل يستبعد الفائدة وعمولة ترتيب القرض. عائد الملكية الإجمالي يشمل الأرض العينية بقيمتها في سنة صفر إن وُجدت.',
     'The pre-financing return excludes loan interest and arrangement fees. Total equity return includes any in-kind land at its year-zero value.')}</p>}
   {!!deal?.extraFunding&&<p className="fs-hint">{l('حدّد أوجه استخدام التمويل الإضافي قبل اعتماد الدراسة.',
    'Allocate the additional funding to specific uses before approving the study.')}</p>}
  </section>
  <section className="card fs-panel fs-royal-report-detail" id={sectionId('ownership')} tabIndex={-1} data-report-section="ownership">
   <h3 className="fs-royal-report-title"><RoyalIcon name="users"/>{sectionLabels.ownership}</h3>
   <dl className="fs-royal-checks">{ownership.map(([label,value])=><div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}</dl>
   <PartnershipPanel study={study} locale={locale}/>
   {!!study.rawLand?.distribution?.partners.length&&<RawLandPanel model={study.rawLand} locale={locale}
    currency={study.currency} tab="distribution-report"/>}
   <p className="fs-hint">{l('هذه الحصص اقتصادية تقديرية. تُثبت الملكية القانونية بالمستندات والإجراءات المعتمدة.',
    'These are indicative economic shares. Legal ownership is established through the authorized documents and procedures.')}</p>
   {water&&<p className="fs-hint">{l('قيمة الرخصة للمراجعة وتُستثنى من الحصص الاقتصادية.',
    'The licence valuation is for review and is excluded from economic shares.')}</p>}
   {deal?.landMode==='lease'&&<p className="fs-hint">{l('وثّق حقوق المنشآت على الأرض المستأجرة في العقد.',
    'Document rights to improvements on the leased land in the agreement.')}</p>}
   {deal&&deal.landMode!=='lease'&&deal.leaseMonth>0&&<p className="fs-hint">{deal.landMode==='purchase'
    ?l('استُبعد إيجار الأرض المحفوظ من توقعات الشراء.','The saved land rent is excluded from the purchase forecast.')
    :l('راجع احتمال الجمع بين إيجار الأرض والحصة العينية.',
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
