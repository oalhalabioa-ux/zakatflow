'use client';

import type {FeasibilityStudy} from '@/lib/feasibility/engine';
import {generalLandCosts,partnerPaidAmounts,summarizePartnership,type LandArrangement,type Partner,type Partnership} from '@/lib/feasibility/partnership';
import PartnerInstallments from './PartnerInstallments';
import {evaluateRawLand} from '@/lib/feasibility/raw-land';
import {evaluateWater} from '@/lib/feasibility/water-model';

const modes:LandArrangement['mode'][]=['LEASE','IN_KIND','PURCHASE'];
function createLandArrangement(mode:LandArrangement['mode'],valuation:number):LandArrangement{
 switch(mode){
  case 'LEASE':return {mode,monthlyRent:0};
  case 'IN_KIND':return {mode,valuation};
  case 'PURCHASE':return {mode,price:0,fees:0};
 }
}

export function GeneralLandPanel({study,locale,onChange}:{study:FeasibilityStudy;locale:string;onChange:(value:LandArrangement)=>void}){
 const l=(ar:string,en:string)=>locale.startsWith('ar')?ar:en;
 const arrangement=study.landArrangement??(study.landTransferred?{mode:'IN_KIND' as const,valuation:study.landValue}:undefined);
 const labels={LEASE:l('إيجار','Lease'),IN_KIND:l('تقديم عيني من أحد الشركاء','In-kind contribution by a partner'),PURCHASE:l('شراء الأرض','Land purchase')};
 const amount=(label:string,value:number,update:(value:number)=>void)=><label className="fs-field"><span>{label}</span>
  <input type="number" min={0} max={1e12} step="any" value={value} onChange={event=>{
   const value=Number(event.currentTarget.value);
   if(Number.isFinite(value)&&value>=0&&value<=1e12)update(value);
  }}/></label>;
 return <section className="card fs-panel">
  <h3>{l('معالجة الأرض','Land arrangement')}</h3>
  <div className="fs-form-grid">
   <label className="fs-field"><span>{l('طريقة الحصول على الأرض','How the land is secured')}</span>
    <select value={arrangement?.mode??''} onChange={event=>{
     const mode=modes.find(mode=>mode===event.currentTarget.value);
     if(mode)onChange(createLandArrangement(mode,study.landValue));
    }}>
     <option value="" disabled>{l('اختر عند انطباقه','Select if applicable')}</option>
     {modes.map(mode=><option key={mode} value={mode}>{labels[mode]}</option>)}
    </select>
   </label>
   {arrangement?.mode==='LEASE'&&amount(l('الإيجار الشهري','Monthly rent'),arrangement.monthlyRent,monthlyRent=>onChange({...arrangement,monthlyRent}))}
   {arrangement?.mode==='IN_KIND'&&amount(l('قيمة الأرض العينية','In-kind land value'),arrangement.valuation,valuation=>onChange({...arrangement,valuation}))}
   {arrangement?.mode==='PURCHASE'&&amount(l('سعر الشراء','Purchase price'),arrangement.price,price=>onChange({...arrangement,price}))}
   {arrangement?.mode==='PURCHASE'&&amount(l('رسوم الاستحواذ','Acquisition fees'),arrangement.fees,fees=>onChange({...arrangement,fees}))}
  </div>
  {arrangement&&<p className="fs-hint">{{
   LEASE:l('يُضاف الإيجار إلى تكاليف التشغيل. سجّل المصروف هنا مرة واحدة.','Rent is included in operating expenses. Enter it here once.'),
   IN_KIND:l('تُحتسب الأرض بقيمتها المقدّرة ضمن المساهمات العينية. حدّد الشريك مقدّم الأرض في السجل أدناه.','The land valuation is included in in-kind contributions. Select the contributing partner in the register below.'),
   PURCHASE:l('يُضاف السعر والرسوم إلى الاستثمار النقدي. سجّل الشراء هنا مرة واحدة.','The price and fees are included in cash investment. Enter them here once.')
  }[arrangement.mode]}</p>}
 </section>;
}

