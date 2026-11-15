'use client';
import {Fragment,useEffect,useRef,useState} from 'react';
import {approvedGroupWorksheetCsv,groupStatementLabels as statementLabels} from '../../lib/financial-group-worksheet-export';
import type {readApprovedGroupAcquisitions,readGroupAcquisitionLedgerBasis} from '../../services/financial-group-acquisition-review';
import type {readApprovedGroupEliminations} from '../../services/financial-group-elimination-batches';
import {statementAmount} from './SourceStatementTable';
type Result=Awaited<ReturnType<typeof readApprovedGroupEliminations>>;
type AcquisitionResult=Awaited<ReturnType<typeof readApprovedGroupAcquisitions>>;

type LedgerBasis=Awaited<ReturnType<typeof readGroupAcquisitionLedgerBasis>>;

function AcquisitionLedgerBasis({query,id,en}:{query:AcquisitionResult['query'];id:string;en:boolean}){
 const [basis,setBasis]=useState<LedgerBasis|'error'|null>(null);
 const [open,setOpen]=useState(false);
 const {organization,from,to}=query;
 useEffect(()=>{
  if(!open)return;
  const abort=new AbortController();
  fetch('/api/financial-reporting/group-approved-acquisitions',{method:'POST',cache:'no-store',signal:abort.signal,
   headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'LEDGER_BASIS',query:{organization,from,to},id})})
   .then(async response=>{
    if(!response.ok)throw Error('UNAVAILABLE');
    const data=await response.json();
    if(data.status!=='ACQUISITION_LEDGER_BASIS_REVIEW'||data.id!==id||
      data.query?.organization!==organization||data.query?.from!==from||data.query?.to!==to)throw Error('UNAVAILABLE');
    if(!abort.signal.aborted)setBasis(data);
   }).catch(()=>{if(!abort.signal.aborted)setBasis('error');});
  return()=>abort.abort();
 },[open,organization,from,to,id]);
 return <>
  <button type="button" aria-expanded={open} onClick={()=>{setBasis(null);setOpen(!open);}}>
   {en?'Acquisition-date book balances':'الأرصدة الدفترية بتاريخ الاستحواذ'}
  </button>
  {open&&<div data-acquisition-ledger-basis="true">
   {basis===null?<p role="status">{en?'Verifying book balances…':'جارٍ التحقق من الأرصدة الدفترية…'}</p>:
    basis==='error'?<p role="status">{en?'Book balances could not be verified.':'تعذّر التحقق من الأرصدة الدفترية.'}</p>:<>
     <p>{en?'Closing balances':'أرصدة إقفال اليوم'} · {basis.date} · {basis.currency}</p>
     <dl>
      <dt>{en?'Parent investment account group (1600)':'مجموعة حسابات استثمارات الشركة الأم (1600)'}</dt>
      <dd>{basis.investmentAccountCount?statementAmount(basis.parentInvestmentAccountGroupBalance):(en?'No accounts':'لا توجد حسابات')}</dd>
      <dt>{en?'Linked investment account':'حساب الاستثمار المرتبط'}</dt>
      <dd>{basis.linkedInvestment?`${basis.linkedInvestment.accountId} · ${statementAmount(basis.linkedInvestment.balance)}`:
       (en?'No verified account link':'لا يوجد حساب مرتبط متحقق منه')}</dd>
      <dt>{en?'Subsidiary book equity':'حقوق ملكية التابعة الدفترية'}</dt>
      <dd>{statementAmount(basis.subsidiaryBookEquity)}</dd>
      <dt>{en?'Identifiable net assets at fair value less book equity':'الفرق بين صافي الأصول بالقيمة العادلة وحقوق الملكية الدفترية'}</dt>
      <dd>{statementAmount(basis.fairValueLessBookEquity)}</dd>
     </dl>
     {!basis.linkedInvestment&&<p>{en?'The investment group can contain several holdings. Review the account tied to this acquisition before applying consolidation adjustments.':'قد تضم مجموعة الاستثمارات عدة استثمارات. يلزم تحديد الحساب المرتبط بهذا الاستحواذ قبل تطبيق تسويات التجميع.'}</p>}
    </>}
  </div>}
 </>;
}

