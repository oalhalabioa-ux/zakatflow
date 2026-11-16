'use client';
import {useState,type FormEvent} from 'react';
export default function JoinInvitationPanel({locale}:{locale:string}){
 const ar=locale==='ar',t=(a:string,b:string)=>ar?a:b;
 const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState(''),[error,setError]=useState('');
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy||!code)return;
  setBusy(true);setError('');setResult('');
  try{
   const response=await fetch('/api/feasibility/invitations/accept',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:code.trim()})
   });
   if(!response.ok)throw Error('INVITATION_DENIED');
   setCode('');
   window.dispatchEvent(new Event('feasibility:invitation-accepted'));
   setResult(t('تم قبول الدعوة؛ ستظهر الدراسة في قائمة «المشتركة معي» دون تغيير دراساتك الشخصية.','Invitation accepted. The project will appear in Shared with me without altering your personal drafts.'));
  }catch{setError(t('رمز غير صالح أو منتهي أو ليس لبريد حسابك المؤكد.','Invalid/expired code, or code does not match your confirmed account email.'))}
  finally{setBusy(false)}
 }
 return <form className="fs-collaboration fs-join" onSubmit={submit}>
  <label className="fs-field"><span>{t('لديك رمز دعوة لدراسة؟','Have a project invitation code?')}</span><input dir="ltr" value={code} onChange={e=>setCode(e.currentTarget.value)} required minLength={40} maxLength={60} placeholder={t('ألصق رمز الدعوة','Paste invitation code')} autoComplete="off"/></label>
  <button className="fs-btn fs-btn--secondary" type="submit" disabled={!code||busy}>{busy?t('جارٍ التحقق…','Verifying…'):t('قبول الدعوة','Accept invitation')}</button>
  {result&&<p role="status" className="fs-handoff-note">{result}</p>}
  {error&&<p role="alert" className="fs-handoff-note">{error}</p>}
 </form>;
}