function contributedLand(study:FeasibilityStudy):number{
 if(study.rawLand){
  if(study.rawLand.site.landPaymentMethod!=='in_kind')return 0;
  const land=evaluateRawLand(study.rawLand);
  return land.issue?0:land.land;
 }
 if(study.water)return evaluateWater(study.water).land;
 return generalLandCosts(study).inKind;
}

const numericFields=['ownershipPct','profitPct','cashCommitted','cashPaid','loanPaid'] as const;

export default function PartnershipPanel({study,locale,onChange}:{study:FeasibilityStudy;locale:string;onChange?:(value:Partnership)=>void}){
 const l=(ar:string,en:string)=>locale.startsWith('ar')?ar:en;
 const registry=study.partnership??{partners:[]};
 const {partners,landPartnerId}=registry;
 if(!onChange&&!partners.length)return null;
 const land=contributedLand(study);
 const totals=summarizePartnership(registry);
 const number=new Intl.NumberFormat(locale,{maximumFractionDigits:4});
 const money=(value:number)=>[number.format(value),study.currency].filter(Boolean).join(' ');
 const percent=(value:number)=>number.format(value)+'%';
 const labels={
  ownershipPct:l('الملكية %','Ownership %'),profitPct:l('الأرباح %','Profit %'),
  cashCommitted:l('رأس المال النقدي المتعهد به','Committed cash equity'),
  cashPaid:l('رأس المال المدفوع فعليًا','Paid-in cash equity'),loanPaid:l('قرض الشريك المصروف','Partner loan disbursed')
 };
 const issues=[
  !totals.ownershipBalanced&&l('مجموع نسب الملكية يجب أن يساوي 100%.','Ownership shares must total 100%.'),
  !totals.profitBalanced&&l('مجموع نسب الأرباح يجب أن يساوي 100%.','Profit shares must total 100%.'),
  partners.some(partner=>!partner.name.trim())&&l('أدخل اسم كل شريك.','Enter every partner name.'),
  partners.some(partner=>partnerPaidAmounts(partner,registry.asOf).cashPaid>partner.cashCommitted)&&l('تجاوز بعض المدفوعات مبلغ الالتزام. راجع الاتفاق والمبالغ.','Some paid capital exceeds the commitment. Review the agreed and paid amounts.'),
  land>0&&!landPartnerId&&l('حدّد الشريك الذي قدّم الأرض العينية.','Select the partner who contributed the land.')
 ].filter(Boolean);
 return <section className="card fs-panel fs-monthly-liquidity">
  <h3>{l('سجل الشركاء والمبالغ المدفوعة','Partner register and payments')}</h3>
  {onChange&&<p className="fs-hint">{l(
   'سجّل النسب حسب الاتفاق والمدفوعات الفعلية حتى تاريخ المراجعة. إذا أضفت دفعات لشريك، تُحتسب مدفوعاته من الدفعات. يُفعّل الربط من جدول السيولة الشهرية.',
   'Record agreed shares and payments made as of the review date. Installments replace the manual paid totals for that partner. Enable the link from the monthly liquidity schedule.'
  )}</p>}
  {onChange?<label className="fs-field">
   <span>{l('تاريخ حصر المدفوعات','Payments as of')}</span>
   <input type="date" value={registry.asOf??''} onChange={event=>onChange({...registry,asOf:event.currentTarget.value||undefined})}/>
  </label>:registry.asOf&&<p>{l('تاريخ حصر المدفوعات','Payments as of')} <time dateTime={registry.asOf}>{registry.asOf}</time></p>}
  {onChange&&land>0&&partners.length>0&&<label className="fs-field">
   <span>{l('الشريك مقدّم الأرض العينية','Partner contributing the land')}</span>
   <select value={landPartnerId??''} onChange={event=>onChange({...registry,landPartnerId:event.currentTarget.value||undefined})}>
    <option value="">{l('اختر الشريك','Select partner')}</option>
    {partners.map((partner,index)=><option key={partner.id} value={partner.id}>{partner.name||l('الشريك','Partner')+' '+(index+1)}</option>)}
   </select>
  </label>}
  {onChange&&partners.map((partner,index)=>{
   const paid=partnerPaidAmounts(partner,registry.asOf);
   const update=(patch:Partial<Partner>)=>onChange({...registry,partners:partners.map(item=>item.id===partner.id?{...item,...patch}:item)});
   return <fieldset key={partner.id} className="fs-panel">
    <legend>{l('الشريك','Partner')} {index+1}</legend>
    <div className="fs-form-grid">
     <label className="fs-field"><span>{l('اسم الشريك','Partner name')}</span>
      <input value={partner.name} maxLength={300} onChange={event=>update({name:event.currentTarget.value})}/></label>
     {numericFields.map(key=>{
      const max=key.endsWith('Pct')?100:1e12;
      return <label key={key} className="fs-field"><span>{labels[key]}</span>
       <input type="number" min={0} max={max} step="any" value={key==='cashPaid'||key==='loanPaid'?paid[key]:partner[key]}
        disabled={Boolean(partner.installments?.length)&&(key==='cashPaid'||key==='loanPaid')} onChange={event=>{
        const value=Number(event.currentTarget.value);
        if(Number.isFinite(value)&&value>=0&&value<=max)update({[key]:value});
       }}/>
      </label>;
     })}
    </div>
    <PartnerInstallments locale={locale} rows={partner.installments??[]} onChange={installments=>update({installments})}/>
    <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>onChange({
     ...registry,partners:partners.filter(item=>item.id!==partner.id),landPartnerId:landPartnerId===partner.id?undefined:landPartnerId
    })}>{l('إزالة الشريك','Remove partner')}</button>
   </fieldset>;
  })}
  {onChange&&<button type="button" className="fs-btn fs-btn--secondary" disabled={partners.length>=50}
   onClick={()=>onChange({...registry,partners:[...partners,{id:crypto.randomUUID(),name:'',ownershipPct:0,profitPct:0,cashCommitted:0,cashPaid:0,loanPaid:0}]})}>
   {l('إضافة شريك إلى السجل','Add partner to register')}
  </button>}
  {partners.length>0&&<>
   {issues.length>0&&<ul className="fs-warning" role="status">{issues.map(issue=><li key={String(issue)}>{issue}</li>)}</ul>}
   <div className="fs-table-wrap" role="region" aria-label={l('ملخص الشركاء','Partner summary')} tabIndex={0}>
    <table className="fs-table">
     <thead><tr>{[l('الشريك','Partner'),labels.ownershipPct,labels.profitPct,labels.cashCommitted,labels.cashPaid,
      l('المتبقي من الالتزام','Outstanding commitment'),l('الأرض العينية','In-kind land'),labels.loanPaid,
      l('إجمالي النقد المدفوع','Total cash paid')].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
     <tbody>{partners.map(partner=>{
      const paid=partnerPaidAmounts(partner,registry.asOf);
      return <tr key={partner.id}><th scope="row">{partner.name||'—'}</th>
      {[percent(partner.ownershipPct),percent(partner.profitPct),money(partner.cashCommitted),money(paid.cashPaid),
       money(Math.max(0,partner.cashCommitted-paid.cashPaid)),money(partner.id===landPartnerId?land:0),money(paid.loanPaid),
       money(paid.cashPaid+paid.loanPaid)].map((value,index)=><td key={index}><bdi>{value}</bdi></td>)}
     </tr>})}</tbody>
     <tfoot><tr><th scope="row">{l('الإجمالي','Total')}</th>
      {[percent(totals.ownershipPct),percent(totals.profitPct),money(totals.committed),money(totals.cashPaid),
       money(totals.outstanding),money(landPartnerId?land:0),money(totals.loanPaid),
       money(totals.cashPaid+totals.loanPaid)].map((value,index)=><td key={index}><bdi>{value}</bdi></td>)}
     </tr></tfoot>
    </table>
   </div>
  </>}
 </section>;
}
