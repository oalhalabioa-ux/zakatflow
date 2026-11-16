'use client';
import {useEffect,useState,useRef} from 'react';
import {loginCopy} from '@/lib/auth/login-copy';
import type {Registration} from '@/lib/auth/registration';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {languageSwitch} from '@/lib/routing';
import {authCopy} from '@/lib/auth/copy';
import YaqeenBrand from './YaqeenBrand';
import type {ReactNode} from 'react';
type AuthIconName='plane'|'lock'|'mail'|'mailArrow'|'eye'|'eyeOff'|'globe'|'chevron'|'bars'|'shield'|'hierarchy'|'brain';
function AuthIcon({name}:{name:AuthIconName}){
 const paths:Record<AuthIconName,ReactNode>={
  plane:<><path d="m3 10 18-7-7 18-3-8-8-3Z"/><path d="m11 13 10-10"/></>,
  lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
  mail:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
  mailArrow:<><path d="M12 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4M4 7l8 6 8-6M16 20l6-6M17 14h5v5"/></>,
  eye:<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff:<><path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 3.8M6.2 6.2A20 20 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 5.8-1.8M10 10a3 3 0 0 0 4 4"/></>,
  globe:<><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/></>,
  chevron:<path d="m7 10 5 5 5-5"/>,
  bars:<><path d="M3 21h18M5 21V12h4v9M10 21V7h4v14M15 21V3h4v18"/></>,
  shield:<><path d="m12 3 8 3v6c0 5-3 8-8 10-5-2-8-5-8-10V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  hierarchy:<><circle cx="12" cy="4" r="2.5"/><circle cx="4" cy="19" r="2.5"/><circle cx="12" cy="19" r="2.5"/><circle cx="20" cy="19" r="2.5"/><path d="M12 7v9M4 16v-5h16v5"/></>,
  brain:<><path d="M12 4c-2-3-6-1-6 2-3 0-4 4-2 6-3 3-1 7 2 7 1 4 6 4 6 0V4ZM12 4c2-3 6-1 6 2 3 0 4 4 2 6 3 3 1 7-2 7-1 4-6 4-6 0M7 7l2 2M5 13l3-1M7 17l2-2M17 7l-2 2M19 13l-3-1M17 17l-2-2"/></>
 };
 return <svg className="yqa-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
export type AuthStage='form'|'magic-sent'|'verify'|'expired';
export type YaqeenAuthProps={ar:boolean;locale:string;email:string;setEmail:(v:string)=>void;password:string;setPassword:(v:string)=>void;busy:string;msg:string;error:string|null;invite:string|null;passwordLogin:()=>void;sendMagicLink:()=>void;sendReset:()=>void;social:(p:'google')=>void;signup:()=>void;resend:()=>void;registration:Registration;setRegistration:(v:Registration)=>void;stage:AuthStage;setStage:(v:AuthStage)=>void;cooldown:number;clearMessage:()=>void};
export default function YaqeenAuthView(p:YaqeenAuthProps){
 const card=useRef<HTMLElement>(null),shell=useRef<HTMLElement>(null);
 useEffect(()=>{const element=card.current,main=shell.current;if(!element||!main)return;const update=()=>main.style.setProperty('--yqa-content-height',`${element.offsetTop+element.offsetHeight+24}px`);const observer=new ResizeObserver(update);observer.observe(element);window.addEventListener('resize',update);update();return()=>{observer.disconnect();window.removeEventListener('resize',update)}},[]);
 const query=useSearchParams(),{ar,locale}=p,c=loginCopy[ar?'ar':'en'],copy=authCopy[ar?'ar':'en'];
 const [account,setAccount]=useState<'signin'|'signup'>(query.get('tab')==='signup'||query.get('error')==='verification'||query.get('state')==='verify'?'signup':'signin');
 const [method,setMethod]=useState<'magic'|'password'>(query.get('mode')==='magic'?'magic':'password');
 const [forgot,setForgot]=useState(query.get('mode')==='reset'),[show,setShow]=useState(false),[showConfirm,setShowConfirm]=useState(false),[remember,setRemember]=useState(false);
 useEffect(()=>{try{const saved=localStorage.getItem('yaqeen-login-email');if(saved){p.setEmail(saved);setRemember(true)}}catch{}},[p.setEmail]);
 const signup=account==='signup',r=p.registration,disabled=!!p.busy;
 const set=(key:keyof Registration,value:string|boolean)=>p.setRegistration({...r,[key]:value});
 function updateQuery(tab:string,mode:string){const url=new URL(location.href);url.searchParams.set('tab',tab);url.searchParams.set('mode',mode);url.searchParams.delete('error');url.searchParams.delete('state');history.replaceState(null,'',url)}
 function switchAccount(value:'signin'|'signup'){if(disabled)return;setAccount(value);setForgot(false);p.setStage('form');p.clearMessage();p.setPassword('');p.setRegistration({...r,password:'',confirm:''});updateQuery(value,method)}
 function rememberEmail(){try{if(remember)localStorage.setItem('yaqeen-login-email',p.email.trim());else localStorage.removeItem('yaqeen-login-email')}catch{}}
 const field=(id:string,label:string,autocomplete:string,value:string,change:(v:string)=>void,type='text',placeholder='',toggle?:()=>void,visible=false)=><label htmlFor={id}>{label}<span className="yqa-input"><input id={id} name={id} type={type} required autoComplete={autocomplete} value={value} onChange={e=>change(e.target.value)} placeholder={placeholder} maxLength={autocomplete==='new-password'?128:undefined} dir={type==='email'||type==='tel'?'ltr':undefined}/>{toggle?<button type="button" aria-label={visible?c.hide:c.show} aria-pressed={visible} onClick={toggle}><AuthIcon name={visible?'eyeOff':'eye'}/></button>:autocomplete==='email'||autocomplete==='username'?<AuthIcon name="mail"/>:null}</span></label>;
 const rememberField=<label className="yqa-remember"><input type="checkbox" name="remember-email" checked={remember} onChange={e=>{setRemember(e.target.checked);if(!e.target.checked)try{localStorage.removeItem('yaqeen-login-email')}catch{}}}/>{c.remember}</label>;
 const google=<><div className="yqa-or"><span>{c.or}</span></div><div className="yqa-provider-row"><button className="yqa-provider" disabled={disabled} type="button" onClick={()=>{if(signup&&!r.terms){p.social('google');document.getElementById('signup-terms')?.focus();return}p.social('google')}}><b className="yqa-google">G</b>{signup?c.googleCreate:c.google}</button></div></>;
 const tabs=<div className="yqa-tabs yqa-account-tabs" role="tablist" aria-label={c.accountTabs}>{(['signin','signup'] as const).map(value=><button type="button" key={value} id={`account-${value}`} role="tab" tabIndex={account===value?0:-1} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'signin':e.key==='End'?'signup':value==='signin'?'signup':'signin';switchAccount(next);document.getElementById(`account-${next}`)?.focus()}}} aria-selected={account===value} aria-controls="auth-panel" disabled={disabled} onClick={()=>switchAccount(value)}>{value==='signin'?c.signIn:c.create}</button>)}</div>;
 const methodSwitch=<div className="yqa-tabs yqa-method-tabs" role="tablist" aria-label={c.methods}>{(['password','magic'] as const).map(value=><button role="tab" type="button" key={value} id={`method-${value}`} tabIndex={method===value?0:-1} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'password':e.key==='End'?'magic':value==='password'?'magic':'password';setMethod(next);updateQuery(account,next);document.getElementById(`method-${next}`)?.focus()}}} aria-label={value==='password'?c.password:c.quick} title={value==='password'?c.password:c.quick} aria-selected={method===value} aria-controls="signin-method-panel" onClick={()=>{setMethod(value);p.clearMessage();updateQuery(account,value)}}><AuthIcon name={value==='password'?'lock':'mailArrow'}/></button>)}</div>;
 const submitButton=<button className="yqa-submit" type="submit" disabled={disabled||(!signup&&method==='magic'&&!forgot&&p.cooldown>0)}>{disabled?c.working:signup?c.createButton:forgot?c.reset:method==='magic'?c.sendQuick:c.signIn}<AuthIcon name="plane"/></button>;
 const countdown=p.cooldown>0?`${c.resendIn} 00:${String(p.cooldown).padStart(2,'0')}`:null;
 const changeEmail=()=>{p.setStage('form');p.clearMessage();const url=new URL(location.href);url.searchParams.delete('state');url.searchParams.delete('error');url.searchParams.delete('state');history.replaceState(null,'',url)};
 return <main ref={shell} className="yqa" dir={ar?'rtl':'ltr'}>
  <nav className="yqa-languages"><Link href={languageSwitch(`/${locale}/login?${query.toString()}`,ar?'en':'ar')}>{ar?'العربية | EN':'English | العربية'} <AuthIcon name="globe"/></Link></nav>
  <section className="yqa-pitch"><YaqeenBrand dark/><p className="yqa-tagline">{ar?'منصة الإدارة المالية والأعمال الذكية':'Smart Finance & Business Platform'}</p><div className="yqa-pillars">{(ar?['تحكم مالي متكامل','صلاحيات ومراجعة','إدارة الشركات والفروع','تحليلات تدعم القرار']:['Financial control','Access & review','Companies & branches','Decision insights']).map((t,i)=><div key={t}><AuthIcon name={(['bars','shield','hierarchy','brain'] as AuthIconName[])[i]}/><b>{t}</b></div>)}</div><i className="yqa-rule"/><h1>{ar?'إدارة أعمالك بذكاء':'Manage your business intelligently'}<br/><em>{ar?'واتخذ القرار بيقين':'Make decisions with confidence'}</em></h1></section>
  <section ref={card} className="yqa-card" aria-busy={disabled}><YaqeenBrand/>
   <h2>{p.stage==='magic-sent'?c.sentTitle:p.stage==='verify'?c.verifyTitle:p.stage==='expired'?c.expiredTitle:p.invite?c.inviteTitle:signup?c.create:c.welcome}</h2>
   <p>{p.stage==='magic-sent'?c.sent:p.stage==='verify'?c.verify:p.stage==='expired'?c.expired:p.invite?c.inviteIntro:signup?c.createIntro:c.intro}</p>
   {tabs}
   <div id="auth-panel" role="tabpanel" aria-labelledby={`account-${account}`}>
   {p.stage==='form'?<><form key={`${account}-${forgot}`} onSubmit={e=>{e.preventDefault();rememberEmail();signup?p.signup():forgot?p.sendReset():method==='magic'?p.sendMagicLink():p.passwordLogin()}}>
    <fieldset disabled={disabled} className="yqa-fields">
    {signup&&<div className="yqa-field-pair">{field('signup-name',c.name,'name',r.name,v=>set('name',v),'text',c.namePlaceholder)}<div>{field('signup-phone',c.phone,'tel',r.phone,v=>set('phone',v),'tel','+966')}<p className="yqa-hint">{c.phoneHint}</p></div></div>}
    {field(signup?'signup-email':'login-email',c.email,signup?'email':'username',p.email,p.setEmail,'email',c.emailPlaceholder)}

    {signup?<><div className="yqa-field-pair">{field('signup-password',c.password,'new-password',r.password,v=>set('password',v),show?'text':'password','',()=>setShow(v=>!v),show)}{field('signup-confirm',c.confirm,'new-password',r.confirm,v=>set('confirm',v),showConfirm?'text':'password','',()=>setShowConfirm(v=>!v),showConfirm)}</div><p className="yqa-hint">{c.strengthHint}</p><label className="yqa-consent" htmlFor="signup-terms"><input id="signup-terms" type="checkbox" name="terms" required checked={r.terms} onChange={e=>set('terms',e.target.checked)}/><span>{c.termsPrefix} <a href={`/auth/legal?kind=terms&lang=${locale}`} target="_blank" rel="noopener">{c.terms}</a> {c.and} <a href={`/auth/legal?kind=privacy&lang=${locale}`} target="_blank" rel="noopener">{c.privacy}</a></span></label></>:<div id="signin-method-panel">{!forgot&&(method==='password'?<><div className="yqa-method-row">{methodSwitch}{field('login-password',c.password,'current-password',p.password,p.setPassword,show?'text':'password','',()=>setShow(v=>!v),show)}</div><button className="yqa-forgot" type="button" onClick={()=>{setForgot(true);p.clearMessage();updateQuery(account,'reset')}}>{c.forgot}</button>{rememberField}</>:<><p className="yqa-hint">{c.quickHint}</p><div className="yqa-method-row yqa-method-row-magic">{methodSwitch}{submitButton}</div></>)}</div>}
    {(signup||forgot||method==='password')&&submitButton}
    {forgot&&<button className="yqa-forgot" type="button" onClick={()=>{setForgot(false);p.clearMessage();updateQuery(account,method)}}>{c.back}</button>}
    </fieldset></form>{!forgot&&google}</>:<div className="yqa-status-panel">
     {p.email?<p className="yqa-email" dir="ltr">{p.email}</p>:field('verification-email',c.email,'email',p.email,p.setEmail,'email',c.emailPlaceholder)}
     {p.stage!=='magic-sent'&&<p className="yqa-notice">{c.verifyRestricted}</p>}
     <button type="button" className="yqa-submit" disabled={disabled||p.cooldown>0} onClick={p.stage==='magic-sent'?p.sendMagicLink:p.resend}>{disabled?c.working:countdown??(p.stage==='magic-sent'?c.resendQuick:p.stage==='expired'?c.newLink:c.resend)}<AuthIcon name="mail"/></button>
     <button className="yqa-forgot" type="button" disabled={disabled} onClick={changeEmail}>{c.changeEmail}</button>
     {p.stage==='magic-sent'?google:<button type="button" className="yqa-forgot" disabled={disabled} onClick={()=>switchAccount('signin')}>{c.back}</button>}
    </div>}
   </div>
   {p.msg&&<p role="status" className="yqa-message">{p.msg}</p>}
   {p.error&&<p role="alert" className="yqa-message yqa-error">{p.error==='invite_seats'?copy.inviteSeats:p.error==='invite_readonly'?copy.inviteReadonly:p.error==='recovery_origin'?copy.recoveryOrigin:p.error.startsWith('invite')?copy.inviteError:copy.authError}</p>}
   <p className="yqa-footnote">{c.footnote}</p>
  </section>
 </main>
}
