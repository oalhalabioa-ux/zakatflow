'use client';
import {useState} from 'react';
import {fiscalError} from '../../lib/financial-opening-workspace';
export default function AssignOpeningVoucher({organization,fiscalStart,sourceId,accountCode,en,disabled,onAssigned}:{organization:string;fiscalStart:string;sourceId:string;accountCode:string;en:boolean;disabled:boolean;onAssigned:()=>void}){
 const [reason,setReason]=useState(''),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const t=(ar:string,english:string)=>en?english:ar;
 async function assign(){
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/financial-reporting/fiscal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'assign',organization,sourceTable:'transactions',sourceId,fiscalStart,effectiveDate:fiscalStart,accountCode,declaredAmount:null,reason})});
   const value=await response.json();if(!response.ok)throw Error(value.error);onAssigned();
  }catch(e){setError(e instanceof Error?e.message:'FISCAL_UNAVAILABLE')}finally{setBusy(false)}
 }
 return <><button type="button" className="ob-text-button" disabled={disabled||busy} onClick={()=>setOpen(v=>!v)}>{t('إسناد الرصيد لبداية هذه السنة','Assign balance to this fiscal opening')}</button>{open&&<div><p>{t('يصبح تاريخ سريان الرصيد ','The opening effective date becomes ')}{fiscalStart}{t('، مع حفظ تاريخ السند الأصلي وسبب الإسناد. احفظ التعديلات الحالية قبل الإسناد.','. The original voucher date and assignment reason remain recorded. Save current edits before assignment.')}</p><label>{t('سبب سريان الرصيد في بداية السنة','Reason for opening effective date')}<input value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label><button type="button" disabled={disabled||busy||reason.trim().length<3} onClick={()=>void assign()}>{t('تأكيد إسناد السند','Confirm voucher assignment')}</button>{error&&<p role="alert">{fiscalError(error,en)}</p>}</div>}</>;
}
