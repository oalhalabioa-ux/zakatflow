'use client';

import {useEffect,useRef,useState} from 'react';
import Decimal from 'decimal.js';
import ActionButton from '../ActionButton';

type Account={id:string;name:string;currency:string;asset_type:string;organization_id?:string|null;ownership_scope?:string|null};
type Asset=Pick<Account,'id'|'name'|'currency'>&{current_quantity:number|string};

type ExitCommand={
 request_id:string;asset_account_id:string;transaction_type:'SALE'|'ADJUSTMENT';transaction_date:string;
 quantity:number;unit_price:number;gross_value:number;currency:string;base_currency:string;fx_rate:number;base_value:number;
 proceeds_account_id?:string;adjustment_direction?:'OUT';disposal_zero_value?:boolean;notes?:string;
};
const pendingKey=(assetId:string)=>`yaqeen:personal-asset-exit:${assetId}`;
export function pendingPersonalAssetExit(assetId:string):ExitCommand|null{
 try{
  const saved=sessionStorage.getItem(pendingKey(assetId));
  const command=saved?JSON.parse(saved):null;
  if(command?.asset_account_id!==assetId||typeof command.request_id!=='string')return null;
  if(command.transaction_type!=='SALE'&&!(command.transaction_type==='ADJUSTMENT'&&command.disposal_zero_value===true))return null;
  return command;
 }catch{return null;}
}

const definitiveRejections=new Set([
 'INSUFFICIENT_LOT_BALANCE','SALE_PROCEEDS_CURRENCY_MISMATCH','INVALID_SALE','ASSET_NOT_FOUND',
 'DESTINATION_MUST_BE_CASH_OR_BANK','DESTINATION_MUST_DIFFER','QUANTITY_MUST_BE_POSITIVE','PERSONAL_ASSET_EXIT_INVALID',
]);

