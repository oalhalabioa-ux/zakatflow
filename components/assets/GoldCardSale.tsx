'use client';
import {useEffect,useRef,useState} from 'react';
import {supabaseBrowser} from '@/lib/supabase/browser';

type Lot={id:string;asset:string;source:string;date:string;remaining_quantity:number;remaining_value_base:number};
type Options={lots:Lot[];banks:{id:string;name:string}[];currency:string;karat:string};
type Preview={allocations:{lot_id:string;allocated_quantity:number;quantity_after:number;cost_base:number}[];gross:number;cost:number};

export default function GoldCardSale({id,date,ar,onBack,onSaved}:{id:string;date:string;ar:boolean;onBack:()=>void;onSaved:()=>void}){
 const t=(a:string,e:string)=>ar?a:e;
 const [options,setOptions]=useState<Options|null>(null),[method,setMethod]=useState('FIFO');
 const [qty,setQty]=useState(''),[price,setPrice]=useState(''),[bank,setBank]=useState('');
 const [lines,setLines]=useState<Record<string,string>>({}),[preview,setPreview]=useState<Preview|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef(''),locked=useRef(false);
 useEffect(()=>{let current=true;
  supabaseBrowser().rpc('gold_card_sale',{p_asset:id,p_date:date}).then(({data,error})=>{
   if(!current)return;
   if(error)setError(error.message);else {setOptions(data);setBank(data.banks[0]?.id??'');}
  });return ()=>{current=false;};
 },[id,date]);
 async function submit(){
  if(locked.current)return;
  locked.current=true;setBusy(true);setError('');
  try{
   const selection=method==='MANUAL'?Object.entries(lines).filter(([,v])=>Number(v)>0).map(([id,v])=>({id,quantity:v})):[];
   const payload={method,quantity:qty,price,bank,selection,...(preview?{request:request.current,expected:preview.allocations}:{})};
   const {data,error}=await supabaseBrowser().rpc('gold_card_sale',{p_asset:id,p_date:date,p_payload:payload});
   if(error){
    if(error.message==='SALE_PREVIEW_CHANGED'){
     setPreview(null);
     throw Error(t('تغيّر رصيد الحزم. أعد معاينة البيع قبل الحفظ.','Lot balances changed. Preview the sale again before saving.'));
    }
    throw Error(error.message);
   }
   if(preview)onSaved();else{request.current=crypto.randomUUID();setPreview(data);}
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{locked.current=false;setBusy(false);}
 }
 return <form onSubmit={e=>{e.preventDefault();void submit();}} onChange={()=>setPreview(null)}>
  <h3>{t('بيع ذهب','Gold sale')} {options?.karat} · {date}</h3>
  {error&&<p role="alert">{error}</p>}
  {options&&<fieldset disabled={busy}>
   <label>{t('اختيار الحزم','Lot selection')}<select value={method} onChange={e=>setMethod(e.target.value)}><option value="FIFO">{t('الأقدم أولاً','FIFO')}</option><option value="MANUAL">{t('تحديد يدوي','Specific lots')}</option></select></label>
   <label>{t('الكمية بالغرام','Quantity in grams')}<input required type="number" min="0.00000001" step="any" value={qty} onChange={e=>setQty(e.target.value)}/></label>
   <label>{t('سعر بيع الغرام','Sale price per gram')}<input required type="number" min="0.00000001" step="any" value={price} onChange={e=>setPrice(e.target.value)}/></label>
   <label>{t('حساب القبض','Receipt account')}<select required value={bank} onChange={e=>setBank(e.target.value)}>{options.banks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
   {method==='MANUAL'&&options.lots.map(l=><label key={l.id}>{l.asset} · {l.source} · {l.date} · {l.remaining_quantity} g
    <input type="number" min="0" max={l.remaining_quantity} step="any" value={lines[l.id]??''} onChange={e=>setLines({...lines,[l.id]:e.target.value})}/></label>)}
   {preview&&<section aria-live="polite"><strong>{t('الربح أو الخسارة المحققة','Realized gain or loss')} {preview.gross-preview.cost} {options.currency}</strong>
    <p>{t('إجمالي البيع قبل الرسوم والضريبة','Gross sale before fees and tax')} {preview.gross} · {t('تكلفة المباع','Cost of sale')} {preview.cost}</p>
    {preview.allocations.map(a=>{const lot=options.lots.find(l=>l.id===a.lot_id);return <p key={a.lot_id}>{lot?.asset} · {lot?.source} · {lot?.date} · {t('المباع','Sold')} {a.allocated_quantity} g · {t('تكلفة الغرام','Unit cost')} {a.cost_base/a.allocated_quantity} · {t('المتبقي','Remaining')} {a.quantity_after} g</p>;})}
   </section>}
   <button type="submit">{preview?t('حفظ سند البيع','Save sale voucher'):t('معاينة البيع','Preview sale')}</button>
  </fieldset>}
  <button type="button" disabled={busy} onClick={onBack}>{t('العودة للكشف','Back to statement')}</button>
 </form>;
}
