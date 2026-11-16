'use client';
import {useEffect,useState} from 'react';
import {supabaseBrowser} from '@/lib/supabase/browser';
import SettingsIcon from './SettingsIcon';
type Identity={email:string;verified:boolean;providers:string[]};
export default function SettingsSecuritySummary({locale}:{locale:string}){
 const ar=locale==='ar';const [identity,setIdentity]=useState<Identity|null>(null),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{let live=true;setLoading(true);setFailed(false);supabaseBrowser().auth.getUser().then(({data,error})=>{if(!live)return;if(error||!data.user){setFailed(true);return;}setIdentity({email:data.user.email??'',verified:Boolean(data.user.email_confirmed_at),providers:data.user.identities?.map(i=>i.provider)??[]});}).catch(()=>{if(live)setFailed(true);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[revision]);
 return <section className="yp-preferences-card settings-security-card" id="settings-security"><h3><SettingsIcon name="security"/>{ar?'الأمان والوصول':'Security & access'}</h3>
  {loading?<p role="status">{ar?'جارٍ التحقق من الحساب…':'Checking account…'}</p>:failed?<p role="status">{ar?'تعذر التحقق من معلومات الدخول.':'Sign-in information unavailable.'} <button type="button" className="settings-text-action" onClick={()=>setRevision(n=>n+1)}>{ar?'إعادة المحاولة':'Retry'}</button></p>:identity&&<dl className="settings-overview-facts"><div><dt>{ar?'حساب الدخول':'Signed-in account'}</dt><dd dir="ltr">{identity.email||'—'}</dd></div><div><dt>{ar?'تأكيد البريد':'Email confirmation'}</dt><dd><span className={'settings-state '+(identity.verified?'complete':'pending')}>{identity.verified?(ar?'مؤكد':'Confirmed'):(ar?'غير مؤكد':'Not confirmed')}</span></dd></div><div><dt>{ar?'طرق الدخول المرتبطة':'Linked sign-in methods'}</dt><dd>{identity.providers.length?identity.providers.map(p=>p==='email'?(ar?'البريد الإلكتروني':'Email'):p==='google'?'Google':p==='azure'?'Microsoft':p).join('، '):'—'}</dd></div></dl>}
  <p>{ar?'سياسات تسجيل الدخول وحماية الحساب مستقلة عن إعدادات المظهر والإشعارات.':'Sign-in and account protection policies are separate from appearance and notification preferences.'}</p>
 </section>;
}