export default function PersonalAssetExit({asset,accounts,baseCurrency,ar,onClose,onSaved,initialOperation="SALE"}:{
 initialOperation?:'SALE'|'DISPOSAL';asset:Asset;accounts:Account[];baseCurrency:string;ar:boolean;onClose:()=>void;onSaved:()=>void;
}){
 const t=(arabic:string,english:string)=>ar?arabic:english;
 const [kind,setKind]=useState(initialOperation);
 const [date,setDate]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 const [quantity,setQuantity]=useState(''),[unitPrice,setUnitPrice]=useState('');
 const [fx,setFx]=useState(''),[destination,setDestination]=useState(''),[notes,setNotes]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [pending,setPending]=useState<ExitCommand|null>(null),[ready,setReady]=useState(false);
 useEffect(()=>{
  setPending(pendingPersonalAssetExit(asset.id));
  setReady(true);
 },[asset.id]);
 const submitting=useRef(false);
 const sale=kind==='SALE';
 const sameCurrency=asset.currency===baseCurrency;
 const rate=sameCurrency||!sale?'1':fx;
 const gross=sale&&quantity&&unitPrice?new Decimal(quantity).mul(unitPrice):new Decimal(0);
 const accountsInCurrency=accounts.filter(account=>account.id!==asset.id&&!account.organization_id&&
  account.ownership_scope!=='ORGANIZATION'&&['CASH','BANK'].includes(account.asset_type)&&[asset.currency,baseCurrency].includes(account.currency));


 async function send(command:ExitCommand){
  if(submitting.current)return;
  submitting.current=true;
  setBusy(true);
  setError('');
  try{
   try{
    sessionStorage.setItem(pendingKey(asset.id),JSON.stringify(command));
   }catch{
    setError(t('فعّل تخزين الجلسة في المتصفح ليتمكن النظام من استئناف الحفظ بأمان.','Enable browser session storage so this operation can be resumed safely.'));
    return;
   }
   setPending(command);
   const response=await fetch('/api/transactions',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),
   });
   if(response.status===400){
    const result=await response.json();
    if(definitiveRejections.has(result.error)){
     sessionStorage.removeItem(pendingKey(asset.id));
     setPending(null);
     setError(result.error);
     return;
    }
    if(result.error==='PERSONAL_ASSET_EXIT_REQUEST_CONFLICT'){
     setError(t('تعارض معرّف الطلب مع عملية محفوظة. راجع كشف الحركة قبل تسجيل عملية جديدة.','The request ID belongs to a different saved operation. Review the statement before starting a new operation.'));
     return;
    }
   }
   if(response.status!==201)throw Error('UNCONFIRMED');
   sessionStorage.removeItem(pendingKey(asset.id));
   setPending(null);
   onSaved();
  }catch{
   setError(t('تعذر تأكيد نتيجة الحفظ. استخدم إعادة إرسال الطلب نفسه للتحقق من العملية.','The save outcome is uncertain. Retry the same request to confirm the operation.'));
  }finally{
   submitting.current=false;
   setBusy(false);
  }
 }

 function save(){
  if(!ready||pending||submitting.current)return;
  void send({
   request_id:crypto.randomUUID(),asset_account_id:asset.id,transaction_type:sale?'SALE':'ADJUSTMENT',transaction_date:date,
   quantity:Number(quantity),unit_price:sale?Number(unitPrice):0,gross_value:gross.toNumber(),
   currency:asset.currency,base_currency:baseCurrency,fx_rate:Number(rate),base_value:gross.mul(rate).toNumber(),
   ...(sale?{proceeds_account_id:destination}:{adjustment_direction:'OUT',disposal_zero_value:true}),
   notes:notes.trim()||undefined,
  });
 }

 return <section className="card section">
  <div className="page-head"><h3>{asset.name} · {t('البيع أو الاستبعاد','Sale or disposal')}</h3>
   <ActionButton icon="close" label={t('العودة إلى الكشف','Return to statement')} disabled={busy} onClick={onClose}/>
  </div>
  <p>{t('الكمية المتبقية','Remaining quantity')} · <bdi>{asset.current_quantity}</bdi></p>
  {pending?<div aria-busy={busy}>
   <p role="status">{t('يوجد طلب حفظ قيد التحقق. إعادة إرسال الطلب نفسه تحفظ نتيجة واحدة.','A save request is awaiting confirmation. Retrying it preserves a single result.')}</p>
   <ActionButton icon="save" showLabel label={t('إعادة إرسال الطلب نفسه','Retry same request')} disabled={busy} onClick={()=>void send(pending)}/>
  </div>:<form aria-busy={busy} onSubmit={event=>{event.preventDefault();void save();}}>
   <fieldset className="form-grid asset-entry-fields" disabled={!ready||busy}>
    <label>{t('الإجراء','Action')}<select value={kind} onChange={event=>setKind(event.target.value==='SALE'?'SALE':'DISPOSAL')}>
     <option value="SALE">{t('بيع','Sale')}</option><option value="DISPOSAL">{t('استبعاد دون مقابل','Disposal without proceeds')}</option>
    </select></label>
    <label>{t('تاريخ العملية','Operation date')}<input type="date" required value={date} onChange={event=>setDate(event.target.value)}/></label>
    <label>{t('الكمية','Quantity')}<input type="number" required min="0.00000001" max={asset.current_quantity} step="any" value={quantity} onChange={event=>setQuantity(event.target.value)}/></label>
    {sale&&<>
     <label>{t('سعر بيع الوحدة','Sale price per unit')} ({asset.currency})<input type="number" required min="0.00000001" step="any" value={unitPrice} onChange={event=>setUnitPrice(event.target.value)}/></label>
     {!sameCurrency&&<label>{t('سعر الصرف إلى','Exchange rate to')} {baseCurrency}<input type="number" required min="0.00000001" step="any" value={fx} onChange={event=>setFx(event.target.value)}/></label>}
     <label>{t('حساب القبض','Proceeds account')}<select required value={destination} onChange={event=>setDestination(event.target.value)}>
      <option value="">{t('اختر حساب نقد أو بنك','Choose a cash or bank account')}</option>
      {accountsInCurrency.map(account=><option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
     </select></label>
     {!accountsInCurrency.length&&<p>{t('يلزم حساب نقد أو بنك شخصي بعملة البيع أو العملة الأساسية.','A personal cash or bank account in the sale or base currency is required.')}</p>}
     <p>{t('إجمالي البيع','Gross sale proceeds')} · <bdi>{gross.toString()} {asset.currency}</bdi>
      {!sameCurrency&&rate&&<> · <bdi>{gross.mul(rate).toString()} {baseCurrency}</bdi></>}</p>
    </>}
    <label>{t('ملاحظات','Notes')}<textarea rows={2} maxLength={2000} value={notes} onChange={event=>setNotes(event.target.value)}/></label>
   </fieldset>
   <ActionButton type="submit" icon="save" label={t('حفظ العملية','Save operation')} showLabel
    disabled={!ready||busy||(sale&&!accountsInCurrency.length)}/>
  </form>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
