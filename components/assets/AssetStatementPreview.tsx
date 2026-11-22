'use client';

import {useEffect,useState} from 'react';
import AssetOperationDetails from './AssetOperationDetails';
import GoldSaleAction from './GoldSaleAction';
import GoldCardSale from './GoldCardSale';
import Link from 'next/link';
import {operationStateLabel,operationTypeLabel} from '../../lib/asset-operation-report';
import type {readAssetStatement} from '../../services/asset-statement';

type Statement = Awaited<ReturnType<typeof readAssetStatement>>;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export default function AssetStatementPreview({assetId,ar}:{assetId:string;ar:boolean}){
 const t=(arabic:string,english:string)=>ar?arabic:english;
 const [selling,setSelling]=useState(false),[revision,setRevision]=useState(0);
 const [voucher,setVoucher]=useState<{assetId:string;id:string}|null>(null);
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
 },[open,assetId,asOf,offset,revision]);

 const format=(value:string|null)=>{
  if(value===null)return '—';
  const [whole,fraction]=value.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction:'');
 };
 const show=(value:string|null)=>value??'—';
 const unit=ar&&statement?.asset.unit==='g'?'غ':statement?.asset.unit;
 const marketSource=statement?.valuation?.source;
 const sourceLabel=marketSource==='USER_MANUAL'||marketSource==='MANUAL_MARKET_PRICE'?t('يدوي','Manual'):marketSource;
 const movement=(type:string)=>{
  if(type==='OPENING_BALANCE')return t('رصيد افتتاحي','Opening balance');
  if(type==='PRICE_CORRECTION')return t('تصحيح السعر','Price correction');
  if(type==='REVERSAL')return t('عكس','Reversal');
  if(type==='ADJUSTMENT_IN')return t('تسوية إضافة','Addition adjustment');
  if(type==='ADJUSTMENT_OUT')return t('تسوية خصم','Deduction adjustment');
  return operationTypeLabel(type,ar);
 };

 if(voucher?.assetId===assetId)return <AssetOperationDetails key={voucher.id} record={{id:voucher.id}} ar={ar}
  onClose={()=>setVoucher(null)} onSaleReadBack={()=>setVoucher(null)} onChanged={()=>{setOffset(0);setRevision(v=>v+1);}}/>;
 if(selling)return <GoldCardSale id={assetId} date={asOf} ar={ar} onBack={()=>setSelling(false)} onSaved={()=>{setSelling(false);setOpen(true);setOffset(0);setRevision(v=>v+1);}}/>;
 return <details open={open} className="card section" onToggle={event=>setOpen(event.currentTarget.open)}>
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
    {process.env.NEXT_PUBLIC_PERSONAL_GOLD_SALES==='1'&&!statement.asset.organizational&&statement.asset.type==='GOLD'&&statement.asset.unit==='g'&&statement.asset.metalGrade&&<button type="button" onClick={()=>setSelling(true)}>{t('بيع من حزم الذهب','Sell from gold lots')}</button>}
    {!statement.complete&&<p role="status">{t('لم تكتمل مطابقة الأرصدة مع المصادر المسجلة لهذا الكشف.','Some balances could not be reconciled with recorded sources.')}</p>}
    {statement.complete&&<section className="asset-statement-summary" aria-label={t('ملخص رصيد الأصل','Asset balance summary')}>
     <dl className="operation-detail-grid">
      <div><dt>{t('الكمية المتبقية','Remaining quantity')}</dt><dd><bdi>{format(statement.closing.quantity)} {unit}</bdi></dd></div>
      <div><dt>{statement.asset.organizational?t('صافي القيمة الدفترية','Net book value'):t('تكلفة المتبقي','Remaining cost')}</dt>
       <dd><bdi>{format(statement.closing.cost)} {statement.baseCurrency}</bdi></dd></div>
      {statement.valuation&&<>
       <div><dt>{t('القيمة السوقية الحالية','Current market value')}</dt><dd><bdi>{format(statement.valuation.value)} {statement.baseCurrency}</bdi></dd></div>
       <div><dt>{t(
        statement.valuation.unrealized.startsWith('-')?'خسارة غير محققة':statement.valuation.unrealized==='0'?'فرق التقييم غير المحقق':'ربح غير محقق',
        statement.valuation.unrealized.startsWith('-')?'Unrealized loss':statement.valuation.unrealized==='0'?'Unrealized valuation difference':'Unrealized gain',
       )}</dt><dd><bdi>{format(statement.valuation.unrealized)} {statement.baseCurrency}</bdi></dd></div>
      </>}
     </dl>
     {statement.averageCost&&<p>{t('متوسط تكلفة الوحدة المتبقية','Average cost per remaining unit')} · <bdi>{format(statement.averageCost)} {statement.baseCurrency}</bdi></p>}
     {statement.valuation&&<p>
      {t('سعر السوق المطبق للوحدة','Applied market price per unit')} · <bdi>{format(statement.valuation.appliedPrice)} {statement.valuation.quoteCurrency}</bdi>
      {statement.valuation.basis==='PURE_METAL_REFERENCE'&&<>
       {' '}{statement.asset.type==='GOLD'?t('من مرجع عيار 24','from the 24K reference'):t('من مرجع الفضة الخالصة','from the pure silver reference')}
       {' '}<bdi>{format(statement.valuation.quote)} × {statement.valuation.purity}</bdi>
      </>}
      {statement.valuation.fx!=='1'&&<> · {t('الصرف','FX')} <bdi>{statement.valuation.fx}</bdi></>}
      {sourceLabel&&<> · {t('المصدر','Source')} <bdi>{sourceLabel}</bdi></>}
      {statement.valuation.quoteDate&&<bdi> · {statement.valuation.quoteDate}</bdi>}
     </p>}
     {statement.valuation&&<p>
      <bdi>{format(statement.closing.quantity)} {unit} × {format(statement.valuation.appliedPrice)}
       {statement.valuation.fx!=='1'?` × ${statement.valuation.fx}`:''} = {format(statement.valuation.value)} {statement.baseCurrency}</bdi>
     </p>}
     {statement.current&&!statement.valuation&&!['CASH','BANK','RECEIVABLE'].includes(statement.asset.type)&&
      <p>{t('القيمة السوقية غير متاحة من سعر وحدة موثّق.','Market value is unavailable from a recorded unit quote.')}</p>}
    </section>}
    {statement.asset.metalGrade&&<p>{statement.asset.type==='GOLD'?t('عيار الأصل','Asset karat'):t('نقاوة الأصل','Asset purity')} · <bdi>{statement.asset.metalGrade}</bdi></p>}
    {!!statement.rows.length&&<div tabIndex={0} role="region" aria-label={t('جدول كشف حركة الأصل','Asset movement statement table')} style={{overflowX:'auto'}}>
     <table className="table">
      <thead><tr>{[
       t('التاريخ','Date'),t('السند','Voucher'),t('الحركة','Movement'),t('الحالة','Status'),
       t('داخل','In'),t('خارج','Out'),t('سعر الوحدة في السند','Voucher unit price'),t('العملة','Currency'),t('الصرف','FX'),
       t('مبلغ العملية','Amount'),t('أثر التكلفة','Cost effect'),t('الكمية المتبقية','Remaining units'),t('التكلفة المتبقية','Remaining cost'),
      ].map(heading=><th key={heading} scope="col">{heading}</th>)}</tr></thead>
      <tbody>{statement.rows.map(row=><tr key={row.id}>
       <td><bdi>{row.date}</bdi></td>
       <td>{row.source_path==='asset_event'?show(row.voucher??row.reference):
        row.type==='SALE'&&row.source_path==='transactions'&&!row.grouped&&!statement.asset.organizational?
        <button type="button" className="btn" onClick={()=>setVoucher({assetId,id:row.source_id})}><bdi>{row.voucher??row.reference??t('عرض سند البيع','View sale voucher')}</bdi></button>:
        <Link href={`/${ar?'ar':'en'}/transactions/${row.source_id}`}><bdi>{row.voucher??row.reference??t('التفاصيل','Details')}</bdi></Link>}</td>
       <td>{movement(row.type)}</td>
       <td>{row.status==='UNVERIFIED'?t('غير مؤكد','Unverified'):operationStateLabel(row.status,ar)}</td>
       {[row.quantityIn,row.quantityOut,row.unitPrice,row.currency,row.exchangeRate,row.amount,row.costEffect,row.remainingQuantity,row.remainingCost]
        .map((value,index)=><td key={index}><bdi>{show(value)}</bdi></td>)}
      </tr>)}</tbody>
     </table>
    </div>}
    {statement.rows.some(row=>row.sale||['PURCHASE','OPENING_BALANCE'].includes(row.type))&&<section aria-label={t('تفاصيل الاقتناء والبيع','Acquisition and sale breakdowns')}>
     <h4>{t('تفاصيل الاقتناء والبيع','Acquisition and sale breakdowns')}</h4>
     {statement.rows.filter(row=>row.sale||['PURCHASE','OPENING_BALANCE'].includes(row.type)).map(row=><details key={row.id} className="card section" data-asset-movement={row.type}>
      <summary>{movement(row.type)} · <bdi>{row.voucher??row.reference??row.date}</bdi> · <bdi>{show(row.sale?row.quantityOut:row.quantityIn)} {unit}</bdi></summary>
      {row.pricingQuantity&&<p><bdi>{format(row.pricingQuantity)} {unit} × {format(row.unitPrice)} = {format(row.amount)} {row.currency}</bdi></p>}
      {row.grade&&['GOLD','SILVER'].includes(statement.asset.type)&&<p>{t('العيار أو النقاوة في السند','Karat or purity on the voucher')} · <bdi>{row.grade}</bdi></p>}
      <dl className="operation-detail-grid">
       <div><dt>{t('السعر الفعلي للوحدة في السند','Actual unit price in voucher')}</dt><dd><bdi>{format(row.unitPrice)} {row.currency}</bdi></dd></div>
       <div><dt>{row.sale?t('مبلغ البيع في السند','Recorded sale amount'):t('مبلغ الاقتناء في السند','Recorded acquisition amount')}</dt><dd><bdi>{format(row.amount)} {row.currency}</bdi></dd></div>
       {!row.sale&&<div><dt>{t('تكلفة الاقتناء المسجلة','Recorded acquisition cost')}</dt><dd><bdi>{format(row.costEffect)} {statement.baseCurrency}</bdi></dd></div>}
       {row.sale&&<>
       <div><dt>{t('متحصلات البيع المسجلة','Recorded sale proceeds')}</dt><dd><bdi>{format(row.sale?.proceeds??null)} {statement.baseCurrency}</bdi></dd></div>
       <div><dt>{t('تكلفة الكمية المباعة','Cost of units sold')}{row.grouped?.method?' · '+(row.grouped.method==='FIFO'?'FIFO':t('يدوي','Manual')):null}</dt><dd><bdi>{format(row.sale?.cost??null)} {statement.baseCurrency}</bdi></dd></div>
       <div><dt>{row.status==='REVERSED'?t('نتيجة البيع قبل العكس','Sale result before reversal'):
         row.sale?.realized?.startsWith('-')?t('خسارة محققة','Realized loss'):t('نتيجة البيع المحققة','Realized sale result')}</dt>
         <dd><bdi>{format(row.sale?.realized??null)} {statement.baseCurrency}</bdi></dd></div>
       </>}
       <div><dt>{t('الرصيد بعد الحركة','Balance after movement')}</dt><dd><bdi>{format(row.remainingQuantity)} {unit} · {format(row.remainingCost)} {statement.baseCurrency}</bdi></dd></div>
      </dl>
      {row.grouped&&row.status!=='REVERSED'&&process.env.NEXT_PUBLIC_PERSONAL_GOLD_SALES==='1'&&<GoldSaleAction id={row.source_id} ar={ar} revision={row.grouped.revision} onSaved={()=>setRevision(v=>v+1)}/>}
     </details>)}
    </section>}
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
