'use client';
import {useId,useRef,useState} from 'react';
import type {StudySupplier} from '@/lib/feasibility/engine';
import {applyWaterCapexQuote} from '@/lib/feasibility/water-capex';
import type {WaterCapexItemKey,WaterModel} from '@/lib/feasibility/water-model';
import {RoyalIcon} from './RoyalIcon';

export default function WaterCapexQuoteImport({water,quotes,items,currency,locale,onChange}:{
 water:WaterModel;quotes:readonly StudySupplier[];items:readonly {key:WaterCapexItemKey;label:string}[];
 currency:string;locale:string;onChange:(value:WaterModel)=>void;
}){
 const ar=locale==='ar',l=(a:string,e:string)=>ar?a:e;
 const dialog=useRef<HTMLDialogElement>(null),titleId=useId();
 const [quoteId,setQuoteId]=useState(''),[target,setTarget]=useState<WaterCapexItemKey>('buildings');
 const [confirmed,setConfirmed]=useState(false);
 const eligible=quotes.filter(q=>q.status!=='REJECTED'&&q.vendor.trim()&&q.item.trim()&&Number.isFinite(q.offer)&&q.offer>=0&&q.offer<=1e12);
 const preview=applyWaterCapexQuote(water,quotes,quoteId,target,currency,confirmed);
 const money=(n:number)=>new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(n)+' '+currency;
 return <>
  <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>{
   setConfirmed(false);setQuoteId('');dialog.current?.showModal();
  }}><RoyalIcon name="truck"/>{l('استيراد عرض مورد','Import supplier quote')}</button>
  <dialog className="fs-dialog fs-royal-dialog" ref={dialog} aria-labelledby={titleId}>
   <h2 id={titleId}>{l('مراجعة عرض المورد للتكلفة الاستثمارية','Review supplier quote for investment cost')}</h2>
   <p className="fs-hint">{l('تُقرأ العروض من سجل موردي الدراسة الحالية. راجع الكمية والضريبة والنقل والعملة؛ يستبدل المبلغ بندًا واحدًا دون تحويل عملة أو إنشاء أمر شراء.',
    'Quotes come from this study’s supplier register. Verify quantity, tax, freight and currency. This replaces one cost item without currency conversion or a purchase order.')}</p>
   {!eligible.length&&<p role="status">{l('أضف عرضًا مكتملًا في قسم عروض الموردين أولًا.','Add a complete quote in Supplier quotes first.')}</p>}
   {!/^[A-Z]{3}$/.test(currency)&&<p role="status">{l('حدد عملة الدراسة في بيانات المشروع قبل الاستيراد.','Select the study currency in Profile before importing.')}</p>}
   <label className="fs-field"><span>{l('عرض المورد','Supplier quote')}</span><select value={quoteId} onChange={e=>{setQuoteId(e.target.value);setConfirmed(false)}}>
    <option value="">{l('اختر العرض','Choose a quote')}</option>{eligible.map(q=><option key={q.id} value={q.id}>{q.vendor+' · '+q.item+' · '+money(q.offer)}</option>)}</select></label>
   <label className="fs-field"><span>{l('البند الاستثماري المستهدف','Target investment item')}</span><select value={target} onChange={e=>{setTarget(e.target.value as WaterCapexItemKey);setConfirmed(false)}}>
    {items.map(item=><option value={item.key} key={item.key}>{item.label}</option>)}</select></label>
   <p>{l('القيمة الحالية','Current amount')}: <bdi>{money(water.capex[target])}</bdi></p>
   <label className="fs-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
    {l('راجعت العرض والتصنيف وأؤكد استبدال المبلغ بعملة الدراسة نفسها.','I reviewed the quote and classification and confirm replacing the amount in the study currency.')}</label>
   <div className="fs-actions"><button type="button" className="fs-btn" disabled={!preview} onClick={()=>{
    const next=applyWaterCapexQuote(water,quotes,quoteId,target,currency,confirmed);
    if(next){onChange(next);dialog.current?.close()}
   }}>{l('تطبيق العرض على البند','Apply quote to item')}</button>
    <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>dialog.current?.close()}>{l('إلغاء','Cancel')}</button></div>
  </dialog>
 </>;
}
