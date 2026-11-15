'use client';
import {useEffect,useRef,useState} from 'react';
import {approvedGroupWorksheetCsv,groupStatementLabels as statementLabels} from '../../lib/financial-group-worksheet-export';
import type {readApprovedGroupEliminations} from '../../services/financial-group-elimination-batches';
import {statementAmount} from './SourceStatementTable';
type Result=Awaited<ReturnType<typeof readApprovedGroupEliminations>>;
/** Scope comes exclusively from the main banner and report period. */
export default function ApprovedGroupAdjustments({organization,from,to,refresh,en}:{organization:string;from:string;to:string;refresh:number;en:boolean}){
 const key=JSON.stringify([organization,from,to,refresh]);
 const activeKey=useRef(key);activeKey.current=key;
 const exportRequest=useRef<AbortController|null>(null);
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
   const response=await fetch('/api/financial-reporting/group-approved-eliminations',{method:'POST',cache:'no-store',signal:abort.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(scope)});
   const body=await response.json();
   if(abort.signal.aborted||activeKey.current!==requestedKey)return;
   if(!response.ok)throw Error(body.error??'UNAVAILABLE');
   const csv=approvedGroupWorksheetCsv(body,scope);
   const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
   const link=document.createElement('a');link.href=url;link.download=`group-review-${organization}-${from}-${to}-v${body.approval.version}.csv`;
   document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
   setState({key:requestedKey,data:body});
  }catch(error){if(!abort.signal.aborted&&activeKey.current===requestedKey)setState({key:requestedKey,error:error instanceof Error?error.message:'UNAVAILABLE'});}
  finally{if(activeKey.current===requestedKey)setExporting(null);}
 }
 const current=state?.key===key?state:null;
 if(current?.disabled)return null;
 const data=current?.data;
 return <section className="fs-source-statements" data-approved-group-adjustments="true">
  <h2>{en?'Approved group adjustments':'استبعادات المجموعة المعتمدة'}</h2>
  <p>{en?'Verified adjustments affect this group worksheet only. Company ledgers remain unchanged. This worksheet does not certify completion of consolidated statements.':'الاستبعادات المتحقق منها تؤثر في ورقة المجموعة فقط، وتبقى دفاتر الشركات كما هي. هذه الورقة لا تعني اكتمال القوائم الموحّدة.'}</p>
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
