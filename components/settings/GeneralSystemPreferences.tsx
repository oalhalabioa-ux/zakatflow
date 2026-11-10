'use client';
import SettingsIcon from './SettingsIcon';
import SettingsSecuritySummary from './SettingsSecuritySummary';
import {useEffect,useState,type FormEvent} from 'react';
import {defaultAppearance,resolveAppearance,type AppearanceTheme} from '@/lib/appearance';
import './system-preferences.css';
const names:Record<AppearanceTheme,[string,string]>={'yaqeen-business':['يقين الملكي','Yaqeen Royal'],elegant:['الأنيق','Elegant'],classic:['الكلاسيكي','Classic'],modern:['العصري','Modern']};
type Preferences={notifications_enabled:boolean;assessment_reminders:boolean;theme:string};
type Account={name:string|null;phone:string|null;base_currency:string;locale:string;timezone:string;calendar_type:string;nisab_standard:string;zakat_method_id?:string|null};
export default function GeneralSystemPreferences({locale}:{locale:string}){
 const ar=locale==='ar';const [theme,setTheme]=useState<AppearanceTheme>(defaultAppearance);
 const [profile,setProfile]=useState<Account|null>(null),[settings,setSettings]=useState<Preferences|null>(null);
 const [tab,setTab]=useState('appearance'),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{
  const c=new AbortController();setLoading(true);
  fetch('/api/settings',{cache:'no-store',signal:c.signal}).then(async r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{
   if(c.signal.aborted)return;setProfile(data.profile);setSettings(data.settings);
   setTheme(resolveAppearance(data.settings.theme==='system'?localStorage.getItem('zf-theme'):data.settings.theme));
  }).catch(()=>{if(!c.signal.aborted)setError(ar?'تعذر تحميل التفضيلات.':'Unable to load preferences.');}).finally(()=>{if(!c.signal.aborted)setLoading(false);});
  return()=>c.abort();
 },[ar]);
 async function save(e:FormEvent){
  e.preventDefault();if(!profile||!settings||busy)return;setBusy(true);setError('');setMessage('');
  try{
   const r=await fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:{locale:profile.locale,base_currency:profile.base_currency,timezone:profile.timezone},settings:{notifications_enabled:settings.notifications_enabled,assessment_reminders:settings.assessment_reminders,theme}})});
   if(!r.ok)throw Error();const data=await r.json();setProfile(data.profile);setSettings(data.settings);
   localStorage.setItem('zf-theme',theme);window.dispatchEvent(new CustomEvent('zf-theme-selection',{detail:theme}));
   setMessage(ar?'تم حفظ إعداداتك.':'Your preferences were saved.');
  }catch{setError(ar?'تعذر حفظ الإعدادات. لم تُعتمد التغييرات.':'Unable to save preferences. Changes were not confirmed.');}finally{setBusy(false);}
 }
 return <section className="yp-preferences" data-system-preferences>
  <header className="settings-section-heading"><h2>{ar?'إعدادات النظام':'System settings'}</h2><p>{ar?'تفضيلات حسابك ومظهر المنصة، مستقلة عن الهوية القانونية للمؤسسة.':'Your account preferences and workspace appearance, independent of legal identity.'}</p></header>
  <nav className="settings-local-tabs settings-system-tabs" aria-label={ar?'أقسام النظام':'System preference sections'}>{[['appearance','المظهر واللغة','Appearance & language'],['notifications','الإشعارات','Notifications'],['security','الأمان','Security']].map(([id,a,e])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>{setTab(id);document.getElementById('settings-'+id)?.scrollIntoView({block:'nearest',behavior:'smooth'});}}><SettingsIcon name={id==='appearance'?'appearance':id==='notifications'?'notifications':'security'}/>{ar?a:e}</button>)}</nav>
  {loading?<p role="status">{ar?'جارٍ تحميل الإعدادات…':'Loading settings…'}</p>:profile&&settings&&<form onSubmit={save}>
   <div className="settings-preferences-grid">
    <section className="yp-preferences-card settings-appearance-card" id="settings-appearance">
     <h3><SettingsIcon name="appearance"/>{ar?'المظهر واللغة':'Appearance & language'}</h3>
     <div className="yp-themes">{(['yaqeen-business','elegant','classic','modern'] as AppearanceTheme[]).map(value=><button key={value} type="button" className="yp-theme" aria-pressed={theme===value} disabled={busy} onClick={()=>{setTheme(value);setMessage('');}}><span className={'yp-theme-preview theme-'+value} aria-hidden="true"><i/><i/><i/></span><strong>{names[value][ar?0:1]}</strong></button>)}</div>
     <div className="settings-form">
      <label>{ar?'لغة الحساب':'Account language'}<select value={profile.locale} disabled={busy} onChange={e=>setProfile({...profile,locale:e.target.value})}><option value="ar">العربية</option><option value="en">English</option></select></label>
      <label>{ar?'عملة العرض الشخصية':'Personal display currency'}<select value={profile.base_currency} disabled={busy} onChange={e=>setProfile({...profile,base_currency:e.target.value})}>{Array.from(new Set([profile.base_currency,'SAR','USD','AED','EUR','GBP','LBP','SYP'])).map(v=><option key={v}>{v}</option>)}</select></label>
      <label>{ar?'المنطقة الزمنية':'Time zone'}<select value={profile.timezone??'UTC'} disabled={busy} onChange={e=>setProfile({...profile,timezone:e.target.value})}>{Array.from(new Set([profile.timezone??'UTC','Asia/Riyadh','Asia/Dubai','Asia/Beirut','Asia/Damascus','Europe/Istanbul','UTC'])).map(v=><option key={v}>{v}</option>)}</select></label>
      <label>{ar?'تنسيق الأرقام':'Number display'}<input readOnly value="1,234.56" dir="ltr"/></label>
     </div>
     <p>{ar?'الأرقام بالصيغة الإنجليزية في اللغتين. عملة المؤسسة الأساسية تُدار في إعداداتها المالية.':'Numbers use English digits in both languages. Organization base currency belongs to its financial settings.'}</p>

    </section>
    <section className="yp-preferences-card settings-notifications-card" id="settings-notifications"><h3><SettingsIcon name="notifications"/>{ar?'الإشعارات':'Notifications'}</h3>
     <label className="settings-toggle"><span><strong>{ar?'تنبيهات النظام':'System notifications'}</strong><small>{ar?'تفعيل إشعارات حسابك.':'Enable account notifications.'}</small></span><input type="checkbox" role="switch" checked={settings.notifications_enabled} disabled={busy} onChange={e=>setSettings({...settings,notifications_enabled:e.target.checked})}/></label>
     <label className="settings-toggle"><span><strong>{ar?'تذكيرات التقييم':'Assessment reminders'}</strong><small>{ar?'تفضيل التذكير بالتقييمات.':'Assessment reminder preference.'}</small></span><input type="checkbox" role="switch" checked={settings.assessment_reminders} disabled={busy} onChange={e=>setSettings({...settings,assessment_reminders:e.target.checked})}/></label>
    </section>
    <SettingsSecuritySummary locale={locale}/>
    <aside className="settings-preferences-note"><h3><SettingsIcon name="info"/>{ar?'ملاحظة هامة':'Important note'}</h3><p>{ar?'هذه تفضيلات حسابك على المنصة. بيانات المؤسسة والضرائب والسنة المالية محفوظة في أقسامها المستقلة.':'These are your platform preferences. Organization identity, tax and fiscal records belong to their respective settings sections.'}</p></aside>
   </div>
   <footer className="settings-action-footer"><button className="settings-save" type="submit" disabled={busy}>{busy?(ar?'جارٍ الحفظ…':'Saving…'):(ar?'حفظ التعديلات':'Save changes')}</button></footer>
  </form>}
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 </section>;
}
