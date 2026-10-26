'use client';
import VoucherStamp from '../VoucherStamp';
import {useEffect,useState} from 'react';
import ActionButton from '../ActionButton';
import {assetOpeningError} from '@/lib/asset-opening-workspace';
export default function AssetOpeningControls({asset,ar,onChanged}:{asset:any;ar:boolean;onChanged:(next:any|null)=>void}){
 const[context,setContext]=useState<any>(null),[edit,setEdit]=useState(false),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const[form,setForm]=useState({name:'',date:'',amount:'',quantity:'',purpose:''});
 const t=(a:string,e:string)=>ar?a:e;
 useEffect(()=>{const controller=new AbortController();setContext(null);setError('');void fetch(`/api/assets/opening?asset_id=${asset.id}`,{signal:controller.signal,cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(!controller.signal.aborted)setContext(d);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[asset.id,asset.updated_at]);
 function begin(){const a=context.asset,m=a.metadata??{};setForm({name:a.name,date:m.purchase_date??'',amount:String(m.purchase_value??m.opening_value??''),quantity:String(m.quantity??1),purpose:m.purpose??''});setEdit(true);setConfirm(false);setError('');}
 async function act(action:'UPDATE'|'ARCHIVE'){
  if(busy)return;setBusy(true);setError('');
  try{const r=await fetch('/api/assets/opening',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,asset_id:asset.id,expected_updated_at:context.asset.updated_at,...(action==='UPDATE'?{changes:{...form,amount:Number(form.amount),quantity:Number(form.quantity)}}:{})})});const d=await r.json();if(!r.ok)throw Error(d.error);setEdit(false);setConfirm(false);onChanged(d.archived?null:d.asset);}
  catch(e:any){setError(e.message);}finally{setBusy(false);}
 }
 return <section className="asset-opening-controls" aria-label={t('سند الرصيد الافتتاحي','Opening balance voucher')}>
 <VoucherStamp domain="ASSET" record={{id:context?.opening_transaction_id??undefined,transaction_type:context?.opening_transaction_type??'OPENING_BALANCE'}} ar={ar}/><h4>{t('سند الرصيد الافتتاحي','Opening balance voucher')}</h4>
 {!context&&!error&&<p className="muted">{t('جار التحقق من صلاحية التعديل والحذف…','Checking edit and delete eligibility…')}</p>}
 {context&&!context.can_edit&&<p className="muted">{assetOpeningError(context.block_reason,ar)}</p>}
 {context?.can_edit&&!edit&&!confirm&&<div className="asset-detail-actions"><ActionButton icon="edit" label={t('تعديل سند الرصيد الافتتاحي','Edit opening balance voucher')} showLabel onClick={begin}/><ActionButton icon="delete" label={t('حذف سند الرصيد الافتتاحي','Delete opening balance voucher')} showLabel onClick={()=>setConfirm(true)}/></div>}
 {edit&&<form onSubmit={e=>{e.preventDefault();void act('UPDATE');}}><fieldset disabled={busy} style={{border:0,padding:0,margin:0}}><div className="form-grid">
 <label>{t('اسم الأصل','Asset name')}<input required maxLength={200} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
 <label>{t('تاريخ الرصيد الافتتاحي','Opening balance date')}<input required type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
 <label>{t('قيمة الرصيد الافتتاحي','Opening balance amount')} ({asset.currency})<input required type="number" min="0.00000001" step="any" dir="ltr" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>
 <label>{t('الكمية','Quantity')}<input required type="number" min="0.00000001" step="any" dir="ltr" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/></label>
 <label>{t('الغرض','Purpose')}<input maxLength={2000} value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value})}/></label>
 </div><div className="asset-detail-actions"><ActionButton type="submit" icon="save" label={t('حفظ التعديلات','Save changes')} showLabel/><ActionButton icon="close" label={t('إلغاء','Cancel')} showLabel onClick={()=>setEdit(false)}/></div></fieldset></form>}
 {confirm&&<div role="alert"><p>{t('هل تريد حذف سند الرصيد الافتتاحي؟ سيُستبعد الأصل ورصيده من الأصول النشطة مع الاحتفاظ بالسجل للمراجعة.','Delete this opening voucher? The asset and its balance will be removed from active assets, while retaining the audit history.')}</p><div className="asset-detail-actions"><ActionButton icon="delete" label={busy?t('جار الحذف…','Deleting…'):t('تأكيد الحذف','Confirm delete')} showLabel disabled={busy} onClick={()=>void act('ARCHIVE')}/><ActionButton icon="close" label={t('إلغاء','Cancel')} showLabel disabled={busy} onClick={()=>setConfirm(false)}/></div></div>}
 {error&&<p role="alert">{assetOpeningError(error,ar)}</p>}
 </section>;
}
