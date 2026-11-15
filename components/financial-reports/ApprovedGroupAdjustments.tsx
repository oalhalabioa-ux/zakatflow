'use client';
import {Fragment,useEffect,useRef,useState} from 'react';
import {approvedGroupWorksheetCsv,groupAcquisitionPositionCsv,groupStatementLabels as statementLabels} from '../../lib/financial-group-worksheet-export';
import type {readGroupAcquisitionPosition} from '../../services/financial-group-acquisition-position';
import type {readApprovedGroupAcquisitions,readGroupAcquisitionLedgerBasis} from '../../services/financial-group-acquisition-review';
import type {readApprovedGroupEliminations} from '../../services/financial-group-elimination-batches';
import {statementAmount} from './SourceStatementTable';
type Result=Awaited<ReturnType<typeof readApprovedGroupEliminations>>;
type AcquisitionResult=Awaited<ReturnType<typeof readApprovedGroupAcquisitions>>;

function downloadCsv(csv:string,filename:string){
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download=filename;
 document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
}

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

type PositionReview=Awaited<ReturnType<typeof readGroupAcquisitionPosition>>;
function AcquisitionPositionReview({query,en}:{query:AcquisitionResult['query'];en:boolean}){
 const [result,setResult]=useState<PositionReview|'loading'|'error'|null>(null);
 const request=useRef<AbortController|null>(null);
 useEffect(()=>()=>request.current?.abort(),[]);
 async function load(exportCsv=false){
  request.current?.abort();
  const abort=new AbortController();
  request.current=abort;
  setResult('loading');
  try{
   const response=await fetch('/api/financial-reporting/group-approved-acquisitions',{
    method:'POST',cache:'no-store',signal:abort.signal,headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'ACQUISITION_POSITION',query}),
   });
   if(!response.ok)throw Error('UNAVAILABLE');
   const data=await response.json();
   if(data.query?.organization!==query.organization||data.query?.from!==query.from||data.query?.to!==query.to||
     !['ACQUISITION_DAY_POSITION_REVIEW','ACQUISITION_CARRY_FORWARD_POSITION_REVIEW','ACQUISITION_POSITION_UNAVAILABLE'].includes(data.status))throw Error('UNAVAILABLE');
   if(abort.signal.aborted)return;
   if(exportCsv){
    const csv=groupAcquisitionPositionCsv(data,query);
    downloadCsv(csv,`group-adjusted-statements-${query.organization}-${query.from}-${query.to}-v${data.approval.version}.csv`);
   }
   setResult(data);
  }catch{if(!abort.signal.aborted)setResult('error');}
 }
 return <div data-acquisition-position-review="true">
  <div className="fs-page-actions"><button type="button" onClick={()=>void load()} disabled={result==='loading'}>
   {query.from===query.to?(en?'Review acquisition-day position':'مراجعة المركز المالي يوم الاستحواذ'):(en?'Review acquisition carry-forward':'مراجعة أثر الاستحواذ في نهاية الفترة')}
  </button></div>
  {result==='loading'?<p role="status">{en?'Verifying the position…':'جارٍ التحقق من المركز المالي…'}</p>:
   result!==null&&(result==='error'||result.status==='ACQUISITION_POSITION_UNAVAILABLE')?
    <p role="status">{en?'Verified acquisition-day adjustments are unavailable for this selection.':'تسويات يوم الاستحواذ المتحقق منها غير متاحة لهذا الاختيار.'}</p>:
   result!==null&&<>
    <div className="fs-page-actions"><button type="button" onClick={()=>void load(true)}>
     {en?'Export adjusted group statements CSV':'تصدير قوائم المجموعة بعد التسويات CSV'}
    </button></div>
    <h4>{result.eliminationBatchVersion!==null||result.inventoryEliminations.length>0?
     (en?'Financial position after acquisition and intercompany eliminations':'المركز المالي بعد تسوية الاستحواذ والاستبعادات بين الشركات'):
     result.status==='ACQUISITION_CARRY_FORWARD_POSITION_REVIEW'?
     (en?'Closing position after carrying forward the acquisition adjustment':'المركز المالي بعد ترحيل تسوية الاستحواذ'):
     (en?'Position after acquisition adjustment':'المركز المالي بعد تسوية الاستحواذ')}</h4>
    <p>{en?'Goodwill':'الشهرة'} {statementAmount(result.goodwill)} · {en?'NCI at acquisition':'حقوق غير المسيطرين عند الاستحواذ'} {statementAmount(result.nciAtAcquisition)} · {result.currency}</p>
    {result.eliminationBatchVersion!==null&&<p>{en?'Approved elimination batch version':'نسخة الاستبعادات المعتمدة'} {result.eliminationBatchVersion}</p>}
    <div className="fs-table-scroll"><table className="fs-table">
     <thead><tr>{(en?['Item','Before adjustments','Adjustment','After adjustments']:
      ['البند','قبل التسويات','التسوية','بعد التسويات']).map(label=><th key={label}>{label}</th>)}</tr></thead>
     <tbody>{result.rows.map(row=><tr key={row.key}><th>{statementLabels[row.key][en?1:0]}</th>
      <td>{statementAmount(row.before)}</td><td>{statementAmount(row.adjustment)}</td><td>{statementAmount(row.after)}</td>
     </tr>)}</tbody>
    </table></div>
    {result.inventoryEliminations.length>0&&<>
     <h4>{en?'Approved inventory margin eliminations':'استبعادات هامش المخزون المعتمدة'}</h4>
     <div className="fs-table-scroll"><table className="fs-table">
      <thead><tr>{(en?['Inventory account','Unrealized margin','Deferred tax asset','After-tax profit reduction']:
       ['حساب المخزون','الربح غير المحقق','أصل الضريبة المؤجلة','تخفيض الربح بعد الضريبة']).map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{result.inventoryEliminations.map(item=>item.deferredTax&&<tr key={item.deferredTax.approvedRecordId}>
       <th>{item.inventoryAccountId}</th><td>{statementAmount(item.inventoryReduction)}</td>
       <td>{statementAmount(item.deferredTax.deferredTaxAssetIncrease)}</td>
       <td>{statementAmount(item.deferredTax.groupAfterTaxProfitReduction)}</td>
      </tr>)}</tbody>
     </table></div>
    </>}
    {result.profitAttribution&&<>
     <h4>{en?'Non-controlling interests after acquisition':'حقوق غير المسيطرين بعد الاستحواذ'}</h4>
     <div className="fs-table-scroll"><table className="fs-table">
      <thead><tr>{(en?['Subsidiary','NCI at acquisition','Adjusted subsidiary result','Result attributed to NCI','Dividends to NCI','Closing NCI']:
       ['الشركة التابعة','حقوق غير المسيطرين عند الاستحواذ','نتيجة التابعة بعد التسويات','حصة غير المسيطرين من النتيجة','حصة غير المسيطرين من التوزيع','حقوق غير المسيطرين في الإقفال']).map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{result.nciAttribution.map(item=><tr key={item.subsidiaryId}>
       <th>{item.subsidiaryName}</th><td>{statementAmount(item.openingNci)}</td><td>{statementAmount(item.adjustedProfit)}</td>
       <td>{statementAmount(item.profitToNci)}</td><td>{statementAmount(item.dividendToNci)}</td><td>{statementAmount(item.closingNci)}</td>
      </tr>)}</tbody>
     </table></div>
     <dl>
      <dt>{en?'Group result attributable to owners of the parent':'نتيجة المجموعة العائدة لملاك الشركة الأم'}</dt>
      <dd>{statementAmount(result.profitAttribution.parent)}</dd>
      <dt>{en?'Group result attributable to non-controlling interests':'نتيجة المجموعة العائدة لحقوق غير المسيطرين'}</dt>
      <dd>{statementAmount(result.profitAttribution.nci)}</dd>
      <dt>{en?'Closing equity attributable to owners of the parent':'حقوق ملاك الشركة الأم في الإقفال'}</dt>
      <dd>{statementAmount(result.closingParentEquity)}</dd>
      <dt>{en?'Total closing non-controlling interests':'إجمالي حقوق غير المسيطرين في الإقفال'}</dt>
      <dd>{statementAmount(result.closingNci)}</dd>
     </dl>
    </>}
    {result.dividendEliminations.length>0&&<>
     <h4>{en?'Declared dividends and internal eliminations':'التوزيعات المعلنة والاستبعادات الداخلية'}</h4>
     <div className="fs-table-scroll"><table className="fs-table">
      <thead><tr>{(en?['Subsidiary','Declaration date','Total declared','Parent share eliminated','Non-controlling share','Internal balance eliminated','Paid to non-controlling owners']:
       ['الشركة التابعة','تاريخ الإعلان','إجمالي التوزيع','حصة الأم المستبعدة','حصة غير المسيطرين','الرصيد الداخلي المستبعد','المدفوع لغير المسيطرين']).map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{result.dividendEliminations.map(item=><tr key={item.subsidiaryId}>
       <th>{item.subsidiaryName}</th><td>{item.date}</td><td>{statementAmount(item.ordinaryDividends)}</td>
       <td>{statementAmount(item.parentDividend)}</td><td>{statementAmount(item.nciDividend)}</td>
       <td>{statementAmount(item.parentOutstanding)}</td><td>{statementAmount(item.minorityCashPaid)}</td>
      </tr>)}</tbody>
     </table></div>
    </>}
    {result.cash.length>0&&<>
     <h4>{result.eliminationBatchVersion!==null?
      (en?'Cash flow after intercompany eliminations':'التدفقات النقدية بعد الاستبعادات بين الشركات'):
      (en?'Cash flow after eliminating internal dividend payments':'التدفقات بعد استبعاد سداد التوزيعات الداخلية')}</h4>
     <div className="fs-table-scroll"><table className="fs-table">
      <thead><tr>{(en?['Item','Before adjustment','Adjustment','After adjustment']:
       ['البند','قبل التسوية','التسوية','بعد التسوية']).map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{result.cash.map(row=><tr key={row.key}><th>{statementLabels[row.key][en?1:0]}</th>
       <td>{statementAmount(row.before)}</td><td>{statementAmount(row.adjustment)}</td><td>{statementAmount(row.after)}</td>
      </tr>)}</tbody>
     </table></div>
    </>}
    {result.deferredTaxAdjustments.length>0&&<>
     <h4>{en?'Acquisition deferred tax reversal':'عكس الضريبة المؤجلة على فرق الاستحواذ'}</h4>
     <div className="fs-table-scroll"><table className="fs-table">
      <thead><tr>{(en?['Subsidiary','Liability account','Opening liability','Period reversal','Remaining liability']:
       ['الشركة التابعة','حساب الالتزام','الالتزام عند الاستحواذ','المبلغ المعكوس خلال الفترة','الالتزام المتبقي']).map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{result.deferredTaxAdjustments.map(item=><tr key={item.subsidiaryId+':'+item.accountId}>
       <th>{item.subsidiaryName}</th><td>{item.accountId}</td><td>{statementAmount(item.openingLiability)}</td>
       <td>{statementAmount(item.reversal)}</td><td>{statementAmount(item.remainingLiability)}</td>
      </tr>)}</tbody>
     </table></div>
    </>}
    {(result.eliminationBatchVersion!==null||result.depreciationAdjustments.length>0||result.dividendEliminations.length>0||result.inventoryEliminations.length>0)&&<>
     {result.depreciationAdjustments.length>0&&<><h4>{en?'Depreciation of acquisition uplift':'إهلاك فرق القيمة العادلة عند الاستحواذ'}</h4>
     <div className="fs-table-scroll"><table className="fs-table">
      <thead><tr>{(en?['Subsidiary','Account','Useful life (days)','Period depreciation','Remaining uplift']:
       ['الشركة التابعة','الحساب','العمر الإنتاجي بالأيام','إهلاك الفترة','الفرق المتبقي']).map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{result.depreciationAdjustments.map(item=><tr key={item.subsidiaryId+':'+item.accountId}>
       <th>{item.subsidiaryName}</th><td>{item.accountId}</td><td>{item.usefulLifeDays}</td>
       <td>{statementAmount(item.charge)}</td><td>{statementAmount(item.remainingUplift)}</td>
      </tr>)}</tbody>
     </table></div>
     </>}
     <h4>{result.eliminationBatchVersion!==null?
      (en?'Income after acquisition and intercompany eliminations':'قائمة الدخل بعد تسوية الاستحواذ والاستبعادات بين الشركات'):
      (en?'Impact on the period result':'أثر التسوية على نتيجة الفترة')}</h4>
     <div className="fs-table-scroll"><table className="fs-table">
      <thead><tr>{(en?['Item','Before adjustment','Adjustment','After adjustment']:
       ['البند','قبل التسوية','التسوية','بعد التسوية']).map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{result.income.map(row=><tr key={row.key}><th>{statementLabels[row.key][en?1:0]}</th>
       <td>{statementAmount(row.before)}</td><td>{statementAmount(row.adjustment)}</td><td>{statementAmount(row.after)}</td>
      </tr>)}</tbody>
     </table></div>
    </>}
    {result.fairValueAdjustments.length>0&&<>
     <h4>{en?'Acquisition-date fair value adjustments':'تسويات القيمة العادلة يوم الاستحواذ'}</h4>
     <div className="fs-table-scroll"><table className="fs-table">
      <thead><tr>{(en?['Subsidiary','Account','Type','Book amount','Recognized amount','Adjustment']:
       ['الشركة التابعة','الحساب','النوع','القيمة الدفترية','القيمة المعتمدة','التسوية']).map(label=><th key={label}>{label}</th>)}</tr></thead>
      <tbody>{result.fairValueAdjustments.map(item=><tr key={item.subsidiaryId+':'+item.accountId}>
       <th>{item.subsidiaryName}</th><td>{item.accountId}</td>
       <td>{item.kind==='ASSET'?(en?'Asset':'أصل'):(en?'Liability':'التزام')}</td>
       <td>{statementAmount(item.bookValue)}</td><td>{statementAmount(item.recognizedValue)}</td><td>{statementAmount(item.adjustment)}</td>
      </tr>)}</tbody>
     </table></div>
    </>}
   </>}
 </div>;
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
    {review.rows.some(row=>row.investmentAccountId&&row.calculation.acquisitionDate===review.query.from&&
      (review.query.from===review.query.to||row.continuityDocumented))&&
     <AcquisitionPositionReview key={review.rows.map(row=>row.id).join(':')} query={review.query} en={en}/>}
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
   downloadCsv(csv,`group-review-${organization}-${from}-${to}-v${body.approval.version}.csv`);
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
