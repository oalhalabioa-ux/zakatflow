'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {supabaseBrowser} from '@/lib/supabase/browser';
import {establishRecoverySession} from '@/lib/auth/recovery-session';
import {loginCopy} from '@/lib/auth/login-copy';
import {authCopy} from '@/lib/auth/copy';
import YaqeenBrand from '@/components/YaqeenBrand';

export default function ResetPassword(){
 const query=useSearchParams();const locale=query.get('lang')==='en'?'en':'ar';
 const [password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[checking,setChecking]=useState(true),[message,setMessage]=useState(''),[error,setError]=useState('');
 const t=authCopy[locale],invited=query.get('purpose')==='invite',inviteCopy=loginCopy[locale];
 useEffect(()=>{
  const language=locale;
  const copy=authCopy[language],fragment=location.hash,supabase=supabaseBrowser();let active=true;
  const {data}=supabase.auth.onAuthStateChange(event=>{if(active&&event==='PASSWORD_RECOVERY')setReady(true)});
  void (async()=>{
   try {
    const code=new URLSearchParams(location.search).get('code');
    const result=await establishRecoverySession(supabase,code,fragment);
    if(fragment||code){const clean=new URL(location.href);clean.hash='';clean.searchParams.delete('code');history.replaceState(history.state,'',clean.toString())}
    if(active){setReady(!!result.session);if(result.error)setError(copy.invalidLink)}
   }catch{if(active)setError(copy.verifyFailed)}finally{if(active)setChecking(false)}
  })();
  return()=>{active=false;data.subscription.unsubscribe()};
 },[locale]);
 async function submit(){
  if(busy||!ready)return;setError('');setMessage('');
  if(password.length<8){setError(t.shortPassword);return}if(password!==confirm){setError(t.mismatch);return}
  setBusy(true);
  try{const {error}=await supabaseBrowser().auth.updateUser({password});if(error){setError(t.updateFailed);return}setPassword('');setConfirm('');setReady(false);setMessage(t.updated)}catch{setError(t.updateFailed)}finally{setBusy(false)}
 }
 return <main className="container" dir={locale==='ar'?'rtl':'ltr'} lang={locale} style={{maxWidth:560,paddingTop:40,paddingBottom:60}}><div className="card hero"><div style={{textAlign:'center',marginBottom:22}}><YaqeenBrand/><h1>{invited?inviteCopy.invitePasswordTitle:t.title}</h1><p className="muted">{invited?inviteCopy.invitePasswordIntro:t.intro}</p></div>{checking&&<p role="status">{t.checking}</p>}{!checking&&!ready&&!message&&<p role="status">{t.openLink}</p>}{ready&&<form onSubmit={event=>{event.preventDefault();void submit()}} style={{display:'grid',gap:12}}><label>{t.password}<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} style={{width:'100%',padding:12,marginTop:8}}/></label><label>{t.confirm}<input required type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} style={{width:'100%',padding:12,marginTop:8}}/></label><button className="btn" type="submit" disabled={busy}>{busy?t.updating:t.update}</button></form>}{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}<Link href={`/${locale}/login?mode=password`}>{t.back}</Link></div></main>;
}