function ApprovedAcquisitionReview({organization,from,to,en,exported}:{organization:string;from:string;to:string;en:boolean;exported?:AcquisitionResult|'error'}){
 const [loaded,setReview]=useState<AcquisitionResult|'error'|null>(null);
 const review=exported??loaded;
 useEffect(()=>{
  if(!organization||!from||!to)return;
  const abort=new AbortController();
  const scope={organization,from,to};
  fetch('/api/financial-reporting/group-approved-acquisitions',{method:'POST',cache:'no-store',signal:abort.signal,
   headers:{'Content-Type':'application/json'},body:JSON.stringify(scope)})
   .then(async response=>{
    if(response.status===404)return;
    if(!response.ok)throw Error('UNAVAILABLE');
    const data=await response.json();
    if(data.status!=='APPROVED_ACQUISITION_REVIEW'||data.query?.organization!==organization||
       data.query?.from!==from||data.query?.to!==to||!Array.isArray(data.rows))throw Error('UNAVAILABLE');
    if(!abort.signal.aborted)setReview(data);
   }).catch(()=>{if(!abort.signal.aborted)setReview('error');});
  return()=>abort.abort();
 },[organization,from,to]);
 if(review===null)return null;
 return <div data-approved-acquisition-review="true">
  <h3>{en?'Acquisition-date review':'مراجعة تقييم الاستحواذ'}</h3>
  {review==='error'?<p role="status">{en?'Approved acquisition records could not be verified.':'تعذّر التحقق من سجلات الاستحواذ المعتمدة.'}</p>:
   !review.rows.length?<p role="status">{en?'No approved acquisition records for this period.':'لا توجد تقييمات استحواذ معتمدة لهذه الفترة.'}</p>:
   <>
    <p>{en?'Amounts at the acquisition date. Statement totals are calculated separately.':'القيم بتاريخ الاستحواذ وتُعرض للمراجعة قبل إدراجها في إجماليات القوائم.'}</p>
    <div className="fs-table-scroll"><table className="fs-table">
     <thead><tr>{(en?['Subsidiary','Acquisition date','Currency','Consideration','Identifiable net assets','Goodwill','NCI at acquisition','Documents']:
      ['الشركة التابعة','تاريخ الاستحواذ','العملة','مقابل الاستحواذ','صافي الأصول المحددة','الشهرة','حقوق غير المسيطرين عند الاستحواذ','المستندات']).map(label=><th key={label}>{label}</th>)}</tr></thead>
     <tbody>{review.rows.map(({id,subsidiaryName,documentCount,calculation})=><Fragment key={id}><tr>
      <th>{subsidiaryName}</th><td>{calculation.acquisitionDate}</td><td>{calculation.currency}</td>
      <td>{statementAmount(calculation.consideration)}</td><td>{statementAmount(calculation.identifiableNetAssets)}</td>
      <td>{statementAmount(calculation.goodwill)}</td><td>{statementAmount(calculation.nciAtAcquisition)}</td><td>{documentCount}</td>
     </tr><tr><td colSpan={8}><AcquisitionLedgerBasis query={review.query} id={id} en={en}/></td></tr></Fragment>)}</tbody>
    </table></div>
   </>}
 </div>;
}

