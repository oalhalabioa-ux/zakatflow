'use client';

import Link from 'next/link';
import {useEffect,useState} from 'react';
import {appearanceThemes,defaultAppearance,resolveAppearance,type AppearanceTheme} from '@/lib/appearance';
import './system-preferences.css';

const THEME_NAMES:Record<AppearanceTheme,[string,string]>={
 'yaqeen-business':['يقين الملكي','Yaqeen Royal'],
 elegant:['الأنيق','Elegant'],
 classic:['الكلاسيكي','Classic'],
 modern:['العصري','Modern'],
};

export default function GeneralSystemPreferences({locale}:{locale:string}){
 const ar=locale==='ar';
 const [theme,setTheme]=useState<AppearanceTheme>(defaultAppearance);
 const [tab,setTab]=useState<'appearance'|'notifications'|'security'>('appearance');
 const [confirmation,setConfirmation]=useState('');
 useEffect(()=>{setTheme(resolveAppearance(localStorage.getItem('zf-theme')));},[]);
 function choose(value:AppearanceTheme){
  setTheme(value);
  window.dispatchEvent(new CustomEvent('zf-theme-selection',{detail:value}));
  setConfirmation(ar?'تم تطبيق المظهر على واجهة يقين الحالية.':'Appearance applied to your Yaqeen workspace.');
 }
 const sections=[
  {id:'appearance',ar:'المظهر واللغة',en:'Appearance & language'},
  {id:'notifications',ar:'الإشعارات',en:'Notifications'},
  {id:'security',ar:'الأمان',en:'Security'},
 ] as const;
 return <section className="yp-preferences" aria-label={ar?'إعدادات النظام':'System preferences'}>
  <header className="yp-preferences-heading">
   <h2>{ar?'إعدادات النظام':'System settings'}</h2>
   <p>{ar?'هذه تفضيلات للمنصة، وليست جزءًا من الهوية النظامية أو التسجيل الضريبي للمؤسسة.':
     'These platform preferences are distinct from the organization’s legal registration and tax identity.'}</p>
  </header>
  <nav className="yp-preferences-tabs" aria-label={ar?'أقسام النظام':'System preference sections'}>
   {sections.map(item=><button key={item.id} type="button" aria-pressed={tab===item.id}
    onClick={()=>{setTab(item.id);setConfirmation('')}}>{ar?item.ar:item.en}</button>)}
  </nav>
  {tab==='appearance'&&<section className="yp-preferences-card">
   <h3>{ar?'ثيم المنصة':'Workspace appearance'}</h3>
   <p>{ar?'اختر أحد الثيمات المتاحة حاليًا. يتغير مظهر الشريط العلوي والقائمة الأصلية معًا دون إنشاء تصميم جانبي جديد.':
     'Choose one of the existing themes. The current topbar and sidebar update together; no duplicate navigation is introduced.'}</p>
   <div className="yp-themes" role="group" aria-label={ar?'اختيار ثيم المنصة':'Choose a theme'}>
    {appearanceThemes.map(value=><button key={value} type="button" className="yp-theme"
     aria-pressed={theme===value} onClick={()=>choose(value)}>
     <span className={'yp-theme-preview theme-'+value} aria-hidden="true"><i/><i/><i/></span>
     <strong>{THEME_NAMES[value][ar?0:1]}</strong>
     <small>{theme===value?(ar?'الثيم الحالي':'Current theme'):(ar?'اختيار المظهر':'Choose theme')}</small>
    </button>)}
   </div>
   <h3>{ar?'اللغة والحساب الشخصي':'Language and account'}</h3>
   <div className="yp-preferences-quick">
    <Link href={`/${ar?'en':'ar'}/settings/system`}>{ar?'English / التبديل إلى الإنجليزية':'العربية / Switch to Arabic'}</Link>
    <Link href={`/${locale}/account`}>{ar?'إعدادات اللغة والعملة الشخصية':'Personal language and currency settings'}</Link>
   </div>
  </section>}
  {tab==='notifications'&&<section className="yp-preferences-card">
   <h3>{ar?'الإشعارات':'Notifications'}</h3>
   <p>{ar?'يمكن مراجعة إشعارات المؤسسة وفتحها من مركز الإشعارات الحالي. إعداد تفضيلات الإرسال التفصيلية غير مفعل هنا حتى يتوفر مصدر حفظ معتمد.':
     'Review existing notifications in the notification center. Delivery preference switches are not shown until a supported persistence service is available.'}</p>
   <Link className="yp-preferences-cta" href={`/${locale}/notifications`}>{ar?'فتح مركز الإشعارات':'Open notification center'}</Link>
  </section>}
  {tab==='security'&&<section className="yp-preferences-card">
   <h3>{ar?'الأمان والحساب':'Security & account'}</h3>
   <p>{ar?'إعدادات الهوية وتسجيل الدخول تخص الحساب الشخصي؛ أما صلاحيات أعضاء المؤسسة فتُدار في قسم المستخدمين والصلاحيات.':
     'Identity and sign-in belong to your personal account; organization access is managed separately under Users & permissions.'}</p>
   <div className="yp-preferences-quick">
    <Link href={`/${locale}/account`}>{ar?'إدارة حسابي':'Manage my account'}</Link>
    <Link href={`/${locale}/settings/team`}>{ar?'إدارة الأدوار والصلاحيات':'Manage roles and permissions'}</Link>
   </div>
  </section>}
  {confirmation&&<p role="status" className="yp-preferences-success">{confirmation}</p>}
 </section>;
}