'use client';
import type {AdvancedAssumptions,CapitalCategory,FeasibilityStudy,Scenario} from '@/lib/feasibility/engine';
import {categories,emptyAdvanced,evaluateAdvanced,illustratedLives} from '@/lib/feasibility/advanced-model';
import {sectorTemplates} from '@/lib/feasibility/sector-templates';

const categoryNames:Record<CapitalCategory,[string,string]>={
 BUILDINGS:['المباني','Buildings'],EQUIPMENT:['المعدات','Equipment'],UTILITIES:['المرافق','Utilities'],
 LICENCES:['التراخيص','Licences'],OTHER:['الأصول الأخرى','Other capital assets']
};
const issueNames:Record<string,[string,string]>={
 INVALID_ASSUMPTIONS:['تحقق من سلامة الأرقام والمعدلات.','Check the input values and rates.'],
 CAPACITY_INCOMPLETE:['أدخل الطاقة والاستغلال والإنتاج الصالح للبيع.','Enter capacity, utilization and saleable yield.'],
 BASIC_INPUT_MISSING:['أدخل التكاليف الاستثمارية والسعر والحجم.','Enter CAPEX, price and sales volume.'],
 USEFUL_LIVES_MISSING:['يجب تحديد العمر المفيد للفئات الرأسمالية ذات المبالغ.','Enter useful lives for funded CAPEX categories.'],
 DEBT_TERM_MISSING:['أدخل مدة سداد الدين.','Enter loan repayment term.'],
 DEBT_EXCEEDS_HORIZON:['مدة القرض أكبر من فترة الدراسة.','Debt term exceeds forecast horizon.'],
 DEBT_OVERFUNDED:['القروض أعلى من احتياجات النقد الأولية.','Loans exceed initial cash requirements.'],
 NONFINITE_PROJECTION:['الأرقام الناتجة غير صالحة؛ راجع الافتراضات.','Projection produces invalid values.'],
 FUNDING_GAP:['نقص تمويل نقدي؛ عائد المساهمين غير متاح.','Funding gap: equity returns are withheld.'],
 UNMODELED_SURPLUS:['هناك فائض تمويل غير نمذجته الدراسة.','Funding surplus is not modeled.'],
 LAND_VALUE_REQUIRED:['الأرض المنقولة يجب أن تكون ذات قيمة مقدرة موجبة.','Transferred land requires a positive appraised value.'],
 EQUITY_UNFUNDED:['لا توجد مساهمة اقتصادية موجبة لحقوق الملكية.','No positive equity contribution exists.']
};
function Numeric({label,value,set,max=1000000000000,step='any'}:{
 label:string;value:number;set:(v:number)=>void;max?:number;step?:string
}){
 return <label className="fs-field"><span>{label}</span><input type="number" min="0" max={max} step={step} value={value}
  onChange={e=>{const v=e.currentTarget.valueAsNumber;if(Number.isFinite(v))set(Math.max(0,Math.min(max,v)));else if(e.currentTarget.value==='')set(0)}}/></label>;
}
export default function AdvancedModelPanel({study,scenario,locale,onChange}:{
 study:FeasibilityStudy;scenario:Scenario;locale:string;onChange:(x:AdvancedAssumptions)=>void
}){
 const ar=locale==='ar',t=(a:string,b:string)=>ar?a:b;
 const a=study.advanced??emptyAdvanced(),result=evaluateAdvanced(study,scenario),sector=sectorTemplates[study.sector];
 const update=(p:Partial<AdvancedAssumptions>)=>onChange({...a,...p});
 const money=(n:number|null)=>n===null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n)+' '+study.currency;
 const percent=(n:number|null)=>n===null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n)+'%';
 return <section className="card fs-panel">
  <h3>{t('النموذج المالي المتقدم — استرشادي','Advanced feasibility model — indicative')}</h3>
  <p className="fs-hint">{t('مستقل عن القيود والأرصدة الفعلية. النموذج الأساسي يبقى دون تغيير، ولا تظهر نتائج هذه الصفحة قبل إدخال الافتراضات الضرورية.', 'Separate from accounting ledgers. The basic model is unchanged; incomplete assumptions do not produce advanced returns.')}</p>
  <div className="fs-form-grid">
   <label className="fs-field"><span>{t('طريقة احتساب المبيعات','Volume method')}</span>
    <select value={a.mode} onChange={e=>update({mode:e.currentTarget.value as AdvancedAssumptions['mode']})}>
     <option value="DIRECT">{t('الوحدات المباعة المسجلة','Existing sales units')}</option>
     <option value="CAPACITY">{t('الطاقة × الاستغلال × الصالح للبيع','Capacity × utilization × yield')}</option>
    </select>
   </label>
   {a.mode==='CAPACITY'&&<>
    <Numeric label={ar?sector.capacityAr:sector.capacityEn} value={a.capacityMonthly} set={v=>update({capacityMonthly:v})}/>
    <Numeric label={t('استغلال الطاقة %','Utilization %')} value={a.utilisationPct} max={100} set={v=>update({utilisationPct:v})}/>
    <Numeric label={ar?sector.yieldAr:sector.yieldEn} value={a.saleablePct} max={100} set={v=>update({saleablePct:v})}/>
   </>}
  </div>
  <p className="fs-hint">{ar?sector.warningAr:sector.warningEn}</p>
  <h3>{t('الإهلاك والاسترداد','Depreciation and terminal recovery')}</h3>
  <p className="fs-hint">{t('العمر صفر يعني غير محدد. الأعمار المقترحة ليست معدلات ضريبية معتمدة.', 'Zero life means unspecified. Suggested lives are not statutory tax rates.')}</p>
  <div className="fs-form-grid">
   {categories.map(category=><Numeric key={category} label={t(...categoryNames[category])+' — '+t('سنوات','years')}
    value={a.lives[category]} max={60} step="1" set={v=>update({lives:{...a.lives,[category]:Math.trunc(v)}})}/>)}
   <Numeric label={t('القيمة النقدية المستردة في نهاية الدراسة','Terminal cash recovery')} value={a.terminalCash} set={v=>update({terminalCash:v})}/>
  </div>
  <button className="fs-btn fs-btn--secondary" type="button" onClick={()=>{
   if(window.confirm(t('هذه أعمار مفيدة استرشادية تحتاج مراجعة. تطبيقها؟','Illustrative useful lives require review. Apply?')))
    update({lives:{...illustratedLives}});
  }}>{t('تعبئة أعمار مقترحة','Fill illustrative useful lives')}</button>
  <h3>{t('خدمة الدين','Debt service')}</h3>
  <div className="fs-form-grid">
   <Numeric label={t('فائدة سنوية على الرصيد %','Annual outstanding loan interest %')} value={a.debtRatePct} max={100} set={v=>update({debtRatePct:v})}/>
   <Numeric label={t('مدة السداد بأقساط أصل متساوية (سنة)','Equal-principal repayment years')} value={a.debtYears} max={20} step="1" set={v=>update({debtYears:Math.trunc(v)})}/>
  </div>
  <h3>{t('نتائج نموذج الدراسة المتقدم','Advanced study results')}</h3>
  {!result.ready&&<p className="fs-hint">{t('النتائج محجوبة حتى اكتمال المتطلبات.','Indicators are withheld until essential inputs are completed.')}</p>}
  {[...result.blockers,...result.equityBlockers].map(code=><p key={code} className="fs-handoff-note">{ar?issueNames[code]?.[0]??code:issueNames[code]?.[1]??code}</p>)}
  {result.ready&&<>
   <div className="fs-kpis">
    <div className="fs-metric"><small>{t('NPV المشروع','Project NPV')}</small><strong dir="ltr">{money(result.projectNpv)}</strong></div>
    <div className="fs-metric"><small>{t('IRR المشروع','Project IRR')}</small><strong dir="ltr">{percent(result.projectIrr)}</strong></div>
    <div className="fs-metric"><small>{t('NPV المساهمين','Equity NPV')}</small><strong dir="ltr">{money(result.equityNpv)}</strong></div>
    <div className="fs-metric"><small>{t('IRR المساهمين','Equity IRR')}</small><strong dir="ltr">{percent(result.equityIrr)}</strong></div>
   </div>
   <div className="fs-table-wrap"><table className="fs-table"><thead><tr>
    <th>{t('سنة','Year')}</th><th>{t('إيرادات','Revenue')}</th><th>EBITDA</th>
    <th>{t('إهلاك','Depreciation')}</th><th>EBIT</th><th>{t('ضريبة تقديرية','Indicative tax')}</th>
    <th>{t('تدفق المشروع','Project FCF')}</th><th>{t('أصل القرض','Principal')}</th>
    <th>{t('الفائدة','Interest')}</th><th>{t('تدفق الملكية','Equity FCF')}</th><th>DSCR</th>
   </tr></thead><tbody><tr><td>0</td><td colSpan={5}>{t('الاستثمار الاقتصادي الأولي','Initial economic investment')}</td>
    <td>{money(-result.initialInvestment)}</td><td>—</td><td>—</td><td>{result.equityReady?money(result.equityFlows[0]):'—'}</td><td>—</td></tr>
    {result.annual.map(y=><tr key={y.year}><td>{y.year}</td><td>{money(y.revenue)}</td>
     <td>{money(y.ebitda)}</td><td>{money(y.depreciation)}</td><td>{money(y.ebit)}</td><td>{money(y.tax)}</td>
     <td>{money(y.fcf)}</td><td>{money(y.principal)}</td><td>{money(y.interest)}</td>
     <td>{result.equityReady?money(y.equityFcf):'—'}</td><td>{y.dscr===null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(y.dscr)}</td></tr>)}
   </tbody></table></div>
   <p className="fs-hint">{t('الضريبة تقديرية على EBIT وليست نظامية؛ لا تشمل ترحيل الخسائر أو خصم الفوائد. تحرير رأس المال العامل والاسترداد النهائي في السنة الأخيرة. لا يتم إنشاء أي قيد في Financial Core.', 'Tax on EBIT is indicative, excluding loss carryforwards and interest tax shield. Terminal year releases working capital and estimated recovery. No Financial Core postings.')}</p>
  </>}
 </section>;
}
