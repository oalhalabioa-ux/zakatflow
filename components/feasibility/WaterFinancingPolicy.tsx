'use client';
import {defaultWaterFinancingPolicy} from '@/lib/feasibility/water-financing';
import {evaluateWater,type WaterModel} from '@/lib/feasibility/water-model';
import {RoyalIcon} from './RoyalIcon';

export default function WaterFinancingPolicy({water,locale,onChange}:{water:WaterModel;locale:string;onChange?:(m:WaterModel)=>void}){
 const l=(ar:string,en:string)=>locale==='ar'?ar:en,p=water.financingPolicy;
 const result=evaluateWater(water),equity=result.equity;
 const patch=(value:Partial<NonNullable<typeof p>>)=>onChange?.({...water,financingPolicy:{...(p??defaultWaterFinancingPolicy()),...value}});
 const issues:Record<string,readonly [string,string]>={
  UNALLOCATED_FUNDING:['خصص التمويل الإضافي قبل احتساب عائد الملكية','Allocate additional financing before calculating equity returns'],
  EXCESS_LOAN:['قرض المساهم يتجاوز النقد المطلوب للتأسيس','Shareholder loan exceeds inception cash requirements'],
  NO_EQUITY:['التمويل بالدين بالكامل لا يحدد ملكية موجبة لتوزيع العوائد؛ أكمل هيكل المساهمة','All-debt funding provides no positive equity ownership basis; complete the contribution structure'],
  LOAN_TERM:['أكمل مدة السداد وسنة أول قسط','Enter repayment term and first principal-payment year'],
  RESIDUAL_DEBT:['يتبقى دين بعد نهاية التوقعات؛ مدّد الأفق أو اختر سداد الرصيد عند النهاية لإظهار IRR الملكية','Debt remains beyond the forecast: extend the horizon or select terminal settlement to show equity IRR'],
  DEBT_EVIDENCE:['وثّق شروط القرض ومعالجة الفائدة والضرائب','Document loan terms, interest and tax assumptions'],
 };
 const grace=p?.graceInterest==='CAPITALIZE'?l('تضاف إلى رصيد القرض','Capitalized into loan balance'):p?.graceInterest==='PAY'?l('تدفع سنويًا','Paid annually'):l('معفاة وفق المنهج المرجعي','Waived under reference convention');
 return <section className="card fs-panel fs-water-financing">
  <h3 className="fs-royal-report-title"><RoyalIcon name="coins"/>{l('التمويل وعوائد حقوق الملكية','Financing and equity returns')}</h3>
  {onChange&&<label className="fs-check"><input type="checkbox" checked={Boolean(p)} onChange={event=>{
   if(event.target.checked)onChange({...water,financingPolicy:defaultWaterFinancingPolicy()});
   else{const {financingPolicy,...legacy}=water;void financingPolicy;onChange(legacy);}
  }}/>{l('استخدام سياسة تمويل وعوائد صريحة','Use explicit financing and equity returns')}</label>}
  {p?<>
   {onChange?<div className="fs-form-grid">
    <label className="fs-field"><span>{l('فائدة فترة السماح','Grace-period interest')}</span><select value={p.graceInterest} onChange={e=>patch({graceInterest:e.target.value as typeof p.graceInterest})}>
     <option value="PAY">{l('تدفع سنويًا','Paid annually')}</option><option value="CAPITALIZE">{l('تضاف إلى رصيد القرض','Capitalized into loan balance')}</option><option value="LEGACY_WAIVED">{l('معفاة وفق المنهج المرجعي','Waived under reference convention')}</option>
    </select></label>
    <label className="fs-field"><span>{l('الأثر الضريبي للفائدة المدفوعة','Paid-interest tax treatment')}</span><select value={p.interestTaxMode} onChange={e=>patch({interestTaxMode:e.target.value as typeof p.interestTaxMode})}>
     <option value="NONE">{l('دون وفر ضريبي مفترض','No assumed tax deduction')}</option><option value="PAID">{l('خصم تقديري في حدود EBIT الموجب','Indicative deduction limited to positive EBIT')}</option>
    </select></label>
    <label className="fs-field"><span>{l('الدين المتبقي عند نهاية التوقعات','Debt remaining at forecast end')}</span><select value={p.terminalDebt} onChange={e=>patch({terminalDebt:e.target.value as typeof p.terminalDebt})}>
     <option value="CARRY">{l('إبقاء الرصيد ظاهرًا وحجب IRR الملكية','Carry balance and withhold equity IRR')}</option><option value="SETTLE">{l('سداد كامل الرصيد في السنة الأخيرة','Repay full balance in final year')}</option>
    </select></label>
    <label className="fs-field"><span>{l('مصدر شروط التمويل','Financing terms evidence')}</span><textarea maxLength={3000} value={p.evidence} onChange={e=>patch({evidence:e.target.value})}/></label>
   </div>:<dl className="fs-royal-checks">
    <div><dt>{l('فائدة السماح','Grace interest')}</dt><dd>{grace}</dd></div>
    <div><dt>{l('الدين عند النهاية','Terminal debt')}</dt><dd>{p.terminalDebt==='SETTLE'?l('سداد كامل الرصيد','Full settlement'):l('إبقاء الرصيد','Carry balance')}</dd></div>
    <div><dt>{l('خصم الفائدة الضريبي','Interest tax deduction')}</dt><dd>{p.interestTaxMode==='PAID'?l('تقديري محدود بالربح الموجب','Indicative, capped at positive EBIT'):l('غير مفترض','Not assumed')}</dd></div>
    <div><dt>{l('مصدر الشروط','Terms evidence')}</dt><dd>{p.evidence||l('غير موثق','Not documented')}</dd></div>
   </dl>}
   <p className="fs-hint">{l('السحب كامل عند التأسيس، والفائدة سنوية على الرصيد الافتتاحي. مدة القرض هي عدد أقساط الأصل بعد السماح؛ عند رسملة الفائدة يُقسم الرصيد الجديد على المدة. لا يُفترض خصم ضريبي للفائدة المرسملة أو ترحيل خسائر. سداد النهاية يدخل خدمة الدين، ويستبعد DSCR حصيلة بيع الأصول والتصفية.','Debt is fully drawn at inception, with annual interest on opening balance. The loan term counts principal instalments after grace; capitalized interest is amortized over that term. No deduction for capitalized interest or loss carryforward is assumed. Terminal debt settlement enters debt service; DSCR excludes asset-sale and liquidation proceeds.')}</p>
   <p className="fs-hint">{l('عائد الملكية لجميع الشركاء بعد خدمة الدين، وتدخل الأرض العينية في مساهمة التأسيس. يفترض توزيع كامل النقد المتاح وتمويل العجز بنسبة الملكية الثابتة. متحصلات قرض المساهم ليست توزيعات ملكية؛ عائد الممول المجمع يشمل قرضه بصورة منفصلة. لا يمثل الجدول قرار توزيع أو جدول سداد شهريًا.','Equity returns cover all equity holders after debt service and include in-kind land at inception. All available cash is assumed distributed and deficits funded at fixed ownership shares. Shareholder-loan receipts are separate from equity distributions; combined investor returns include that loan separately. This is not a dividend decision or monthly repayment schedule.')}</p>
   {equity&&!equity.conventional&&<p role="alert">{l('لا يظهر IRR الملكية لتدفقات دون مساهمة تأسيس موجبة أو ذات تغيرات إشارة متعددة؛ راجع جدول التدفقات.','Equity IRR is unavailable without positive initial equity or for multiple sign changes; review the cash-flow schedule.')}</p>}
   {!result.financingReadiness?.ready&&<ul role="alert">{result.financingReadiness?.issues.map(code=><li key={code}>{issues[code]?l(...issues[code]):code}</li>)}</ul>}
  </>:<p className="fs-hint">{l('الحسابات المرجعية المحفوظة مستمرة دون فوائد قبل أول قسط. فعّل السياسة صراحة لتحديد معاملة فترة السماح وإظهار عوائد الملكية؛ لن يتغير أي مدخل قرض تلقائيًا.','Saved reference calculations retain no interest before the first instalment. Explicitly enable the policy to define grace treatment and expose equity returns; loan inputs are retained.')}</p>}
 </section>;
}