/** Scope comes exclusively from the main banner and report period. */
export default function ApprovedGroupAdjustments({organization,from,to,refresh,en}:{organization:string;from:string;to:string;refresh:number;en:boolean}){
 const key=JSON.stringify([organization,from,to,refresh]);
 const activeKey=useRef(key);activeKey.current=key;
 const exportRequest=useRef<AbortController|null>(null);
 const [exportedAcquisitions,setExportedAcquisitions]=useState<{key:string;review:AcquisitionResult|'error'}|null>(null);
 const [exporting,setExporting]=useState<string|null>(null);
 useEffect(()=>()=>{exportRequest.current?.abort();},[key]);
 const [state,setState]=useState<{key:string;data?:Result;error?:string;disabled?:boolean}|null>(null);
 useEffect(()=>{
  if(!organization||!from||!to)return;
  const abort=new AbortController();
  fetch('/api/financial-reporting/group-approved-eliminations',{method:'POST',cache:'no-store',signal:abort.signal,
   headers:{'Content-Type':'application/json'},body:JSON.stringify({organization,from,to})})
   .then(async response=>{
    const body=await response.json();
    if(abort.signal.aborted)return;
    if(response.status===404){setState({key,disabled:true});return;}
    if(!response.ok){setState({key,error:body.error??'UNAVAILABLE'});return;}
    if(body.status!=='APPROVED_GROUP_ADJUSTMENT_WORKSHEET'||body.consolidated!==false||body.worksheet?.from!==from||body.worksheet?.to!==to||body.control?.rootOrganizationId!==organization)throw Error('UNAVAILABLE');
    setState({key,data:body});
   }).catch(()=>{if(!abort.signal.aborted)setState({key,error:'UNAVAILABLE'});});
  return()=>abort.abort();
 },[organization,from,to,refresh,key]);
 async function exportWorksheet(){
  exportRequest.current?.abort();const abort=new AbortController();exportRequest.current=abort;
  const requestedKey=key;setExporting(requestedKey);
  try{
   const scope={organization,from,to};
   const response=await fetch('/api/financial-reporting/group-approved-eliminations',{method:'POST',cache:'no-store',signal:abort.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'EXPORT',query:scope})});
   const body=await response.json();
   if(abort.signal.aborted||activeKey.current!==requestedKey)return;
   if(!response.ok)throw Error(body.error??'UNAVAILABLE');
   if(!body.acquisitionReview)throw Error('UNAVAILABLE');
   const csv=approvedGroupWorksheetCsv(body,scope);
   const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
   const link=document.createElement('a');link.href=url;link.download=`group-review-${organization}-${from}-${to}-v${body.approval.version}.csv`;
   document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
   setState({key:requestedKey,data:body});
   setExportedAcquisitions({key:requestedKey,review:body.acquisitionReview.status==='APPROVED_ACQUISITION_REVIEW'?body.acquisitionReview:'error'});
  }catch(error){
   if(!abort.signal.aborted&&activeKey.current===requestedKey){
    setState({key:requestedKey,error:error instanceof Error?error.message:'UNAVAILABLE'});
    setExportedAcquisitions({key:requestedKey,review:'error'});
   }
  }
  finally{if(activeKey.current===requestedKey)setExporting(null);}
 }
 const current=state?.key===key?state:null;
 if(current?.disabled)return null;
 const data=current?.data;
 return <section className="fs-source-statements" data-approved-group-adjustments="true">
  <h2>{en?'Approved group adjustments':'استبعادات المجموعة المعتمدة'}</h2>
  <p>{en?'Verified adjustments affect this group worksheet only. Company ledgers remain unchanged. This worksheet does not certify completion of consolidated statements.':'الاستبعادات المتحقق منها تؤثر في ورقة المجموعة فقط، وتبقى دفاتر الشركات كما هي. هذه الورقة لا تعني اكتمال القوائم الموحّدة.'}</p>
  <ApprovedAcquisitionReview key={key} organization={organization} from={from} to={to} en={en} exported={exportedAcquisitions?.key===key?exportedAcquisitions.review:undefined}/>
  {!data?<p role="status">{!current?en?'Verifying approved adjustments…':'جارٍ التحقق من الاستبعادات المعتمدة…':current.error==='GROUP_BATCH_APPROVAL_REQUIRED'?en?'No approved adjustment batch exists for the selected period.':'لا توجد نسخة استبعادات معتمدة للفترة المختارة.':en?'Approved adjustments could not be verified against current sources. No amounts are shown.':'تعذر التحقق من الاستبعادات المعتمدة مقابل المصادر الحالية. لم تُعرض مبالغ غير متحقق منها.'}</p>:<>
   <p>{en?'Approved version':'النسخة المعتمدة'}: {data.approval.version} · {data.worksheet.currency}</p>
   {data.statementWorksheet&&<div data-group-statement-worksheet="true">
    <h3>{en?'Statement review after approved adjustments':'مراجعة القوائم بعد الاستبعادات المعتمدة'}</h3>
    <div className="fs-page-actions"><button type="button" onClick={exportWorksheet} disabled={exporting===key}>{exporting===key?(en?'Verifying export…':'جارٍ التحقق من التصدير…'):(en?'Export review worksheet CSV':'تصدير ورقة المراجعة CSV')}</button></div>
    <p>{en?'Review worksheet only. Final consolidated statements require completion of group scope, acquisition, non-controlling interests and currency translation reviews.':'ورقة مراجعة فقط. إصدار القوائم المجمعة النهائية يتطلب استكمال مراجعة نطاق المجموعة والاستحواذ وحقوق غير المسيطرين وترجمة العملات.'}</p>
    {(['income','position','cash'] as const).map(section=><div className="fs-table-scroll" key={section}>
     <h4>{section==='income'?(en?'Income':'الدخل'):section==='position'?(en?'Financial position':'المركز المالي'):(en?'Cash flows':'التدفقات النقدية')}</h4>
     <table className="fs-table"><thead><tr>{(en?['Item','Before adjustments','Adjustment','After adjustments']:['البند','قبل الاستبعاد','التعديل','بعد الاستبعاد']).map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{data.statementWorksheet![section].map(row=><tr key={row.key}><th>{statementLabels[row.key]?.[en?1:0]??row.key}</th>{[row.before,row.adjustment,row.after].map((value,index)=><td key={index}>{statementAmount(value)}</td>)}</tr>)}</tbody>
     </table>
    </div>)}
   </div>}
   <div className="fs-table-scroll"><table className="fs-table"><thead><tr>{(en?['Account','Before adjustments','Debit adjustment','Credit adjustment','After adjustments']:['الحساب','قبل الاستبعاد','الاستبعاد المدين','الاستبعاد الدائن','بعد الاستبعاد']).map(label=><th key={label}>{label}</th>)}</tr></thead>
    <tbody>{data.worksheet.rows.map(row=><tr key={row.reportingCode}><th>{row.reportingCode}</th>{[row.beforeNetDebit,row.adjustmentDebit,row.adjustmentCredit,row.afterNetDebit].map((value,index)=><td key={index}>{statementAmount(value)}</td>)}</tr>)}</tbody>
   </table></div>
   {data.cashWorksheet&&<div className="fs-table-scroll"><h3>{en?'Internal cash flow adjustments':'استبعاد التدفقات النقدية الداخلية'}</h3>
    <p>{en?'Matched internal receipts / payments excluded':'المقبوضات / المدفوعات الداخلية المستبعدة'}: {statementAmount(data.cashWorksheet.eliminatedInflow)} / {statementAmount(data.cashWorksheet.eliminatedOutflow)} {data.worksheet.currency}</p>
    <table className="fs-table"><thead><tr>{(en?['Activity','Before','Adjustment','After']:['النشاط','قبل الاستبعاد','التعديل','بعد الاستبعاد']).map(label=><th key={label}>{label}</th>)}</tr></thead>
     <tbody>{data.cashWorksheet.rows.map(row=><tr key={row.activity}><th>{en?row.activity:row.activity==='OPERATING'?'تشغيلي':row.activity==='INVESTING'?'استثماري':'تمويلي'}</th>{[row.before,row.adjustment,row.after].map((value,i)=><td key={i}>{statementAmount(value)}</td>)}</tr>)}</tbody>
    </table><p>{en?'Opening and closing group cash remain unchanged.':'يبقى رصيدا النقد الافتتاحي والختامي للمجموعة دون تغيير.'}</p>
   </div>}
  </>}
 </section>;
}
