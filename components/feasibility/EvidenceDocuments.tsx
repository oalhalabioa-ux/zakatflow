'use client';

import {useEffect,useState} from 'react';
import {RoyalIcon} from './RoyalIcon';

type Document={id:string;name:string;size:number;createdAt:string;requirementId:string|null};
type Requirement={id:string;title:string};

export default function EvidenceDocuments({locale,project,organization,kind,saved,canWrite,requirements}:{
 locale:string;project:string;organization?:string;kind:'licensing'|'valuation';saved:boolean;canWrite:boolean;requirements:Requirement[];
}){
 const ar=locale==='ar';
 const l=(arText:string,enText:string)=>ar?arText:enText;
 const [documents,setDocuments]=useState<Document[]>([]);
 const [requirement,setRequirement]=useState('');
 const [version,setVersion]=useState(0);
 const [busy,setBusy]=useState(false);
 const [loadState,setLoadState]=useState<'loading'|'ready'|'unavailable'|'failed'>('loading');
 const loading=loadState==='loading';
 const [error,setError]=useState('');
 const params=new URLSearchParams({project,kind});
 if(organization)params.set('organization',organization);
 const endpoint='/api/feasibility/evidence?'+params;
 useEffect(()=>{
  if(!saved)return;
  const controller=new AbortController();
  setLoadState('loading');
  setDocuments([]);
  fetch(endpoint,{signal:controller.signal}).then(async response=>{
   if(controller.signal.aborted)return;
   if(response.status===404){
    setLoadState('unavailable');
    return;
   }
   if(!response.ok)throw new Error('EVIDENCE_LIST_FAILED');
   const list=await response.json();
   if(!controller.signal.aborted){
    setDocuments(list);
    setLoadState('ready');
   }
  }).catch(()=>{
   if(!controller.signal.aborted)setLoadState('failed');
  });
  return ()=>controller.abort();
 },[endpoint,saved,version]);

 async function change(method:'POST'|'DELETE',file?:File,documentId?:string){
  setBusy(true);
  setError('');
  try{
   const body=file?new FormData():undefined;
   if(file){
    body?.set('file',file);
    if(kind==='licensing'&&requirement)body?.set('requirement',requirement);
   }
   const response=await fetch(endpoint+(documentId?'&document='+encodeURIComponent(documentId):''),{method,body});
   if(!response.ok){
    const failure=await response.json().catch(()=>null);
    if(failure?.error==='EVIDENCE_LIMIT'){
     setError(l('وصلت الدراسة إلى حد 20 مستندًا.','This study has reached the 20-document limit.'));
     return;
    }
    if(failure?.error==='INVALID_REQUIREMENT'){
     setError(l('احفظ متطلب الترخيص في الدراسة أولًا أو اختر متطلبًا محفوظًا.','Save the licensing requirement in the study first or choose a saved requirement.'));
     return;
    }
    if(failure?.error==='INVALID_FILE'){
     setError(l('اختر ملف PDF أو PNG أو JPEG صالحًا حتى 2 ميغابايت.','Choose a valid PDF, PNG or JPEG file up to 2 MB.'));
     return;
    }
    throw new Error('EVIDENCE_WRITE_FAILED');
   }
   setLoadState('loading');
   setVersion(value=>value+1);
  }catch{
   setError(l('تعذر تحديث الملفات. تحقق من حالة الحفظ وصلاحيتك.','Could not update the files. Check that the study is saved and you have permission.'));
  }finally{setBusy(false)}
 }

 const documentLink=(item:Document)=><a href={endpoint+'&document='+encodeURIComponent(item.id)} download={item.name}>{item.name}</a>;
 const documentSize=(item:Document)=>new Intl.NumberFormat(locale,{style:'unit',unit:'kilobyte',maximumFractionDigits:1}).format(item.size/1000);
 const documentDate=(item:Document)=>new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(item.createdAt));
 const removeDocument=(item:Document)=><button type="button" className="fs-btn fs-btn--secondary" disabled={busy}
  aria-label={l('إزالة المستند','Remove document')+' '+item.name}
  onClick={()=>{
   if(window.confirm(l('إزالة هذا المستند من الدراسة؟','Remove this document from the study?')))void change('DELETE',undefined,item.id);
  }}>{l('إزالة','Remove')}</button>;

 return <section className="card fs-panel fs-royal-evidence-files">
  <h3 className="fs-royal-report-title"><RoyalIcon name="file"/>{kind==='licensing'?
   l('مرفقات التراخيص','Licence attachments'):l('مستندات التقييم','Valuation documents')}</h3>
  {!saved?<p className="fs-hint">{l('احفظ الدراسة في السحابة لإرفاق الملفات.','Save the study to the cloud to attach files.')}</p>:
   loading?<p role="status">{l('جارٍ تحميل المستندات…','Loading documents…')}</p>:
   loadState==='unavailable'?<p className="fs-hint">{l('المرفقات غير متاحة في نطاق هذه الدراسة.','Attachments are unavailable in this study’s scope.')}</p>:
   loadState==='failed'?<div className="fs-actions">
    <p role="alert">{l('تعذر تحميل المستندات.','Could not load documents.')}</p>
    <button type="button" className="fs-btn fs-btn--secondary" onClick={()=>setVersion(value=>value+1)}>
     {l('إعادة المحاولة','Retry')}
    </button>
   </div>:<>
   {!error&&!documents.length&&<p>{l('لا توجد ملفات مرفقة.','No files attached.')}</p>}
   {documents.length>0&&(kind==='valuation'?<div className="fs-table-wrap fs-royal-valuation-documents">
    <table className="fs-table" aria-label={l('مستندات التقييم المرفقة','Attached valuation documents')}>
     <thead><tr><th scope="col">{l('المستند','Document')}</th><th scope="col">{l('تاريخ الإرفاق','Date added')}</th>
      <th scope="col">{l('الحجم','Size')}</th>{canWrite&&<th scope="col">{l('الإجراء','Action')}</th>}</tr></thead>
     <tbody>{documents.map(item=><tr key={item.id}>
      <th scope="row">{documentLink(item)}</th><td><bdi>{documentDate(item)}</bdi></td><td>{documentSize(item)}</td>
      {canWrite&&<td>{removeDocument(item)}</td>}
     </tr>)}</tbody>
    </table>
   </div>:<ul className="fs-royal-checks">{documents.map(item=><li key={item.id}>
    <div>{documentLink(item)}<small>{documentSize(item)}{' · '}{documentDate(item)}</small>
     {item.requirementId&&<small>{requirements.find(row=>row.id===item.requirementId)?.title ??
      l('لم يعد المتطلب موجودًا في السجل','Requirement no longer in the register')}</small>}</div>
    {canWrite&&removeDocument(item)}
   </li>)}</ul>)}
   {canWrite&&kind==='licensing'&&requirements.length>0&&<label className="fs-field">
    <span>{l('ربط المرفق بمتطلب','Link attachment to requirement')}</span>
    <select value={requirement} disabled={busy} onChange={event=>setRequirement(event.currentTarget.value)}>
     <option value="">{l('مرفق عام للدراسة','General study attachment')}</option>
     {requirements.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}
    </select>
   </label>}
   {canWrite&&<div className="fs-actions"><label className="fs-btn fs-btn--secondary fs-upload">
    {l('إرفاق ملف','Attach file')}
    <input type="file" aria-label={l('إرفاق ملف','Attach file')} accept="application/pdf,image/png,image/jpeg"
     disabled={busy} onChange={event=>{
      const file=event.currentTarget.files?.[0];
      event.currentTarget.value='';
      if(file)void change('POST',file);
     }}/></label><small>{l('PDF أو PNG أو JPEG، حتى 2 ميغابايت','PDF, PNG or JPEG up to 2 MB')}</small></div>}
   {busy&&<p role="status">{l('جارٍ تحديث الملفات…','Updating files…')}</p>}
   {error&&<p role="alert">{error}</p>}
  </>}
 </section>;
}
