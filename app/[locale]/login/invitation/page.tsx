'use client';
import {use,useEffect,useState,type FormEvent} from 'react';
import './invitation.css';

export default function Invitation({params}:{params:Promise<{locale:string}>}){
 const {locale}=use(params),ar=locale==='ar',t=(a:string,b:string)=>ar?a:b;
 const [link,setLink]=useState({id:'',proof:''}),[email,setEmail]=useState(''),[existing,setExisting]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[organization,setOrganization]=useState('');
 useEffect(()=>{
  const fragment=new URLSearchParams(location.hash.slice(1)),binding={id:fragment.get('id')??'',proof:fragment.get('proof')??''};
  setLink(binding);
  const controller=new AbortController();
  fetch('/api/organizations/invitations/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...binding,action:'inspect'}),signal:controller.signal}).then(async r=>{
   if(!r.ok)throw Error();setEmail((await r.json()).email);
  }).catch(()=>{if(!controller.signal.aborted)setMessage(ar?'تعذر فتح الدعوة. تحقق من صلاحية الرابط أو اطلب دعوة جديدة.':'Unable to open this invitation. Check the link or request a new invitation.');});
  return()=>controller.abort();
 },[ar]);
 useEffect(()=>{
  if(!organization)return;
  const timer=setTimeout(()=>location.replace('/'+locale+'/dashboard?scope=ORGANIZATION&organization='+encodeURIComponent(organization)),1500);
  return()=>clearTimeout(timer);
 },[organization,locale]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;
  const form=new FormData(event.currentTarget),password=String(form.get('password')??'');
  if(!existing&&password!==form.get('confirm')){setMessage(t('كلمتا المرور غير متطابقتين.','Passwords do not match.'));return;}
  setBusy(true);setMessage('');
  try{
   const r=await fetch('/api/organizations/invitations/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...link,action:existing?'signin':'activate',password})}),result=await r.json();
   if(r.ok){history.replaceState(null,'',location.pathname);setOrganization(result.organization);return;}
   if(result.error==='EXISTING'){setExisting(true);setMessage(t('لهذا البريد حساب سابق. أدخل كلمة مروره الحالية لقبول الدعوة.','This account already exists. Enter its current password to join.'));return;}
   setMessage(result.error==='PASSWORD'?t('استخدم 12 إلى 128 حرفًا، تشمل حروفًا وأرقامًا.','Use 12–128 characters including letters and numbers.'):result.error==='LOGIN'?t('تعذر تسجيل الدخول. تحقق من كلمة المرور.','Sign-in failed. Check your password.'):t('تعذر قبول الدعوة. تحقق من صلاحيتها ثم أعد المحاولة.','Unable to accept the invitation. Check its validity and retry.'));
  }catch{setMessage(t('تعذر الاتصال. أعد المحاولة.','Connection failed. Please retry.'));}finally{setBusy(false);}
 }
 return <main className="invitation-entry" dir={ar?'rtl':'ltr'}><section><strong>{t('يقين الأعمال','Yaqeen Business')}</strong><h1>{t('دعوة للانضمام إلى المؤسسة','Organization invitation')}</h1>
 {organization?<p role="status">{t('تم تفعيل حسابك وقبول الدعوة','Your account is active and the invitation has been accepted.')}</p>:<>{email&&<form onSubmit={submit} key={String(existing)}><label>{t('البريد المدعو','Invited email')}<input type="email" dir="ltr" value={email} readOnly/></label><label>{existing?t('كلمة المرور الحالية','Current password'):t('كلمة المرور','Password')}<input name="password" type="password" autoComplete={existing?'current-password':'new-password'} required maxLength={128}/></label>{!existing&&<label>{t('تأكيد كلمة المرور','Confirm password')}<input name="confirm" type="password" autoComplete="new-password" required/></label>}<button disabled={busy}>{existing?t('تسجيل الدخول وقبول الدعوة','Sign in and accept invitation'):t('تفعيل حسابي والانضمام للمؤسسة','Activate my account and join the organization')}</button><button type="button" disabled={busy} onClick={()=>{setExisting(!existing);setMessage('');}}>{existing?t('إنشاء حساب جديد','Create a new account'):t('لدي حساب سابق','I already have an account')}</button></form>}{message&&<p role="alert">{message}</p>}</>}</section></main>;
}
