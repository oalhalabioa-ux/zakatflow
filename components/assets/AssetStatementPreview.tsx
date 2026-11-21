'use client';

import {useEffect,useState} from 'react';
import Link from 'next/link';
import {operationStateLabel,operationTypeLabel} from '../../lib/asset-operation-report';
import type {readAssetStatement} from '../../services/asset-statement';

type Statement = Awaited<ReturnType<typeof readAssetStatement>>;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export default function AssetStatementPreview({assetId,ar}:{assetId:string;ar:boolean}){
 const t=(arabic:string,english:string)=>ar?arabic:english;
 const [open,setOpen]=useState(false);
 const [asOf,setAsOf]=useState(today);
 const [offset,setOffset]=useState(0);
 const [statement,setStatement]=useState<Statement|null>(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!open||!asOf)return;
  const controller=new AbortController();
  setLoading(true);setError('');setStatement(null);
  const query=new URLSearchParams({asOf,offset:String(offset),limit:'20'});
  fetch(`/api/assets/${encodeURIComponent(assetId)}/statement?${query}`,{signal:controller.signal,cache:'no-store'})
   .then(async response=>{
    const result=await response.json();
    if(!response.ok)throw new Error(result.error);
    if(!controller.signal.aborted)setStatement(result);
   }).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[open,assetId,asOf,offset]);

 const show=(value:string|null)=>value??'—';
 const movement=(type:string)=>{
  if(type==='PRICE_CORRECTION')return t('تصحيح السعر','Price correction');
  if(type==='REVERSAL')return t('عكس','Reversal');
  if(type==='ADJUSTMENT_IN')return t('تسوية إضافة','Addition adjustment');
  if(type==='ADJUSTMENT_OUT')return t('تسوية خصم','Deduction adjustment');
  return operationTypeLabel(type,ar);
 };

 return <details className="card section" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>{t('كشف حركة الأصل','Asset movement statement')}</summary>
  {open&&<>
   <label>{t('حتى تاريخ','Through date')} <input type="date" value={asOf} max={today()} required
    onChange={event=>{if(event.target.value){setOffset(0);setAsOf(event.target.value);}}}/></label>
   {loading&&<p role="status">{t('جار تحميل كشف الحركة…','Loading movement statement…')}</p>}
   {error&&<p role="alert">{error==='ASSET_STATEMENT_SPECIALIZED_SOURCE'
    ?t('حركة هذا الأصل متاحة في سجله المتخصص.','This asset’s movements are available in its source register.')
    :error==='ASSET_STATEMENT_LIMIT'
    ?t('تجاوز تاريخ هذا الأصل حد العرض. اختر تاريخًا أقدم.','This asset exceeds the statement limit. Select an earlier date.')
    :t('تعذر تحميل كشف الحركة.','The movement statement could not be loaded.')}</p>}
   {statement&&<>
    {!statement.complete&&<p role="status">{t('لم تكتمل مطابقة الأرصدة مع المصادر المسجلة لهذا الكشف.','Some balances could not be reconciled with recorded sources.')}</p>}
    <p>{t('الرصيد في تاريخ الكشف','Closing balance')} · {show(statement.closing.quantity)} {statement.asset.unit} · {show(statement.closing.cost)} {statement.baseCurrency}</p>
    {!!statement.rows.length&&<div tabIndex={0} role="region" aria-label={t('جدول كشف حركة الأصل','Asset movement statement table')} style={{overflowX:'auto'}}>
     <table className="table">
      <thead><tr>{[
       t('التاريخ','Date'),t('السند','Voucher'),t('الحركة','Movement'),t('الحالة','Status'),
       t('داخل','In'),t('خارج','Out'),t('سعر الوحدة','Unit price'),t('العملة','Currency'),t('الصرف','FX'),
       t('مبلغ العملية','Amount'),t('أثر التكلفة','Cost effect'),t('الكمية المتبقية','Remaining units'),t('التكلفة المتبقية','Remaining cost'),
      ].map(heading=><th key={heading} scope="col">{heading}</th>)}</tr></thead>
      <tbody>{statement.rows.map(row=><tr key={row.id}>
       <td><bdi>{row.date}</bdi></td>
       <td>{row.source_path==='asset_event'?show(row.voucher??row.reference):
        <Link href={`/${ar?'ar':'en'}/transactions/${row.source_id}`}><bdi>{row.voucher??row.reference??t('التفاصيل','Details')}</bdi></Link>}</td>
       <td>{movement(row.type)}</td>
       <td>{row.status==='UNVERIFIED'?t('غير مؤكد','Unverified'):operationStateLabel(row.status,ar)}</td>
       {[row.quantityIn,row.quantityOut,row.unitPrice,row.currency,row.exchangeRate,row.amount,row.costEffect,row.remainingQuantity,row.remainingCost]
        .map((value,index)=><td key={index}><bdi>{show(value)}</bdi></td>)}
      </tr>)}</tbody>
     </table>
    </div>}
    {!statement.rows.length&&<p>{t('لا توجد حركات مسجلة حتى هذا التاريخ.','There are no recorded movements through this date.')}</p>}
    {(offset>0||statement.nextOffset!==null)&&<nav aria-label={t('صفحات الكشف','Statement pages')} className="asset-detail-actions">
     <button className="btn" type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>{t('السابق','Previous')}</button>
     <span>{offset+1}–{offset+statement.rows.length} / {statement.total}</span>
     <button className="btn" type="button" disabled={statement.nextOffset===null} onClick={()=>setOffset(statement.nextOffset??offset)}>{t('التالي','Next')}</button>
    </nav>}
   </>}
  </>}
 </details>;
}
