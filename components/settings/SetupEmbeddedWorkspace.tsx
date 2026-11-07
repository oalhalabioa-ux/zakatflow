'use client';

import Link from 'next/link';
import {useMemo,useRef,useState} from 'react';

type Props={
 locale:string;
 organizationId:string;
 stage:string;
 href:string;
 onRefresh:()=>void;
};
const route=/^\/(?:ar|en)\/(?:settings(?:\/financial\/fiscal-years)?|chart-of-accounts|financial-reporting-policy|cash-and-banks|opening-balances|users)$/;
export function setupEmbeddedUrl(href:string,organizationId:string):string|null{
 // Only the known, same-origin Yaqeen financial/organization workspaces are
 // allowed to load inside this window. An absolute or external URL is denied.
 if(!href.startsWith('/')||href.startsWith('//')||!organizationId)return null;
 try{
  const u=new URL(href,'https://yaqeen.invalid');
  if(u.origin!=='https://yaqeen.invalid'||!route.test(u.pathname)||
   u.searchParams.get('organization')!==organizationId)return null;
  u.searchParams.set('fromSetup','1');
  u.searchParams.set('setupEmbed','1');
  return u.pathname+u.search;
 }catch{return null}
}

/** Embedded *real* service screens, not screenshots or duplicate form logic.
 * Original API approvals, permissions, fiscal scopes and audits are preserved.
 */
export default function SetupEmbeddedWorkspace({locale,organizationId,stage,href,onRefresh}:Props){
 const ar=locale==='ar';
 const t=(arabic:string,english:string)=>ar?arabic:english;
 const url=useMemo(()=>setupEmbeddedUrl(href,organizationId),[href,organizationId]);
 const iframe=useRef<HTMLIFrameElement|null>(null);
 const [expanded,setExpanded]=useState(true);
 const [loading,setLoading]=useState(true);
 const [blocked,setBlocked]=useState(false);
 const [generation,setGeneration]=useState(0);
 const fullHref=url?url.replace(/([?&])setupEmbed=1(?:&|$)/,'$1').replace(/[?&]$/,''):href;
 function inspectLoadedWindow(){
  setLoading(false);
  try{
   const frame=iframe.current;
   const location=frame?.contentWindow?.location;
   const body=frame?.contentDocument;
   // Auth failure, outside-module redirects, or switched organizations must
   // never appear as an in-journey successfully loaded setup workspace.
   setBlocked(!location||!body||!route.test(location.pathname)||
    new URLSearchParams(location.search).get('organization')!==organizationId||
    !body.querySelector('[data-setup-embedded-document]'));
  }catch{setBlocked(true)}
 }
 function collapse(){
  if(!window.confirm(t('تأكد من حفظ التغييرات في النافذة قبل إغلاقها. هل تريد إغلاقها؟',
    'Make sure you saved changes in the window. Close it?')))return;
  setExpanded(false);onRefresh();
 }
 function reload(){
  if(!window.confirm(t('إعادة تحميل النافذة قد تفقد التعديلات غير المحفوظة. هل تتابع؟',
    'Reloading may discard unsaved edits. Continue?')))return;
  setLoading(true);setBlocked(false);setGeneration(n=>n+1);onRefresh();
 }
 if(!url)return <p role="alert" className="financial-setup-notice error">
  {t('تعذر تأكيد رابط المؤسسة لهذه المرحلة.','Could not verify this organization workspace route.')}
 </p>;
 return <section className="financial-setup-embedded" aria-label={t('نافذة عمل مرتبطة: ','Connected workspace: ')+stage}>
  <header className="financial-setup-embedded-head">
   <div><strong>{stage}</strong><small>{t('نافذة أصلية مرتبطة بالمؤسسة المختارة · البيانات والحفظ والاعتماد مباشر في النظام','Original workspace connected to the selected organization · live data, saves and approvals')}</small></div>
   <div className="financial-setup-embedded-actions">
    <button type="button" onClick={()=>{onRefresh();}}>{t('تحديث حالة المرحلة','Check readiness')}</button>
    {expanded&&<button type="button" onClick={reload}>{t('إعادة تحميل','Reload')}</button>}
    <Link href={fullHref} target="_blank" rel="noopener noreferrer">{t('فتح في صفحة مستقلة','Open full page')}</Link>
    <button type="button" onClick={expanded?collapse:()=>{setExpanded(true);setLoading(true);setBlocked(false)}}>
     {expanded?t('طي النافذة','Minimize'):t('فتح النافذة','Open window')}
    </button>
   </div>
  </header>
  {expanded&&<>
   {loading&&<p role="status" className="financial-setup-embedded-note">{t('جار تحميل بيانات المرحلة من النظام…','Loading stage data from the system…')}</p>}
   {blocked&&<p role="alert" className="financial-setup-notice error">
    {t('انتقلت النافذة إلى صفحة مختلفة أو تعذر تأكيد صلاحياتها. افتح الصفحة الأصلية وتحقق من تسجيل الدخول والمؤسسة المختارة.',
       'The window navigated outside the selected scope or access could not be confirmed. Open the original page and verify login and organization.')}
   </p>}
   <iframe key={url+':'+generation} ref={iframe} src={url} onLoad={inspectLoadedWindow}
    title={t('إدارة ','Manage ')+stage}
    className="financial-setup-embedded-frame" loading="eager" referrerPolicy="same-origin"/>
   <p className="financial-setup-embedded-footnote">
    {t('احفظ أو اعتمد في النافذة الأصلية، ثم اضغط «تحديث حالة المرحلة». علامات المراجعة لا تحفظ البيانات تلقائيًا.',
       'Save or approve inside the original workspace, then check readiness. Review checkmarks do not save data automatically.')}
   </p>
  </>}
 </section>
}
