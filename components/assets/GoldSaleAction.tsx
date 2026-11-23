'use client';
import {useRef,useState} from 'react';
import {supabaseBrowser} from '@/lib/supabase/browser';
import {personalSaleCorrectionMessage} from '@/lib/personal-sale-correction';

export default function GoldSaleAction({id,ar,revision,onSaved}:{id:string;ar:boolean;revision:number;onSaved:()=>void}){
 const t=(a:string,e:string)=>ar?a:e;
 const [action,setAction]=useState(''),[reason,setReason]=useState(''),[price,setPrice]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const key=useRef(''),pending=useRef(false);
 async function save(){
  if(pending.current)return;
  pending.current=true;setBusy(true);setError('');
  try{
   if(!key.current)key.current=crypto.randomUUID();
   const client=supabaseBrowser();
   const result=action==='price'?await client.rpc('amend_personal_sale_price',{
    p_sale_id:id,p_request_id:key.current,p_expected_revision:revision,p_unit_price:price,p_reason:reason,
   }):await client.rpc('reverse_grouped_gold_sale',{p_sale:id,p_request:key.current,p_revision:revision,p_reason:reason});
   if(result.error){
    const message=personalSaleCorrectionMessage(result.error.message,ar);
    const ids:string[]=(result.error.details??'').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig)??[];
    if(!ids.length&&result.error.message==='SALE_CORRECTION_PROCEEDS_USED'){
     const check=await client.rpc('personal_sale_preflight',{p_sale_id:id});
     for(const movement of check.data?.movements??[])ids.push(movement.id);
    }
    const numbers=ids.length?await client.from('voucher_numbers').select('document_number').in('source_id',ids):null;
    const labels=numbers?.data?.map(row=>row.document_number)??[];
    setError([message,...(labels.length?labels:ids)].join(' · '));return;
   }
   onSaved();
  }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  finally{pending.current=false;setBusy(false);}
 }
 if(!action)return <div><button type="button" onClick={()=>setAction('price')}>{t('تصحيح سعر السند','Correct sale price')}</button>
  <button type="button" onClick={()=>setAction('reverse')}>{t('عكس البيع والقبض','Reverse sale and receipt')}</button></div>;
 return <form onChange={()=>{key.current='';}} onSubmit={e=>{e.preventDefault();void save();}}>
  {action==='price'&&<label>{t('سعر البيع المصحح','Corrected sale price')}<input disabled={busy} required type="number" step="any" min="0.00000001" value={price} onChange={e=>setPrice(e.target.value)}/></label>}
  <label>{t('سبب الإجراء','Reason for change')}<input disabled={busy} required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  {error&&<p role="alert">{error}</p>}
  <button disabled={busy}>{action==='price'?t('حفظ التصحيح','Save correction'):t('تأكيد عكس البيع والقبض','Confirm sale and receipt reversal')}</button>
  <button type="button" disabled={busy} onClick={()=>{setAction('');setError('');key.current='';}}>{t('إلغاء','Cancel')}</button>
 </form>;
}
