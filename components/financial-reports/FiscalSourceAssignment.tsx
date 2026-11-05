'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {fiscalError} from '../../lib/financial-opening-workspace';

export type OpeningCandidate = {
 sourceTable:'transactions'|'liquidity_accounts'|'financial_event_obligations';
 sourceId:string;
 kind:'ASSET'|'LOAN'|'BANK';
 name:string;
 date:string;
 amount:string|null;
 accountCode:string;
 declaredRequired:boolean;
 suggestedAmount?:string|null;
 suggestionIssue?:string|null;
};

export function useOpeningCandidates(organization:string,fiscalStart:string,revision?:string){
 const [candidates,setCandidates]=useState<OpeningCandidate[]>([]);
 const [error,setError]=useState('');
 useEffect(()=>{
  setCandidates([]);
  setError('');
  if(!organization||!fiscalStart)return;
  const controller=new AbortController();
  fetch('/api/financial-reporting/fiscal?'+new URLSearchParams({action:'sources',organization,fiscalStart}),{cache:'no-store',signal:controller.signal})
   .then(async response=>{
    const value=await response.json();
    if(!response.ok)throw Error(value.error);
    if(!controller.signal.aborted)setCandidates(value);
   })
   .catch(error=>{if(!controller.signal.aborted)setError(error.message)});
  return()=>controller.abort();
 },[organization,fiscalStart,revision]);
 return {candidates,error};
}

type Props = {
 source:OpeningCandidate;
 organization:string;
 fiscalStart:string;
 currency:string;
 chart:{code:string;ar:string;en:string;kind:string}[];
 en:boolean;
 disabled:boolean;
 onAssigned:()=>void;
};

const formatInteger=new Intl.NumberFormat('en-US');
function displayAmount(amount:string){
 const [whole,fraction='']=amount.split('.');
 if(!/^-?\d+$/.test(whole))return amount;
 const sign=whole.startsWith('-')?'-':'';
 return sign+formatInteger.format(BigInt(whole.replace(/^-/,'')))+'.'+fraction.replace(/0+$/,'').padEnd(2,'0');
}

export default function FiscalSourceAssignment({source,organization,fiscalStart,currency,chart,en,disabled,onAssigned}:Props){
 const t=(ar:string,english:string)=>en?english:ar;
 const bank=source.kind==='BANK';
 const dialog=useRef<HTMLDialogElement>(null);
 const [amount,setAmount]=useState('');
 const [account,setAccount]=useState(source.accountCode);
 const [reason,setReason]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const declared=amount.trim().replace(/,/g,'');
 const validAmount=/^-?\d{1,20}(\.\d{1,4})?$/.test(declared);

 function open(){
  setError('');
  setAccount(source.accountCode);
  setReason('');
  setAmount(source.suggestionIssue||!source.suggestedAmount?'':displayAmount(source.suggestedAmount));
  dialog.current?.showModal();
 }

 async function assign(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(disabled||busy||(bank?!validAmount:reason.trim().length<3))return;
  setBusy(true);
  setError('');
  try{
   const response=await fetch('/api/financial-reporting/fiscal',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
     action:'assign',organization,sourceTable:source.sourceTable,sourceId:source.sourceId,
     fiscalStart,effectiveDate:fiscalStart,accountCode:account,declaredAmount:bank?declared:null,
     reason:bank?t('تمت مراجعة رصيد البنك في بداية السنة','Bank balance reviewed at fiscal start'):reason.trim(),
    }),
   });
   const value=await response.json();
   if(!response.ok)throw Error(value.error);
   dialog.current?.close();
   onAssigned();
  }catch(error){setError(error instanceof Error?error.message:'FISCAL_UNAVAILABLE')}
  finally{setBusy(false)}
 }

 const reviewLabel=bank?t('مراجعة افتتاح البنك','Review bank opening'):t('مراجعة الإسناد','Review assignment');
 return <>
  <button type="button" className="ob-review-trigger" disabled={disabled||busy}
   title={disabled?t('احفظ تعديلات المسودة قبل الإسناد','Save draft changes before assigning'):undefined} onClick={open}>{reviewLabel}</button>
  <dialog ref={dialog} className="fs-dialog ob-source-review-dialog" aria-label={reviewLabel}
   onCancel={event=>{if(busy)event.preventDefault()}}>
   <form onSubmit={assign}>
    <header><h2>{reviewLabel}</h2><p>{source.name}</p></header>
    <dl className="ob-review-facts">
     {!bank&&<div><dt>{t('تاريخ السند','Voucher date')}</dt><dd><bdi>{source.date}</bdi></dd></div>}
     <div><dt>{t('يسري من','Effective from')}</dt><dd><bdi>{fiscalStart}</bdi></dd></div>
     {!bank&&source.amount!==null&&<div><dt>{t('رصيد السند','Voucher balance')}</dt><dd><bdi>{displayAmount(source.amount)} {currency}</bdi></dd></div>}
    </dl>
    {bank?<label>{t('رصيد البنك في بداية السنة بالعملة الأساسية','Bank opening in base currency')} <bdi>({currency})</bdi>
     <input inputMode="decimal" dir="ltr" value={amount} disabled={busy} onChange={event=>setAmount(event.target.value)}/>
     <small>{source.suggestionIssue||!source.suggestedAmount?t('أدخل رصيد بداية السنة من كشف البنك.','Enter the fiscal-start balance from the bank statement.'):t('طابق المبلغ المقترح مع كشف البنك قبل التأكيد.','Verify the suggested balance against the bank statement.')}</small>
    </label>:<>
     <label>{t('حساب الافتتاحي','Opening account')}
      <select disabled={busy} value={account} onChange={event=>setAccount(event.target.value)}>
       {chart.filter(item=>item.code.length===4&&['ASSET','LIABILITY','EQUITY'].includes(item.kind)).map(item=><option key={item.code} value={item.code}>{item.code} · {en?item.en:item.ar}</option>)}
      </select>
     </label>
     <label>{t('سبب الإسناد إلى بداية السنة','Reason for assigning to fiscal start')}
      <input disabled={busy} value={reason} maxLength={1000} onChange={event=>setReason(event.target.value)}/>
     </label>
    </>}
    {error&&<p role="alert">{fiscalError(error,en)}</p>}
    <footer>
     <button type="button" className="ob-review-trigger" disabled={busy} onClick={()=>dialog.current?.close()}>{t('إلغاء','Cancel')}</button>
     <button type="submit" className="fs-gold" disabled={disabled||busy||(bank?!validAmount:reason.trim().length<3)}>
      {bank?t('تأكيد افتتاح البنك','Confirm bank opening'):t('تأكيد الإسناد','Confirm assignment')}
     </button>
    </footer>
   </form>
  </dialog>
 </>;
}
