'use client';
import {useEffect,useState} from 'react';
import type {readApprovedGroupEliminations} from '../../services/financial-group-elimination-batches';
import {statementAmount} from './SourceStatementTable';
type Result=Awaited<ReturnType<typeof readApprovedGroupEliminations>>;
/** Scope comes exclusively from the main banner and report period. */
export default function ApprovedGroupAdjustments({organization,from,to,refresh,en}:{organization:string;from:string;to:string;refresh:number;en:boolean}){
 const key=JSON.stringify([organization,from,to,refresh]);
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
 const current=state?.key===key?state:null;
 if(current?.disabled)return null;
 const data=current?.data;
 return <section className="fs-source-statements" data-approved-group-adjustments="true">
  <h2>{en?'Approved group adjustments':'استبعادات المجموعة المعتمدة'}</h2>
  <p>{en?'Verified adjustments affect this group worksheet only. Company ledgers remain unchanged. This worksheet does not certify completion of consolidated statements.':'الاستبعادات المتحقق منها تؤثر في ورقة المجموعة فقط، وتبقى دفاتر الشركات كما هي. هذه الورقة لا تعني اكتمال القوائم الموحّدة.'}</p>
  {!data?<p role="status">{!current?en?'Verifying approved adjustments…':'جارٍ التحقق من الاستبعادات المعتمدة…':current.error==='GROUP_BATCH_APPROVAL_REQUIRED'?en?'No approved adjustment batch exists for the selected period.':'لا توجد نسخة استبعادات معتمدة للفترة المختارة.':en?'Approved adjustments could not be verified against current sources. No amounts are shown.':'تعذر التحقق من الاستبعادات المعتمدة مقابل المصادر الحالية. لم تُعرض مبالغ غير متحقق منها.'}</p>:<>
   <p>{en?'Approved version':'النسخة المعتمدة'}: {data.approval.version} · {data.worksheet.currency}</p>
   <div className="fs-table-scroll"><table className="fs-table"><thead><tr>{(en?['Account','Before adjustments','Debit adjustment','Credit adjustment','After adjustments']:['الحساب','قبل الاستبعاد','الاستبعاد المدين','الاستبعاد الدائن','بعد الاستبعاد']).map(label=><th key={label}>{label}</th>)}</tr></thead>
    <tbody>{data.worksheet.rows.map(row=><tr key={row.reportingCode}><th>{row.reportingCode}</th>{[row.beforeNetDebit,row.adjustmentDebit,row.adjustmentCredit,row.afterNetDebit].map((value,index)=><td key={index}>{statementAmount(value)}</td>)}</tr>)}</tbody>
   </table></div>
  </>}
 </section>;
}
