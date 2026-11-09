'use client';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
type Invitation={id:string;invitee_email:string;role:'VIEWER'|'REVIEWER';expires_at:string;accepted_at:string|null;revoked_at:string|null};
type Member={user_id:string;role:string;status:string};
export default function CollaborationPanel({locale,projectId,enabled,isOwner,canWrite}:{
 locale:string;projectId:string;enabled:boolean;isOwner:boolean;canWrite:boolean;
}){
 const ar=locale==='ar',t=(a:string,b:string)=>ar?a:b;
 const [email,setEmail]=useState('');
 const [role,setRole]=useState<'VIEWER'|'REVIEWER'>('VIEWER');
 const [code,setCode]=useState('');
 const [expiry,setExpiry]=useState('');
 const [invites,setInvites]=useState<Invitation[]>([]);
 const [members,setMembers]=useState<Member[]>([]);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const load=useCallback(async()=>{
  if(!enabled||!isOwner)return;
  const response=await fetch('/api/feasibility/invitations?project_id='+encodeURIComponent(projectId),{cache:'no-store'});
  if(!response.ok)throw Error('LIST_FAILED');
  const data=await response.json();
  if(!Array.isArray(data.invitations)||!Array.isArray(data.members))throw Error('LIST_FAILED');
  setInvites(data.invitations);setMembers(data.members);
 },[enabled,isOwner,projectId]);
 useEffect(()=>{
  if(!enabled||!isOwner)return;
  let mounted=true;
  void load().catch(()=>{if(mounted)setError(t('تعذر تحميل سجل المشاركين.','Could not load participants.'))});
  return()=>{mounted=false};
 },[load,enabled,isOwner,ar]);
 async function invite(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!enabled||!isOwner||!canWrite||busy)return;
  setBusy(true);setError('');setNotice('');setCode('');
  try{
   const res=await fetch('/api/feasibility/invitations',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({projectId,email:email.trim(),role})
   });
   if(!res.ok)throw Error('INVITE_FAILED');
   const data=await res.json() as {code:string;expires_at:string};
   if(!data.code)throw Error('INVITE_FAILED');
   setCode(data.code);setExpiry(data.expires_at);
   setNotice(t('أنشئت الدعوة. انسخ الرمز وأرسله للشخص المحدد بشكل آمن؛ لن يُعرض مرة أخرى.','Invitation created. Copy the code and share it privately with the intended recipient; it will not be shown again.'));
   setEmail('');await load();
  }catch{setError(t('تعذر إنشاء الدعوة. تأكد من ملكيتك للمشروع وصلاحية الاشتراك.','Unable to create invitation. Check project ownership and subscription access.'))}
  finally{setBusy(false)}
 }
 return <section className="card fs-panel fs-collaboration">
  <h3>{t('المشاركون في دراسة المشروع','Project study collaborators')}</h3>
  <p className="fs-hint">{t('دعوات تجريبية برموز مؤقتة مرتبطة ببريد مؤكد. المشاركة للعرض والمراجعة فقط؛ لا يوجد إرسال بريد آلي أو اعتماد محاسبي.','QA-only temporary codes tied to verified email. Shared access is view/review only; no automated email or financial approval.')}</p>
  {!enabled?<p>{t('مشاركة المشاريع غير مفعلة في هذه المعاينة.','Project sharing is disabled in this preview.')}</p>:
   !isOwner?<p>{t('يمكن لمالك المشروع فقط إنشاء الدعوات وإدارتها.','Only the project owner can issue and manage invitations.')}</p>:
   <>
    <form onSubmit={invite} className="fs-collaboration-grid">
     <label className="fs-field"><span>{t('البريد الإلكتروني للمشارك','Participant email')}</span><input type="email" required value={email} onChange={e=>setEmail(e.currentTarget.value)} maxLength={254} disabled={!canWrite||busy}/></label>
     <label className="fs-field"><span>{t('الصلاحية','Role')}</span><select value={role} onChange={e=>setRole(e.currentTarget.value as 'VIEWER'|'REVIEWER')} disabled={!canWrite||busy}>
      <option value="VIEWER">{t('مشاهد','Viewer')}</option><option value="REVIEWER">{t('مراجع','Reviewer')}</option>
     </select></label>
     <button className="fs-btn" type="submit" disabled={!canWrite||busy}>{busy?t('جارٍ الإنشاء…','Creating…'):t('إنشاء دعوة','Create invitation')}</button>
    </form>
    {code&&<div className="fs-collaboration">
     <strong>{t('رمز الدعوة لمرة واحدة','One-time invitation code')}</strong>
     <code dir="ltr">{code}</code>
     <div className="fs-collaboration-actions"><button type="button" className="fs-btn fs-btn--secondary" onClick={()=>void navigator.clipboard.writeText(code).then(()=>setNotice(t('تم نسخ الرمز.','Code copied.'))).catch(()=>setError(t('انسخ الرمز يدويًا من النص أعلاه.','Copy the code manually above.')))}>{t('نسخ الرمز','Copy code')}</button>
      <small>{t('ينتهي في','Expires')} {new Date(expiry).toLocaleDateString(ar?'ar-SA-u-nu-latn':'en-GB')}</small></div>
    </div>}
    <h3>{t('الدعوات الصادرة','Issued invitations')}</h3>
    <div className="fs-collaboration-list">{invites.length?invites.map(i=><div className="fs-collaboration-row" key={i.id}>
     <strong>{i.invitee_email}</strong><span>{i.role==='REVIEWER'?t('مراجع','Reviewer'):t('مشاهد','Viewer')}</span>
     <span>{i.accepted_at?t('مقبولة','Accepted'):i.revoked_at?t('ملغاة','Revoked'):new Date(i.expires_at)<=new Date()?t('منتهية','Expired'):t('بانتظار القبول','Pending')}</span>
    </div>):<p>{t('لا توجد دعوات بعد.','No invitations yet.')}</p>}</div>
    <p className="fs-handoff-note">{t('العضويات المفعلة','Active memberships')}: {members.filter(m=>m.status==='ACTIVE').length}</p>
   </>}
  {notice&&<p role="status" className="fs-handoff-note">{notice}</p>}
  {error&&<p role="alert" className="fs-handoff-note">{error}</p>}
 </section>;
}
