'use client';
import YaqeenAuthView from '@/components/YaqeenAuthView';
import {use, useEffect, useState, useRef} from 'react';
import {supabaseBrowser} from '@/lib/supabase/browser';
import {canonicalizeAuthUrl, getAuthCallbackUrl, getRecoveryRedirectUrl} from '@/lib/auth/recovery-redirect';

import {safeNext} from '@/lib/routing';
import {friendlyAuthError} from '@/lib/auth/copy';
type Provider='google';
export default function Login({params}:{params:Promise<{locale:string}>}){
 const {locale}=use(params);const ar=locale==='ar';
 const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [msg,setMsg]=useState('');const [busy,setBusy]=useState('');
 const pending=useRef(false);
 async function run(kind:string,task:()=>Promise<void>,redirect=false){if(pending.current)return;pending.current=true;setBusy(kind);try{await task()}catch{setMsg(friendlyAuthError('',locale))}finally{pending.current=false;if(!redirect)setBusy('')}}
 const [invite,setInvite]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);
 useEffect(()=>{const canonical=canonicalizeAuthUrl(location.href);if(canonical!==location.href){location.replace(canonical);return}const query=new URLSearchParams(location.search);setInvite(query.get('invite'));setError(query.get('error'))},[]);
 const requestedNext=()=>safeNext(new URLSearchParams(location.search).get('next'),locale);
 const callback=()=>getAuthCallbackUrl(location.origin,locale,undefined,invite,requestedNext());
 const validEmail=()=>{if(!email.trim()||!/^\S+@\S+\.\S+$/.test(email.trim())){setMsg(ar?'أدخل بريدًا إلكترونيًا صحيحًا.':'Enter a valid email address.');return false}return true};
 const friendlyError=(value:string)=>friendlyAuthError(value,locale);
 async function passwordLogin(){if(!validEmail())return;if(!password){setMsg(ar?'أدخل كلمة المرور.':'Enter your password.');return}setBusy('password');setMsg('');const supabase=supabaseBrowser();const {error}=await supabase.auth.signInWithPassword({email:email.trim().toLowerCase(),password});if(error){setBusy('');setMsg(friendlyError(error.message));return}if(invite){const {error:inviteError}=await supabase.rpc('accept_organization_invitation',{p_token:invite});if(inviteError){await supabase.auth.signOut();setBusy('');setError(inviteError.message.includes('EMAIL_MISMATCH')?'invite_email':'invite_invalid');return}}setBusy('');location.assign(requestedNext())}
 async function sendMagicLink(){if(!validEmail())return;setBusy('magic');setMsg('');const {error}=await supabaseBrowser().auth.signInWithOtp({email:email.trim().toLowerCase(),options:{emailRedirectTo:callback(),shouldCreateUser:true}});setBusy('');setMsg(error?friendlyError(error.message):(ar?'تم إرسال رابط الدخول إلى بريدك.':'A sign-in link was sent to your email.'))}
 async function sendReset(){if(!validEmail())return;setBusy('reset');setMsg('');const {error}=await supabaseBrowser().auth.resetPasswordForEmail(email.trim().toLowerCase(),{redirectTo:getRecoveryRedirectUrl(location.origin,locale)});setBusy('');setMsg(error?friendlyError(error.message):(ar?'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك.':'A password reset link was sent to your email.'))}
 async function social(provider:Provider){setBusy(provider);setMsg('');const {error}=await supabaseBrowser().auth.signInWithOAuth({provider,options:{redirectTo:callback()}});if(error){setBusy('');setMsg(friendlyError(error.message))}}
 return <YaqeenAuthView ar={ar} locale={locale} email={email} setEmail={setEmail} password={password} setPassword={setPassword} busy={busy} msg={msg} error={error} invite={invite} passwordLogin={()=>void run('password',passwordLogin)} sendMagicLink={()=>void run('magic',sendMagicLink)} sendReset={()=>void run('reset',sendReset)} social={provider=>void run(provider,()=>social(provider))}/>;
}
