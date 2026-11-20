'use client';

import type {Installment} from '@/lib/feasibility/partnership';

export default function PartnerInstallments({locale,rows,onChange}:{
 locale:string;rows:Installment[];onChange:(rows:Installment[])=>void;
}){
 const l=(ar:string,en:string)=>locale.startsWith('ar')?ar:en;
 return <details>
  <summary>{l('دفعات الشريك','Partner installments')} ({rows.length})</summary>
  {rows.map((item,index)=>{
   const update=(patch:Partial<Installment>)=>onChange(rows.map(row=>row.id===item.id?{...row,...patch}:row));
   return <fieldset key={item.id} className="fs-panel">
    <legend>{l('دفعة','Installment')} {index+1}</legend>
    <div className="fs-form-grid">
     <label className="fs-field"><span>{l('نوع التمويل','Funding type')}</span>
      <select value={item.type} onChange={event=>update({type:event.currentTarget.value==='LOAN'?'LOAN':'EQUITY'})}>
       <option value="EQUITY">{l('رأس مال','Equity')}</option><option value="LOAN">{l('قرض شريك','Partner loan')}</option>
      </select>
     </label>
     {(['amount','paid'] as const).map(key=><label key={key} className="fs-field">
      <span>{key==='amount'?l('مبلغ الدفعة المتفق عليه','Agreed installment amount'):l('المبلغ المدفوع','Amount paid')}</span>
      <input type="number" min={0} max={1e12} step="any" value={item[key]} onChange={event=>{
       const value=Number(event.currentTarget.value);
       if(Number.isFinite(value)&&value>=0&&value<=1e12)update({[key]:value});
      }}/>
     </label>)}
     {(['expectedOn','revisedOn','paidOn'] as const).map(key=><label key={key} className="fs-field">
      <span>{key==='expectedOn'?l('تاريخ الاستحقاق المتفق عليه','Agreed due date'):key==='revisedOn'?l('التاريخ المتوقع بعد التأجيل','Revised expected date'):l('تاريخ السداد الفعلي','Actual payment date')}</span>
      <input type="date" value={item[key]??''} onChange={event=>update({[key]:event.currentTarget.value||undefined})}/>
     </label>)}
    </div>
    <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>onChange(rows.filter(row=>row.id!==item.id))}>
     {l('إزالة الدفعة','Remove installment')}
    </button>
   </fieldset>;
  })}
  <button type="button" className="fs-btn fs-btn--secondary" disabled={rows.length>=100}
   onClick={()=>onChange([...rows,{id:crypto.randomUUID(),type:'EQUITY',amount:0,paid:0}])}>
   {l('إضافة دفعة','Add installment')}
  </button>
 </details>;
}
