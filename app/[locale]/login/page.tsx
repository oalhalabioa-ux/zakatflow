'use client';
import YaqeenAuthView from '@/components/YaqeenAuthView';
import {use, useEffect, useState} from 'react';
import {supabaseBrowser} from '@/lib/supabase/browser';
import {canonicalizeAuthUrl, getAuthCallbackUrl, getRecoveryRedirectUrl} from '@/lib/auth/recovery-redirect';

type Provider='google';
export default function Login({params}:{params:Promise<{locale:string}>}){
 const {locale}=use(params);const ar=locale==='ar';
 const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [msg,setMsg]=useState('');const [busy,setBusy]=useState('');
 const [showPassword,setShowPassword]=useState(false);const [forgot,setForgot]=useState(false);
 const [invite,setInvite]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);
 useEffect(()=>{const canonical=canonicalizeAuthUrl(location.href);if(canonical!==location.href){location.replace(canonical);return}const query=new URLSearchParams(location.search);setInvite(query.get('invite'));setError(query.get('error'))},[]);
 const callback=()=>getAuthCallbackUrl(location.origin,locale,undefined,invite);
 const validEmail=()=>{if(!email.trim()||!/^\S+@\S+\.\S+$/.test(email.trim())){setMsg(ar?'أدخل بريدًا إلكترونيًا صحيحًا.':'Enter a valid email address.');return false}return true};
 const friendlyError=(value:string)=>{const text=value.toLowerCase();if(text.includes('invalid login credentials'))return ar?'البريد أو كلمة المرور غير صحيحة.':'Email or password is incorrect.';if(text.includes('email not confirmed'))return ar?'أكد بريدك الإلكتروني أولًا.':'Confirm your email address first.';if(text.includes('rate limit'))return ar?'تم إرسال طلبات كثيرة مؤخرًا. انتظر قليلًا ثم أعد المحاولة.':'Too many requests. Please wait and try again.';return ar?'تعذر إكمال العملية. حاول مرة أخرى.':'Unable to complete the request. Please try again.'};
 async function passwordLogin(){if(!validEmail()||!password){setMsg(ar?'أدخل كلمة المرور.':'Enter your password.');return}setBusy('password');setMsg('');const supabase=supabaseBrowser();const {error}=await supabase.auth.signInWithPassword({email:email.trim().toLowerCase(),password});if(error){setBusy('');setMsg(friendlyError(error.message));return}if(invite){const {error:inviteError}=await supabase.rpc('accept_organization_invitation',{p_token:invite});if(inviteError){await supabase.auth.signOut();setBusy('');setError(inviteError.message.includes('EMAIL_MISMATCH')?'invite_email':'invite_invalid');return}}setBusy('');location.assign(`/${locale}/dashboard`)}
 async function sendMagicLink(){if(!validEmail())return;setBusy('magic');setMsg('');const {error}=await supabaseBrowser().auth.signInWithOtp({email:email.trim().toLowerCase(),options:{emailRedirectTo:callback(),shouldCreateUser:true}});setBusy('');setMsg(error?friendlyError(error.message):(ar?'تم إرسال رابط الدخول إلى بريدك.':'A sign-in link was sent to your email.'))}
 async function sendReset(){if(!validEmail())return;setBusy('reset');setMsg('');const {error}=await supabaseBrowser().auth.resetPasswordForEmail(email.trim().toLowerCase(),{redirectTo:`${location.origin}/auth/reset-password`});setBusy('');setMsg(error?friendlyError(error.message):(ar?'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك.':'A password reset link was sent to your email.'))}
 async function social(provider:Provider){setBusy(provider);setMsg('');const {error}=await supabaseBrowser().auth.signInWithOAuth({provider,options:{redirectTo:callback()}});if(error){setBusy('');setMsg(friendlyError(error.message))}}
 return <YaqeenAuthView ar={ar} locale={locale} email={email} setEmail={setEmail} password={password} setPassword={setPassword} busy={busy} msg={msg} error={error} invite={invite} passwordLogin={()=>void passwordLogin()} sendMagicLink={()=>void sendMagicLink()} sendReset={()=>void sendReset()} social={provider=>void social(provider)}/>;
}
