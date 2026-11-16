'use client';
import {invitationErrorCode} from '../../../lib/auth/invitation-error';

import YaqeenAuthView, {type AuthStage} from '@/components/YaqeenAuthView';
import {use, useEffect, useRef, useState} from 'react';
import {supabaseBrowser} from '@/lib/supabase/browser';
import {canonicalizeAuthUrl, getAuthCallbackUrl, getRecoveryRedirectUrl, getEmailAuthCallbackUrl} from '@/lib/auth/recovery-redirect';
import {safeNext} from '@/lib/routing';
import {friendlyAuthError} from '@/lib/auth/copy';
import {loginCopy} from '@/lib/auth/login-copy';
import {normalizeEmail, normalizePhone, registrationError, validEmail, verifiedEmail, type Registration} from '@/lib/auth/registration';

export default function Login({params}:{params:Promise<{locale:string}>}){
 const {locale}=use(params), ar=locale==='ar',c=loginCopy[ar?'ar':'en'];
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState('');
 const [registration,setRegistration]=useState<Registration>({name:'',phone:'',password:'',confirm:'',terms:false});
 const [stage,setStage]=useState<AuthStage>('form'),[cooldown,setCooldown]=useState(0);
 const [invite,setInvite]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
 const pending=useRef(false),deadline=useRef(0);
 useEffect(()=>{
  const canonical=canonicalizeAuthUrl(location.href);if(canonical!==location.href){location.replace(canonical);return}
  const query=new URLSearchParams(location.search);setInvite(query.get('invite'));
  if(query.get('error')==='verification'){setStage('expired')}else{setError(query.get('error'));if(query.get('state')==='verify')setStage('verify');if(query.get('state')==='magic-sent')setStage('magic-sent')}
 },[]);
 useEffect(()=>{const tick=()=>setCooldown(Math.max(0,Math.ceil((deadline.current-Date.now())/1000)));const timer=setInterval(tick,1000);return()=>clearInterval(timer)},[]);
 function startCooldown(){deadline.current=Date.now()+60000;setCooldown(60)}
 function showStage(value:AuthStage){setStage(value);const url=new URL(location.href);url.searchParams.set('state',value);url.searchParams.delete('error');history.replaceState(null,'',url)}
 function clearMessage(){setMsg('');setError(null)}
 async function run(kind:string,task:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(kind);clearMessage();try{await task()}catch{setMsg(friendlyAuthError('',locale))}finally{pending.current=false;setBusy('')}}
 const requestedNext=()=>safeNext(new URLSearchParams(location.search).get('next'),locale);
 const callback=()=>getAuthCallbackUrl(location.origin,locale,undefined,invite,requestedNext());
 const emailCallback=(signup=false)=>getEmailAuthCallbackUrl(location.origin,locale,invite,requestedNext(),signup);
 const checkEmail=()=>{if(!validEmail(email)){setMsg(c.errors.email);return false}return true};
 async function passwordLogin(){
  if(!checkEmail())return;if(!password){setMsg(c.errors.password);return}
  const supabase=supabaseBrowser(),{data,error}=await supabase.auth.signInWithPassword({email:normalizeEmail(email),password});
  if(error){if(error.code==='email_not_confirmed'){showStage('verify');setMsg(c.errors.confirmationRequired)}else setMsg(friendlyAuthError(error.message,locale));return}
  if(!verifiedEmail(data.user)){await supabase.auth.signOut();showStage('verify');return}
  if(invite){const {error:inviteError}=await supabase.rpc('accept_organization_invitation',{p_token:invite});if(inviteError){await supabase.auth.signOut();setError(invitationErrorCode(inviteError.message));return}}
  location.assign(requestedNext());
 }
 async function sendMagicLink(){
  if(!checkEmail()||Date.now()<deadline.current)return;
  const {error}=await supabaseBrowser().auth.signInWithOtp({email:normalizeEmail(email),options:{emailRedirectTo:emailCallback(),shouldCreateUser:false}});
  // Do not reveal whether a submitted address has an account.
  if(error&&!['otp_disabled','user_not_found','signup_disabled'].includes(error.code??'')){setMsg(friendlyAuthError(error.message,locale));return}
  startCooldown();showStage('magic-sent');
 }
 async function signup(){
  const invalid=registrationError(email,registration);if(invalid){setMsg(c.errors[invalid]);return}
  const supabase=supabaseBrowser();
  const {data,error}=await supabase.auth.signUp({email:normalizeEmail(email),password:registration.password,options:{emailRedirectTo:emailCallback(true),data:{full_name:registration.name.trim(),phone:normalizePhone(registration.phone),locale,terms_accepted_at:new Date().toISOString(),terms_version:'draft-2026-10-30'}}});
  if(error&&!['user_already_exists','email_exists'].includes(error.code??'')){setMsg(friendlyAuthError(error.message,locale));return}
  // Do not retain an auto-confirmed signup session if deployment settings drift.
  if(data.session)await supabase.auth.signOut();
  setRegistration(v=>({...v,password:'',confirm:''}));setPassword('');startCooldown();showStage('verify');
 }
 async function resend(){
  if(!checkEmail()||Date.now()<deadline.current)return;
  const {error}=await supabaseBrowser().auth.resend({type:'signup',email:normalizeEmail(email),options:{emailRedirectTo:emailCallback(true)}});
  if(error&&!['user_not_found','email_not_found'].includes(error.code??'')){setMsg(friendlyAuthError(error.message,locale));return}
  startCooldown();showStage('verify');setMsg(c.verifySent);
 }
 async function sendReset(){if(!checkEmail())return;const {error}=await supabaseBrowser().auth.resetPasswordForEmail(normalizeEmail(email),{redirectTo:getRecoveryRedirectUrl(location.origin,locale)});setMsg(error?friendlyAuthError(error.message,locale):c.resetSent)}
 async function social(provider:'google'){
  if(new URLSearchParams(location.search).get('tab')==='signup'&&!registration.terms){setMsg(c.googleTerms);return}
  const {error}=await supabaseBrowser().auth.signInWithOAuth({provider,options:{redirectTo:callback()}});if(error)setMsg(friendlyAuthError(error.message,locale));
 }
 return <YaqeenAuthView ar={ar} locale={locale} email={email} setEmail={setEmail} password={password} setPassword={setPassword} busy={busy} msg={msg} error={error} invite={invite} registration={registration} setRegistration={setRegistration} stage={stage} setStage={setStage} cooldown={cooldown} clearMessage={clearMessage} passwordLogin={()=>void run('password',passwordLogin)} sendMagicLink={()=>void run('magic',sendMagicLink)} sendReset={()=>void run('reset',sendReset)} social={provider=>void run(provider,()=>social(provider))} signup={()=>void run('signup',signup)} resend={()=>void run('resend',resend)}/>;
}
