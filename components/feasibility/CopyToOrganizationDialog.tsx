'use client';

import {useEffect,useRef,useState} from 'react';
import {RoyalIcon} from './RoyalIcon';

type Props={
 locale:string;
 sourceId:string;
 sourceTitle:string;
 revision:number;
 organizationId:string;
 onClose:()=>void;
};

export default function CopyToOrganizationDialog({locale,sourceId,sourceTitle,revision,organizationId,onClose}:Props){
 const ar=locale==='ar';
 const t=(a:string,b:string)=>ar?a:b;
 const dialog=useRef<HTMLDialogElement>(null);
 const request=useRef<AbortController|null>(null);
 const inFlight=useRef(false);
 const [organizationName,setOrganizationName]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [copied,setCopied]=useState(false);
 const [error,setError]=useState('');
 const url='/api/feasibility/organization-projects?action=copy&organization='+encodeURIComponent(organizationId);

 useEffect(()=>{
  if(dialog.current&&!dialog.current.open)dialog.current.showModal();
  const controller=new AbortController();
  void (async()=>{
   try{
    const response=await fetch(url,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('UNAVAILABLE');
    const target=await response.json() as {organizationId?:unknown;organizationName?:unknown};
    if(target.organizationId!==organizationId||typeof target.organizationName!=='string'||!target.organizationName.trim())
     throw Error('INVALID_TARGET');
    if(!controller.signal.aborted)setOrganizationName(target.organizationName);
   }catch{
    if(!controller.signal.aborted)setError(ar?
     'تعذر التحقق من صلاحية النسخ إلى المؤسسة المحددة في البانر.':
     'Copy permission could not be verified for the organization selected in the main banner.');
   }
  })();
  return ()=>{controller.abort();request.current?.abort()};
 },[ar,organizationId,url]);

 const copy=async()=>{
  if(inFlight.current||!organizationName||!confirmed||copied)return;
  inFlight.current=true;
  setBusy(true);
  setError('');
  const controller=new AbortController();
  request.current=controller;
  try{
   const response=await fetch(url,{
    method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sourceId,revision,confirmed:true})
   });
   if(controller.signal.aborted)return;
   if(response.ok){setCopied(true);return}
   const result=await response.json() as {error?:string};
   if(controller.signal.aborted)return;
   if(result.error==='DRAFT_CONFLICT'){
    setError(t('توجد نسخة من هذه الدراسة في المؤسسة المحددة.','A copy of this study already exists in the selected organization.'));
   }else if(result.error==='SOURCE_REVISION_CONFLICT'){
    setError(t('تغيّر الإصدار السحابي للدراسة. تحقق من الإصدار المحفوظ قبل إعادة النسخ.','The saved study version changed. Verify the cloud version before retrying.'));
   }else{
    setError(t('تعذّر النسخ إلى المؤسسة.','Could not copy the study to the organization.'));
   }
  }catch{
   if(!controller.signal.aborted)setError(t('تعذّر تأكيد نتيجة النسخ. تحقق من محفظة المؤسسة.','Could not confirm the copy result. Check the organization portfolio.'));
  }finally{
   inFlight.current=false;
   if(!controller.signal.aborted)setBusy(false);
  }
 };

 return <dialog ref={dialog} className="fs-dialog fs-royal-dialog" aria-labelledby="fs-copy-title" onCancel={e=>{e.preventDefault();if(!busy)onClose()}}>
  <div className="fs-royal-heading"><h2 id="fs-copy-title"><RoyalIcon name="file"/>{t('نسخ دراسة شخصية إلى المؤسسة','Copy a personal study to the organization')}</h2>
   <button type="button" className="fs-royal-close" disabled={busy} onClick={onClose} aria-label={t('إغلاق النافذة','Close dialog')}>×</button>
  </div>
  <dl className="fs-royal-checks">
   <div><dt>{t('الدراسة الشخصية','Personal study')}</dt><dd>{sourceTitle}</dd></div>
   <div><dt>{t('إصدار المصدر','Source revision')}</dt><dd><bdi>{revision}</bdi></dd></div>
   <div><dt>{t('المؤسسة المحددة في البانر','Organization selected in the main banner')}</dt>
    <dd>{organizationName||(!error?t('جارٍ التحقق…','Verifying…'):'—')}</dd></div>
  </dl>
  <p className="fs-hint">{t('تملك المؤسسة النسخة الجديدة. تبقى الدراسة الشخصية في محفظتك.','The organization owns the new copy. The personal study stays in your portfolio.')}</p>
  {!copied&&organizationName&&<label className="fs-check">
   <input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.currentTarget.checked)}/>
   <span>{t('أوافق على نسخ محتوى الدراسة إلى المؤسسة المحددة.','I agree to copy the study content to the selected organization.')}</span>
  </label>}
  {error&&<p role="alert">{error}</p>}
  {copied&&<p role="status">{t('أُضيفت النسخة إلى محفظة المؤسسة.','The copy was added to the organization portfolio.')}</p>}
  <div className="fs-actions">
   {!copied&&<button type="button" className="fs-btn" onClick={()=>void copy()} disabled={!organizationName||!confirmed||busy}>
    {busy?t('جارٍ النسخ…','Copying…'):t('نسخ إلى مؤسسة','Copy to organization')}
   </button>}
   <button type="button" className="fs-btn fs-btn--secondary" onClick={onClose} disabled={busy}>
    {copied?t('إغلاق','Close'):t('إلغاء','Cancel')}
   </button>
  </div>
 </dialog>;
}
