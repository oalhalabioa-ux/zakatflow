'use client';

import {useEffect,useState,type ReactNode} from 'react';
import Decimal from 'decimal.js';
import AssetOperationDetails from './AssetOperationDetails';
import GoldSaleAction from './GoldSaleAction';
import GoldCardSale from './GoldCardSale';
import Link from 'next/link';
import ActionButton,{ActionIconGlyph,type ActionIcon} from '../ActionButton';
import {reportCsv} from '../../lib/vat-financial-reports';
import {vatReportPrintHtml} from '../../lib/vat-report-print';
import {operationStateLabel,operationTypeLabel} from '../../lib/asset-operation-report';
import {AssetCardOverview,AssetCardZakat,assetCardNumber,type AssetCardStatement as Statement} from './AssetCardOverview';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export type AssetCardSection='summary'|'statement'|'valuation'|'zakat'|'documents'|'actions';
type Props={
 assetId:string;name:string;typeName:string;icon:ReactNode;status:string;active:boolean;organizational:boolean;ar:boolean;revision:number;
 section:AssetCardSection;onSection:(section:AssetCardSection)=>void;onClose:()=>void;onSaved:()=>void;
 toolbar:ReactNode;content:ReactNode;work:ReactNode;hawlLots:Parameters<typeof AssetCardZakat>[0]['hawlLots'];zakatable:boolean;
};
export default function AssetStatementPreview({assetId,name,typeName,icon,status,active,organizational,ar,revision,
 section,onSection,onClose,onSaved,toolbar,content,work,hawlLots,zakatable}:Props){
 const t=(arabic:string,english:string)=>ar?arabic:english;
 const [selling,setSelling]=useState(false);
 const [voucher,setVoucher]=useState<{assetId:string;id:string}|null>(null);
 const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
 const [asOf,setAsOf]=useState(today);
 const [offset,setOffset]=useState(0);
 const [statement,setStatement]=useState<Statement|null>(null);
 const [overview,setOverview]=useState<Statement|null>(null);
 const impact=section==='zakat'&&!organizational;
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const [previousRevision,setPreviousRevision]=useState(revision);
 if(previousRevision!==revision){
  setPreviousRevision(revision);
  setAsOf(today());
  setOffset(0);
  setOverview(null);
  setStatement(null);
  setLoading(true);
 }
 useEffect(()=>{
  if(!asOf)return;
  const controller=new AbortController();
  setLoading(true);setError('');setExportError('');setStatement(null);
  const query=new URLSearchParams({asOf,offset:String(offset),limit:'20'});
  if(impact)query.set('impact','1');
  fetch(`/api/assets/${encodeURIComponent(assetId)}/statement?${query}`,{signal:controller.signal,cache:'no-store'})
   .then(async response=>{
    const result=await response.json();
    if(!response.ok)throw new Error(result.error);
    if(!controller.signal.aborted){
     setStatement(result);
     if(result.current)setOverview(result);
    }
   }).catch(cause=>{if(!controller.signal.aborted)setError(cause.message);})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[assetId,asOf,offset,revision,impact]);

 function refreshAfterSave(){
  setOffset(0);
  setAsOf(today());
  setOverview(null);
  onSaved();
 }

 const format=assetCardNumber;
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

 const statusLabel=(value:string)=>value==='UNVERIFIED'?t('غير مؤكد','Unverified'):operationStateLabel(value,ar);
 const headings=[
  t('التاريخ','Date'),t('السند','Voucher'),t('الحركة','Movement'),t('الحالة','Status'),
  t('داخل','In'),t('خارج','Out'),t('سعر الوحدة في السند','Voucher unit price'),t('العملة','Currency'),t('الصرف','FX'),
  t('مبلغ العملية','Amount'),t('أثر التكلفة','Cost effect'),t('متحصلات البيع','Sale proceeds'),
  t('الربح أو الخسارة المحققة','Realized gain or loss'),t('الكمية المتبقية','Remaining units'),t('التكلفة المتبقية','Remaining cost'),
 ];
 const amounts=(row:Statement['rows'][number],unitPrice=row.unitPrice)=>[
  row.quantityIn,row.quantityOut,unitPrice,row.currency,row.exchangeRate,row.amount,row.costEffect,row.sale?.proceeds??null,row.sale?.realized??null,row.remainingQuantity,row.remainingCost,
 ];
 const displayedUnitPrice=(value:string|null)=>value===null?null:new Decimal(value).toFixed(2,Decimal.ROUND_HALF_UP);

 async function exportStatement(kind:'print'|'csv'){
  const preview=kind==='print'?window.open('','_blank'):null;
  if(kind==='print'&&!preview){
   setExportError(t('اسمح بفتح نافذة الطباعة.','Allow the print window.'));
   return;
  }
  if(preview){
   preview.opener=null;
   preview.document.body.textContent=t('جار تجهيز كشف الحركة…','Preparing the movement statement…');
  }
  setExporting(true);
  setExportError('');
  try{
   const query=new URLSearchParams({asOf,view:'report'});
   const response=await fetch(`/api/assets/${encodeURIComponent(assetId)}/statement?${query}`,{cache:'no-store'});
   if(!response.ok)throw Error('STATEMENT_EXPORT_FAILED');
   const report:Statement=await response.json();
   const rows=report.rows.map(row=>[row.date,show(row.voucher??row.reference),movement(row.type),statusLabel(row.status),...amounts(row,kind==='print'?displayedUnitPrice(row.unitPrice):row.unitPrice).map(show)]);
   const title=t('كشف حركة الأصل','Asset movement statement');
   const period=`${report.asset.name} · ${t('حتى تاريخ','Through date')} ${report.asOf} · ${report.baseCurrency}`;
   const closing=report.complete
    ? `${t('الرصيد الختامي','Closing balance')} · ${show(report.closing.quantity)} ${report.asset.unit} · ${show(report.closing.cost)} ${report.baseCurrency}`
    : t('لم تكتمل مطابقة الأرصدة مع المصادر المسجلة لهذا الكشف.','Some balances could not be reconciled with recorded sources.');
   if(preview){
    preview.document.write(vatReportPrintHtml(title,period,headings,rows,ar,'#10243A',{footer:closing}));
    preview.document.close();
   }else{
    const url=URL.createObjectURL(new Blob([reportCsv([[title],[period],headings,...rows,[closing]])],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;
    link.download=`asset-movements-${report.asOf}.csv`;
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
   }
  }catch{
   preview?.close();
   setExportError(t('تعذر تصدير كشف الحركة. حاول مرة أخرى.','Could not export the movement statement. Try again.'));
  }finally{
   setExporting(false);
  }
 }

 const tabs:[AssetCardSection,ActionIcon,string][]=[
  ['summary','details',t('ملخص الأصل','Asset summary')],
  ['statement','history',t('كشف حركة الأصل','Asset movement statement')],
  ['valuation','trend',organizational?t('التقييم والإهلاك','Valuation and depreciation'):t('التقييم','Valuation')],
  ['zakat','operations',t('أثر العمليات على الزكاة','Zakat impact of operations')],
  ['documents','receipt',t('المستندات','Documents')],
  ['actions','operations',t('الإجراءات','Actions')],
 ];
 const voucherView=voucher?.assetId===assetId;
 const subview=work??(voucherView?<AssetOperationDetails key={voucher.id} record={{id:voucher.id}} ar={ar}
  onClose={()=>setVoucher(null)} onSaleReadBack={()=>setVoucher(null)} onChanged={refreshAfterSave}/>
  :selling?<GoldCardSale id={assetId} date={asOf} ar={ar} onBack={()=>setSelling(false)} onSaved={()=>{setSelling(false);refreshAfterSave();}}/>:null);
 const movementView=section==='statement';
 const dateFilter=<label className="asset-card-date">{t('حتى تاريخ','Through date')} <input type="date" value={asOf} max={today()} required
  onChange={event=>{if(event.target.value){setOffset(0);setAsOf(event.target.value);}}}/></label>;
 const paging=statement&&(offset>0||statement.nextOffset!==null)&&<nav aria-label={t('صفحات الكشف','Statement pages')} className="asset-detail-actions">
  <button className="btn secondary" type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-20))}>{t('السابق','Previous')}</button>
  <span dir="ltr">{offset+1}–{offset+statement.rows.length} / {statement.total}</span>
  <button className="btn secondary" type="button" disabled={statement.nextOffset===null} onClick={()=>setOffset(statement.nextOffset??offset)}>{t('التالي','Next')}</button>
 </nav>;
 return <article className="asset-card" dir={ar?'rtl':'ltr'}>
  <header className="asset-card-header">
   <h2><ActionIconGlyph name="details"/>{t('بطاقة الأصل — التفاصيل والإجراءات','Asset card — details and actions')}</h2>
   <ActionButton icon="close" label={t('إغلاق التفاصيل','Close details')} onClick={event=>{
    if(!event.currentTarget.closest('dialog')?.querySelector('[aria-busy="true"]:not(.asset-card-overview)'))onClose();
   }}/>
  </header>
  <div className="asset-card-body">
   {subview??<>
    <div className="asset-card-toolbar" role="group" aria-label={t('إجراءات الأصل','Asset actions')}>
     {toolbar}
     <ActionButton icon="print" label={t('طباعة كشف الحركة','Print movement statement')} showLabel disabled={exporting||!statement} onClick={()=>void exportStatement('print')}/>
     <ActionButton icon="download" label={t('تصدير كشف الحركة CSV','Export movement statement CSV')} showLabel disabled={exporting||!statement} onClick={()=>void exportStatement('csv')}/>
    </div>
    {exportError&&<p role="alert">{exportError}</p>}
    <div className="asset-card-identity">
     <span className="asset-card-icon" aria-hidden="true">{icon}</span>
     <div><h3>{name}</h3><ul aria-label={t('تصنيف الأصل وحالته','Asset classification and status')}>
      <li className="asset-card-chip">{organizational?t('مؤسسي','Institutional'):t('شخصي','Personal')}</li>
      <li className="asset-card-chip asset-card-chip-type">{typeName}</li>
      <li className="asset-card-chip" data-active={active}>{status}</li>
      {overview?.asset.metalGrade&&<li className="asset-card-chip">{overview.asset.type==='GOLD'?t('عيار','Karat'):t('نقاوة','Purity')} {overview.asset.metalGrade}</li>}
      {overview?.allocationMethod==='FIFO'&&<li className="asset-card-chip">FIFO</li>}
     </ul></div>
    </div>
    <AssetCardOverview statement={overview} ar={ar} loading={loading&&!overview}/>
    <nav className="asset-card-tabs" aria-label={t('أقسام بطاقة الأصل','Asset card sections')}>
     {tabs.map(([key,icon,label])=><ActionButton key={key} icon={icon} label={label} showLabel aria-pressed={section===key} onClick={()=>onSection(key)}/>)}
    </nav>
    <div className="asset-card-content" data-section={section}>
     {(movementView||impact)&&dateFilter}
   {(movementView||section==='zakat'||section==='summary')&&loading&&<p role="status">{t('جار تحميل كشف الحركة…','Loading movement statement…')}</p>}
   {(movementView||section==='zakat'||section==='summary')&&error&&<p role="alert">{error==='ASSET_STATEMENT_SPECIALIZED_SOURCE'
    ?t('حركة هذا الأصل متاحة في سجله المتخصص.','This asset’s movements are available in its source register.')
    :error==='ASSET_STATEMENT_LIMIT'
    ?t('تجاوز تاريخ هذا الأصل حد العرض. اختر تاريخًا أقدم.','This asset exceeds the statement limit. Select an earlier date.')
    :t('تعذر تحميل كشف الحركة.','The movement statement could not be loaded.')}</p>}
   {section==='zakat'&&<>
    <AssetCardZakat statement={statement} hawlLots={hawlLots} zakatable={zakatable} organizational={organizational} ar={ar}/>
    {impact&&paging}
   </>}
   {content}
   {(movementView||section==='valuation')&&statement&&<>
    {movementView&&process.env.NEXT_PUBLIC_PERSONAL_GOLD_SALES==='1'&&!statement.asset.organizational&&statement.asset.type==='GOLD'&&statement.asset.unit==='g'&&statement.asset.metalGrade&&<ActionButton icon="operations" showLabel label={t('بيع من حزم الذهب','Sell from gold lots')} onClick={()=>setSelling(true)}/>}
    {!statement.complete&&<p role="status">{t('لم تكتمل مطابقة الأرصدة مع المصادر المسجلة لهذا الكشف.','Some balances could not be reconciled with recorded sources.')}</p>}
    {statement.complete&&<section className="asset-card-valuation" aria-label={t('أساس التقييم','Valuation basis')}>
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
   </>}
   {movementView&&statement&&<>
    {statement.asset.metalGrade&&<p>{statement.asset.type==='GOLD'?t('عيار الأصل','Asset karat'):t('نقاوة الأصل','Asset purity')} · <bdi>{statement.asset.metalGrade}</bdi></p>}
    {!!statement.rows.length&&<div tabIndex={0} role="region" aria-label={t('جدول كشف حركة الأصل','Asset movement statement table')} className="asset-card-movements">
     <table className="table">
      <thead><tr>{headings.map(heading=><th key={heading} scope="col">{heading}</th>)}</tr></thead>
      <tbody>{statement.rows.map(row=><tr key={row.id} data-movement={row.type} data-status={row.status}>
       <td><bdi>{row.date}</bdi></td>
       <td>{row.source_path==='asset_event'?show(row.voucher??row.reference):
        row.type==='SALE'&&row.source_path==='transactions'&&!row.grouped&&!statement.asset.organizational?
        <button type="button" className="btn" onClick={()=>setVoucher({assetId,id:row.source_id})}><bdi>{row.voucher??row.reference??t('عرض سند البيع','View sale voucher')}</bdi></button>:
        <Link href={`/${ar?'ar':'en'}/transactions/${row.source_id}`}><bdi>{row.voucher??row.reference??t('التفاصيل','Details')}</bdi></Link>}</td>
       <td>{movement(row.type)}</td>
       <td>{statusLabel(row.status)}</td>
       {amounts(row,displayedUnitPrice(row.unitPrice)).map((value,index)=><td key={index}><bdi>{show(value)}</bdi></td>)}
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
      {row.grouped&&row.status!=='REVERSED'&&process.env.NEXT_PUBLIC_PERSONAL_GOLD_SALES==='1'&&<GoldSaleAction id={row.source_id} ar={ar} revision={row.grouped.revision} onSaved={refreshAfterSave}/>}
     </details>)}
    </section>}
    {!statement.rows.length&&<p>{t('لا توجد حركات مسجلة حتى هذا التاريخ.','There are no recorded movements through this date.')}</p>}
    {paging}
   </>}
    </div>
   </>}
  </div>
 </article>;
}
