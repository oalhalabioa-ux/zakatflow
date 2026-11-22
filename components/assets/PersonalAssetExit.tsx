'use client';

import {useRef,useState} from 'react';
import Decimal from 'decimal.js';
import ActionButton from '../ActionButton';

type Account={id:string;name:string;currency:string;asset_type:string;organization_id?:string|null;ownership_scope?:string|null};
type Asset=Pick<Account,'id'|'name'|'currency'>&{current_quantity:number|string};

export default function PersonalAssetExit({asset,accounts,baseCurrency,ar,onClose,onSaved}:{
 asset:Asset;accounts:Account[];baseCurrency:string;ar:boolean;onClose:()=>void;onSaved:()=>void;
}){
 const t=(arabic:string,english:string)=>ar?arabic:english;
 const [kind,setKind]=useState<'SALE'|'DISPOSAL'>('SALE');
 const [date,setDate]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 const [quantity,setQuantity]=useState(''),[unitPrice,setUnitPrice]=useState('');
 const [fx,setFx]=useState(''),[destination,setDestination]=useState(''),[notes,setNotes]=useState('');
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
 const submitting=useRef(false);
 const sale=kind==='SALE';
 const sameCurrency=asset.currency===baseCurrency;
 const rate=sameCurrency||!sale?'1':fx;
 const gross=sale&&quantity&&unitPrice?new Decimal(quantity).mul(unitPrice):new Decimal(0);
 const accountsInCurrency=accounts.filter(account=>account.id!==asset.id&&!account.organization_id&&
  account.ownership_scope!=='ORGANIZATION'&&['CASH','BANK'].includes(account.asset_type)&&[asset.currency,baseCurrency].includes(account.currency));

 async function save(){
  if(submitting.current||uncertain)return;
  submitting.current=true;
  setBusy(true);
  setError('');
  try{
   const response=await fetch('/api/transactions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    asset_account_id:asset.id,transaction_type:sale?'SALE':'ADJUSTMENT',transaction_date:date,
    quantity:Number(quantity),unit_price:sale?Number(unitPrice):0,gross_value:gross.toNumber(),
    currency:asset.currency,base_currency:baseCurrency,fx_rate:Number(rate),base_value:gross.mul(rate).toNumber(),
    ...(sale?{proceeds_account_id:destination}:{adjustment_direction:'OUT',disposal_zero_value:true}),
    notes:notes.trim()||undefined,
   })});
   if(response.status===400){
    const result=await response.json();
    if(['INSUFFICIENT_LOT_BALANCE','SALE_PROCEEDS_CURRENCY_MISMATCH','INVALID_SALE','ASSET_NOT_FOUND',
     'DESTINATION_MUST_BE_CASH_OR_BANK','DESTINATION_MUST_DIFFER','QUANTITY_MUST_BE_POSITIVE'].includes(result.error)){
     setError(result.error);
     return;
    }
   }
   if(response.status!==201)throw Error('UNCONFIRMED');
   onSaved();
  }catch{
   setUncertain(true);
   setError(t('تعذر تأكيد نتيجة الحفظ. ارجع إلى الكشف وتحقق من الحركة قبل إعادة المحاولة.','The save outcome could not be confirmed. Check the movement statement before trying again.'));
  }finally{
   submitting.current=false;
   setBusy(false);
  }
 }

 return <section className="card section">
  <div className="page-head"><h3>{asset.name} · {t('البيع أو الاستبعاد','Sale or disposal')}</h3>
   <ActionButton icon="close" label={t('العودة إلى الكشف','Return to statement')} disabled={busy} onClick={onClose}/>
  </div>
  <p>{t('الكمية المتبقية','Remaining quantity')} · <bdi>{asset.current_quantity}</bdi></p>
  <form aria-busy={busy} onSubmit={event=>{event.preventDefault();void save();}}>
   <fieldset className="form-grid asset-entry-fields" disabled={busy||uncertain}>
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
    disabled={busy||uncertain||(sale&&!accountsInCurrency.length)}/>
  </form>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
