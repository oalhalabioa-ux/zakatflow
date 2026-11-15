'use client';
import {useCallback,useEffect,useState} from 'react';
import {handoffReadiness} from '@/lib/feasibility/handoff';
import type {FeasibilityStudy} from '@/lib/feasibility/engine';
type ReviewRow={id:string;source_revision:number;notes:string;created_at:string};
export default function ReviewSnapshotPanel({study,locale,cloudRevision,cloudCurrent,enabled,canWrite}:{
 study:FeasibilityStudy;locale:string;cloudRevision?:number;cloudCurrent:boolean;enabled:boolean;canWrite:boolean;
}){
 const ar=locale==='ar',t=(a:string,b:string)=>ar?a:b;
 const [items,setItems]=useState<ReviewRow[]>([]);
 const [notes,setNotes]=useState('');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [failed,setFailed]=useState(false);
 const load=useCallback(async()=>{
  if(!enabled)return;
  const response=await fetch('/api/feasibility/reviews?project_id='+encodeURIComponent(study.id),{cache:'no-store'});
  if(!response.ok)throw Error('READ_FAILED');
  const rows=await response.json();
  if(!Array.isArray(rows))throw Error('INVALID_REVIEWS');
  setItems(rows);
 },[enabled,study.id]);
 useEffect(()=>{
  let live=true;
  if(!enabled){setItems([]);return;}
  void load().catch(()=>{if(live){setFailed(true);setMessage(t('تعذر تحميل سجل المراجعة.','Review history could not be loaded.'));}});
  return()=>{live=false};
 },[load,enabled,ar]);
 const ready=handoffReadiness(study).ready;
 const canSubmit=enabled&&ready&&canWrite&&cloudCurrent&&typeof cloudRevision==='number'&&!busy;
 const save=async()=>{
  if(!canSubmit||!window.confirm(t('حفظ نسخة داخلية ثابتة من الدراسة المحفوظة على QA V2؟','Save an immutable internal snapshot of the study stored on QA V2?')))return;
  setBusy(true);setMessage('');setFailed(false);
  try{
   const response=await fetch('/api/feasibility/reviews',{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({projectId:study.id,sourceRevision:cloudRevision,notes:notes.trim()})});
   if(!response.ok)throw Error(response.status===409?'CONFLICT':response.status===422?'NOT_READY':'SAVE_FAILED');
   setNotes('');await load();
   setMessage(t('تم تثبيت نسخة مراجعة داخلية في QA V2، دون إنشاء قيود أو اعتماد قانوني.','Internal review snapshot stored in QA V2, without journals or statutory approval.'));
  }catch(e){
   setFailed(true);
   const reason=e instanceof Error?e.message:'';
   setMessage(reason==='CONFLICT'?t('تغيرت نسخة الدراسة على الخادم؛ استرجعها وراجع التعديلات.','The server revision changed. Restore and inspect before reviewing.'):
    reason==='NOT_READY'?t('البيانات المحفوظة غير مكتملة لاجتياز المراجعة.','The saved study does not satisfy the review checks.'):
    t('تعذر تسجيل نسخة المراجعة.','Could not record the internal review.'));
  }finally{setBusy(false)}
 };
 return <div className="fs-review-panel" aria-label={t('نسخ المراجعة','Review snapshots')}>
  <h3>{t('سجل النسخ المعتمدة للمراجعة الداخلية','Internal review snapshot history')}</h3>
  <p className="fs-handoff-note">{t('النسخة ثابتة ولا يمكن تعديلها أو حذفها. وهي توثيق قرار داخلي فقط، وليست اعتمادًا قانونيًا ولا ترحيلًا للمحاسبة.','Snapshots are immutable internal decision records, not legal approval or accounting entries.')}</p>
  <label className="fs-field"><span>{t('ملاحظات الاجتماع أو القرار','Decision notes')}</span>
   <textarea value={notes} maxLength={2000} onChange={e=>setNotes(e.currentTarget.value)} disabled={!canWrite||!enabled} rows={2} placeholder={t('ملخص النقاط التي تمت مراجعتها','Summary of reviewed points')}/></label>
  <button type="button" className="fs-btn" disabled={!canSubmit} onClick={()=>void save()}>{busy?t('جارٍ التسجيل…','Recording…'):t('تثبيت نسخة مراجعة داخلية','Record internal review snapshot')}</button>
  {!cloudCurrent&&enabled&&<p className="fs-handoff-note">{t('احفظ أحدث نسخة من الدراسة في QA V2 قبل تثبيت سجل المراجعة.','Save the latest study revision to QA V2 before recording a snapshot.')}</p>}
  {!enabled&&<p className="fs-handoff-note">{t('التوثيق المركزي غير مفعّل في هذه المعاينة.','Central review records are not enabled in this preview.')}</p>}
  {message&&<p role={failed?'alert':'status'} className="fs-handoff-note">{message}</p>}
  <div className="fs-review-history">{items.length?items.map(item=><div className="fs-review-row" key={item.id}>
   <strong>{t('نسخة','Revision')} {item.source_revision}</strong>
   <span>{new Date(item.created_at).toLocaleDateString(ar?'ar-SA-u-nu-latn':'en-GB',{year:'numeric',month:'short',day:'numeric'})}</span>
   <span>{item.notes||t('دون ملاحظات','No notes')}</span>
  </div>):<p className="fs-handoff-note">{t('لا توجد مراجعات محفوظة حتى الآن.','No saved review snapshots yet.')}</p>}</div>
 </div>;
}
