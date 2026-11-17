'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {collaboratorPermissions} from '@/lib/feasibility/collaboration';
import {RoyalIcon} from './RoyalIcon';
type Invitation={id:string;invitee_email:string;role:'VIEWER'|'REVIEWER';expires_at:string;accepted_at:string|null;revoked_at:string|null};
type Member={user_id:string;role:string;status:string};
export default function CollaborationPanel({locale,projectId,enabled,isOwner,canWrite,audit=false}:{
 locale:string;projectId:string;enabled:boolean;isOwner:boolean;canWrite:boolean;audit?:boolean;
}){
 const ar=locale==='ar',t=(a:string,b:string)=>ar?a:b;
 const invitationDialog=useRef<HTMLDialogElement>(null);
 const [email,setEmail]=useState('');
 const [role,setRole]=useState<'VIEWER'|'REVIEWER'>('VIEWER');
 const emailDeliveryAvailable=process.env.NEXT_PUBLIC_FEASIBILITY_EMAIL_INVITES_QA==='true';
 const [delivery,setDelivery]=useState<'MANUAL'|'EMAIL'>('MANUAL');
 const [code,setCode]=useState('');
 const [expiry,setExpiry]=useState('');
 const [invites,setInvites]=useState<Invitation[]>([]);
 const [members,setMembers]=useState<Member[]>([]);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const load=useCallback(async(signal?:AbortSignal)=>{
  if(!enabled||!isOwner)return;
  const response=await fetch('/api/feasibility/invitations?project_id='+encodeURIComponent(projectId),{cache:'no-store',signal});
  if(!response.ok)throw Error('LIST_FAILED');
  const data=await response.json();
  if(!Array.isArray(data.invitations)||!Array.isArray(data.members))throw Error('LIST_FAILED');
  if(!signal?.aborted){setInvites(data.invitations);setMembers(data.members);}
 },[enabled,isOwner,projectId]);
 useEffect(()=>{
  if(!enabled||!isOwner)return;
  const controller=new AbortController();
  setLoading(true);
  void load(controller.signal).catch(()=>{
   if(!controller.signal.aborted)setError(t('تعذر تحميل سجل المشاركين.','Could not load participants.'));
  }).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[load,enabled,isOwner,ar]);
 async function revokeInvitation(invitationId:string){
  if(!enabled||!isOwner||!canWrite||busy)return;
  if(!window.confirm(t('إبطال رمز الدعوة المعلّقة نهائيًا؟','Invalidate this pending invitation code?')))return;
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/feasibility/invitations',{
    method:'PATCH',headers:{'content-type':'application/json'},
    body:JSON.stringify({projectId,invitationId})
   });
   if(!response.ok)throw new Error('INVITE_REVOCATION_FAILED');
   setNotice(t('تم إبطال الدعوة ولم يعد رمزها مقبولًا.','Invitation revoked; its code is no longer valid.'));
   await load();
  }catch{setError(t('لم نتمكن من تأكيد إبطال الدعوة.','Could not confirm invitation revocation.'))}
  finally{setBusy(false)}
 }
 async function revokeMember(userId:string){
  if(!enabled||!isOwner||!canWrite||busy)return;
  if(!window.confirm(t('إلغاء وصول هذا المشارك إلى الدراسة؟','Revoke this participant\'s access to the study?')))return;
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch('/api/feasibility/members/revoke',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({projectId,userId})
   });
   if(!response.ok)throw new Error('REVOKE_FAILED');
   setNotice(t('تم إلغاء صلاحية المشارك.','Participant access revoked.'));
   await load();
  }catch{setError(t('تعذر إلغاء العضوية؛ لم نعتبرها ملغاة.','Revocation could not be confirmed. Access has not been marked revoked.'))}
  finally{setBusy(false)}
 }
 async function invite(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!enabled||!isOwner||!canWrite||busy)return;
  setBusy(true);setError('');setNotice('');setCode('');
  try{
   const res=await fetch('/api/feasibility/invitations',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({projectId,email:email.trim(),role,delivery:emailDeliveryAvailable?delivery:'MANUAL',locale})
   });
   if(!res.ok)throw Error('INVITE_FAILED');
   const data=await res.json() as {code?:string;expires_at:string;delivery?:'EMAIL'|'MANUAL'};
   if(data.delivery==='EMAIL'){
    setCode('');setExpiry(data.expires_at);
    setNotice(t('قبل مزود البريد طلب إرسال الدعوة. تحقق من وصولها إلى المدعو قبل اعتبارها مكتملة.','Email provider accepted the invitation request. Confirm receipt before treating delivery as complete.'));
   }else{
    if(!data.code)throw Error('INVITE_FAILED');
    setCode(data.code);setExpiry(data.expires_at);
    setNotice(t('أنشئت الدعوة. انسخ الرمز وأرسله للشخص المحدد بشكل آمن؛ لن يُعرض مرة أخرى.','Invitation created. Copy the code and share it privately with the intended recipient; it will not be shown again.'));
   }
   setEmail('');invitationDialog.current?.close();await load();
  }catch{setError(t('تعذر إنشاء الدعوة. تأكد من ملكيتك للمشروع وصلاحية الاشتراك.','Unable to create invitation. Check project ownership and subscription access.'))}
  finally{setBusy(false)}
 }
 const roleLabel=(value:string)=>value==='VIEWER'?t('مشاهد','Viewer'):
  value==='REVIEWER'?t('مراجع','Reviewer'):value==='EDITOR'?t('محرر','Editor'):value;
 const active=members.filter(member=>member.status==='ACTIVE');
 const pending=invites.filter(invite=>!invite.accepted_at&&!invite.revoked_at&&Date.parse(invite.expires_at)>Date.now());
 const matrix=<section className="card fs-panel">
  <h3 className="fs-royal-report-title"><RoyalIcon name="check"/>{t('صلاحيات أدوار الدعوة','Invitation role permissions')}</h3>
  <div className="fs-table-wrap"><table className="fs-table fs-royal-access-table">
   <thead><tr>{[t('الدور','Role'),t('الاطلاع','View'),t('المراجعة','Review'),t('التعديل','Edit')].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
   <tbody>{(['VIEWER','REVIEWER'] as const).map(value=>{
    const permission=collaboratorPermissions(value,'ACTIVE');
    return <tr key={value}><th scope="row">{roleLabel(value)}</th>
     {[permission.canRead,permission.canReview,permission.canEdit].map((allowed,index)=>
      <td key={index}>{allowed?t('مسموح','Allowed'):t('غير متاح','Unavailable')}</td>)}
    </tr>;
   })}</tbody>
  </table></div>
 </section>;
 return <section className="card fs-panel fs-collaboration fs-royal-participants">
  <h3>{audit?t('الصلاحيات وحالات الدعوات','Permissions and invitation status'):t('المشاركون في دراسة المشروع','Project study collaborators')}</h3>
  <p className="fs-hint">{emailDeliveryAvailable?
   t('دعوات تجريبية مرتبطة ببريد مؤكد، مع خيار الإرسال المباشر عند تفعيل مزود البريد على الخادم.','QA invitations require verified recipient emails; direct delivery also requires an enabled server mail provider.'):
   t('دعوات تجريبية برموز يرسلها المالك يدويًا. صلاحية الإضافة والتعديل والإرسال بالبريد غير مفعّلة بعد.','QA invitations currently use manually delivered one-time codes. Contributor/editor and automatic email delivery remain disabled.')}</p>
  {!enabled?<p>{t('مشاركة المشاريع غير مفعلة في هذه المعاينة.','Project sharing is disabled in this preview.')}</p>:
   !isOwner?<p>{t('يمكن لمالك المشروع فقط إنشاء الدعوات وإدارتها.','Only the project owner can issue and manage invitations.')}</p>:
   <>
    {loading?<p role="status">{t('جارٍ تحميل المشاركين والدعوات…','Loading participants and invitations…')}</p>:
     <div className="fs-royal-stats"><span>{t('العضويات المفعلة','Active memberships')}: {active.length}</span>
      <span>{t('دعوات بانتظار القبول','Pending invitations')}: {pending.length}</span></div>}
    {!audit&&<div className="fs-actions"><button type="button" className="fs-btn" disabled={!canWrite||busy}
     onClick={()=>{setError('');invitationDialog.current?.showModal()}}><RoyalIcon name="plus"/>{t('دعوة مشارك','Invite participant')}</button></div>}
    <dialog ref={invitationDialog} className="fs-dialog fs-royal-dialog" aria-labelledby="fs-invite-title"
     onCancel={event=>{if(busy)event.preventDefault()}}>
     <div className="fs-royal-heading"><h2 id="fs-invite-title"><RoyalIcon name="users"/>{t('دعوة مشارك إلى الدراسة','Invite a study participant')}</h2>
      <button type="button" className="fs-royal-close" disabled={busy} onClick={()=>invitationDialog.current?.close()}
       aria-label={t('إغلاق','Close')}>×</button></div>
     <form onSubmit={invite}>
      <p className="fs-hint">{t('ترتبط الدعوة بالبريد المحدد وتنتهي بعد ستة أيام من إنشائها.',
       'The invitation is tied to the specified email and expires six days after creation.')}</p>
      <div className="fs-form-grid">
     <label className="fs-field"><span>{t('البريد الإلكتروني للمشارك','Participant email')}</span><input type="email" required value={email} onChange={e=>setEmail(e.currentTarget.value)} maxLength={254} disabled={!canWrite||busy}/></label>
     <label className="fs-field"><span>{t('الصلاحية','Role')}</span><select value={role} onChange={e=>setRole(e.currentTarget.value as 'VIEWER'|'REVIEWER')} disabled={!canWrite||busy}>
      <option value="VIEWER">{roleLabel('VIEWER')}</option><option value="REVIEWER">{roleLabel('REVIEWER')}</option>
     </select></label>
     {emailDeliveryAvailable&&<label className="fs-field"><span>{t('طريقة الدعوة','Delivery method')}</span>
      <select value={delivery} onChange={e=>setDelivery(e.currentTarget.value as 'EMAIL'|'MANUAL')}
       disabled={!canWrite||busy}>
       <option value="MANUAL">{t('رمز يدوي','Manual one-time code')}</option>
       <option value="EMAIL">{t('دعوة بالبريد الإلكتروني','Send via email')}</option>
      </select>
     </label>}
      </div>
      <p className="fs-hint">{role==='REVIEWER'
       ?t('يستطيع المراجع الاطلاع وتسجيل المراجعة.','A reviewer can view and submit a review.')
       :t('يستطيع المشاهد الاطلاع على الدراسة.','A viewer can view the study.')}</p>
      {error&&<p role="alert">{error}</p>}
      <div className="fs-actions">
       <button className="fs-btn" type="submit" disabled={!canWrite||busy}>{busy?t('جارٍ الإنشاء…','Creating…'):t('إنشاء دعوة','Create invitation')}</button>
       <button className="fs-btn fs-btn--secondary" type="button" disabled={busy}
        onClick={()=>invitationDialog.current?.close()}>{t('إلغاء','Cancel')}</button>
      </div>
     </form>
    </dialog>
    {code&&<div className="fs-collaboration">
     <strong>{t('رمز الدعوة لمرة واحدة','One-time invitation code')}</strong>
     <code dir="ltr">{code}</code>
     <div className="fs-collaboration-actions"><button type="button" className="fs-btn fs-btn--secondary" onClick={()=>void navigator.clipboard.writeText(code).then(()=>setNotice(t('تم نسخ الرمز.','Code copied.'))).catch(()=>setError(t('انسخ الرمز يدويًا من النص أعلاه.','Copy the code manually above.')))}>{t('نسخ الرمز','Copy code')}</button>
      <small>{t('ينتهي في','Expires')} {new Date(expiry).toLocaleDateString(ar?'ar-SA-u-nu-latn':'en-GB')}</small></div>
    </div>}
    {audit&&matrix}
    <section className="card fs-panel">
    <h3 className="fs-royal-report-title"><RoyalIcon name="file"/>{t('الدعوات الصادرة','Issued invitations')}</h3>
    <div className="fs-collaboration-list">{invites.length?invites.map(i=><div className="fs-collaboration-row" key={i.id}>
     <strong><bdi>{i.invitee_email}</bdi></strong><span>{roleLabel(i.role)}</span>
     <span>{i.accepted_at?t('مقبولة','Accepted'):i.revoked_at?t('ملغاة','Revoked'):new Date(i.expires_at)<=new Date()?t('منتهية','Expired'):t('بانتظار القبول','Pending')}</span>
     <time dateTime={i.expires_at}>{new Date(i.expires_at).toLocaleDateString(ar?'ar-SA-u-ca-gregory':'en-GB')}</time>
     {pending.includes(i)&&<button
       className="fs-btn fs-btn--secondary" type="button" disabled={!canWrite||busy}
       onClick={()=>void revokeInvitation(i.id)}>{t('إبطال الدعوة','Revoke invitation')}</button>}
    </div>):!loading&&!error&&<p>{t('لا توجد دعوات بعد.','No invitations yet.')}</p>}</div>
    </section>
    <div className="fs-royal-profile-grid">
    <section className="card fs-panel">
    <h3 className="fs-royal-report-title"><RoyalIcon name="users"/>{t('إدارة صلاحيات المشاركين','Manage member access')}</h3>
    {!loading&&!error&&active.length===0&&<p>{t('لا توجد عضويات مفعّلة.','There are no active memberships.')}</p>}
    {active.map(member=><div className="fs-collaboration-row" key={member.user_id}>
     <span dir="ltr">{member.user_id}</span><span>{roleLabel(member.role)}</span>
     <button className="fs-btn fs-btn--secondary" type="button" disabled={!canWrite||busy}
      onClick={()=>void revokeMember(member.user_id)}>{t('إلغاء الوصول','Revoke access')}</button>
    </div>)}
    </section>
    {!audit&&matrix}
    </div>
   </>}
  {notice&&<p role="status" className="fs-handoff-note">{notice}</p>}
  {error&&<p role="alert" className="fs-handoff-note">{error}</p>}
 </section>;
}
