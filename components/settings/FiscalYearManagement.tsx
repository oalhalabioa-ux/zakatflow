'use client';
import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {fiscalPeriod} from '../../lib/financial-fiscal';
import {fiscalError} from '../../lib/financial-opening-workspace';
import {suggestedFiscalStart,calendarFromContext,fiscalCalendarLocked,fiscalReferencesMatch,fiscalYearRows,type FiscalManagementContext} from '../../lib/financial-fiscal-years';

const endpoint='/api/financial-reporting/fiscal';
const arabicMonths=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const englishMonths=['January','February','March','April','May','June','July','August','September','October','November','December'];
async function json(response:Response){const value=await response.json();if(!response.ok)throw Error(value.error??'FISCAL_UNAVAILABLE');return value}
export default function FiscalYearManagement({organization,locale,previewContext,onEditState,onSaved}:{organization:string;locale:string;previewContext?:FiscalManagementContext;onEditState?:(dirty:boolean,busy:boolean)=>void;onSaved?:()=>void}){
 const ar=locale==='ar',t=(a:string,e:string)=>ar?a:e;
 const [data,setData]=useState<FiscalManagementContext|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0),[span,setSpan]=useState(2);
 const [month,setMonth]=useState('1'),[day,setDay]=useState('1'),[retained,setRetained]=useState(''),[reason,setReason]=useState('');
 const [action,setAction]=useState<{kind:'close'|'reopen';start:string;id?:string;version?:number}|null>(null),[actionReason,setActionReason]=useState('');
 const generation=useRef(0),activeOrganization=useRef(organization);activeOrganization.current=organization;
 useEffect(()=>{
  const controller=new AbortController();const current=++generation.current;setData(null);setError('');setLoading(true);setAction(null);setActionReason('');setReason('');setMonth('1');setDay('1');setRetained('');setSpan(2);
  if(previewContext){setData(previewContext);setMonth(suggestedFiscalStart(previewContext.calendar).month);setDay(suggestedFiscalStart(previewContext.calendar).day);setRetained(previewContext.calendar?.retained_earnings_account??'');setLoading(false);return()=>controller.abort()}
  fetch(endpoint+'?'+new URLSearchParams({action:'management',organization}),{cache:'no-store',signal:controller.signal}).then(json).then((value:FiscalManagementContext)=>{
   if(controller.signal.aborted||current!==generation.current)return;
   if(value.organizationId!==organization)throw Error('FISCAL_ACCESS_DENIED');
   setData(value);setMonth(suggestedFiscalStart(value.calendar).month);setDay(suggestedFiscalStart(value.calendar).day);setRetained(value.calendar?.retained_earnings_account??'');
  }).catch(e=>{if(!controller.signal.aborted&&current===generation.current)setError(e.message)}).finally(()=>{if(!controller.signal.aborted&&current===generation.current)setLoading(false)});
  return()=>controller.abort();
 },[organization,revision,previewContext]);
 async function command(body:unknown,success:string){
  if(previewContext)return;
  const target=organization,current=generation.current;setBusy(true);setError('');setMessage('');
  try{await json(await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
   if(activeOrganization.current!==target||generation.current!==current)return;
   setAction(null);setActionReason('');setReason('');setRevision(v=>v+1);setMessage(success);onSaved?.();
  }catch(e){if(activeOrganization.current===target&&generation.current===current){const code=e instanceof Error?e.message:'FISCAL_UNAVAILABLE';setError(code);if(/DENIED|UNAUTHORIZED/.test(code)){setData(null);setAction(null)}}}
  finally{if(activeOrganization.current===target)setBusy(false)}
 }
 const suggested=suggestedFiscalStart(data?.calendar??null);
 const dirty=!!data&&(month!==suggested.month||day!==suggested.day||retained!==(data.calendar?.retained_earnings_account??'')||!!reason.trim()||!!actionReason.trim());
 useEffect(()=>{onEditState?.(dirty,busy);return()=>onEditState?.(false,false)},[dirty,busy,onEditState]);
 const ready=data?.organizationId===organization?data:null,calendar=ready?calendarFromContext(ready):null,locked=ready?fiscalCalendarLocked(ready):false;
 const retainedCandidates=ready?.retainedCandidates??[];
 const retainedName=retainedCandidates.find(a=>a.code===calendar?.retainedEarningsAccount);
 const rows=ready?fiscalYearRows(ready,span):[],current=rows.find(r=>r.phase==='CURRENT');
 let preview:{start:string;end:string}|null=null;
 try{if(month&&day&&ready)preview=fiscalPeriod({startMonth:Number(month),startDay:Number(day),retainedEarningsAccount:retained},ready.asOf)}catch{}
 const budgets=ready?.references.filter(r=>r.source==='budget')??[],matching=!!calendar&&fiscalReferencesMatch(calendar,budgets);
 const changed=!!ready&&(!ready.calendar||Number(month)!==ready.calendar.start_month||Number(day)!==ready.calendar.start_day||retained!==ready.calendar.retained_earnings_account);
 function errorText(code:string){return code==='FISCAL_BUDGET_PERIOD_REVIEW_REQUIRED'?t('توجد موازنات مرتبطة بتقويم مختلف. يلزم تصحيح محاسبي معتمد قبل تغيير الإعداد.','Linked budgets use a different fiscal calendar. An authorized accounting correction is required before changing the setting.'):fiscalError(code,!ar)}
 if(loading)return <p role="status">{t('جارٍ تحميل السنوات المالية…','Loading fiscal years…')}</p>;
 return <div className="fiscal-management" lang={ar?'ar':'en'} data-fiscal-management>
  <header className="fiscal-management-heading"><div><h3>{t('إدارة السنوات المالية','Fiscal year management')}</h3><p>{t('تقويم مستقل لكل مؤسسة، مرتبط بالأرصدة الافتتاحية والقوائم والإقفال.','An independent calendar for each organization, shared by opening balances, statements and annual close.')}</p></div><button type="button" className="btn secondary" disabled={busy} onClick={()=>setRevision(v=>v+1)}>{t('تحديث','Refresh')}</button></header>
  {error&&<p role="alert" className="fiscal-notice error">{errorText(error)}</p>}{message&&<p role="status" className="fiscal-notice">{message}</p>}
  {ready&&<>
   <dl className="fiscal-summary" aria-label={t('ملخص السنة المالية','Fiscal year summary')}>
    <div><dt>{t('بداية السنة المالية','Fiscal year start')}</dt><dd><bdi>{calendar?`${String(calendar.startDay).padStart(2,'0')} / ${String(calendar.startMonth).padStart(2,'0')}`:t('غير محددة','Not configured')}</bdi></dd></div>
    <div><dt>{t('نهاية السنة المالية','Fiscal year end')}</dt><dd><bdi>{ready.period?.end??'—'}</bdi></dd></div>
    <div><dt>{t('السنة المالية الحالية','Current fiscal year')}</dt><dd><bdi>{ready.period?`${ready.period.start.slice(0,4)}${ready.period.start.slice(0,4)!==ready.period.end.slice(0,4)?' / '+ready.period.end.slice(0,4):''}`:'—'}</bdi></dd></div>
    <div><dt>{t('حالة السنة','Year status')}</dt><dd>{calendar?<span className={'fiscal-status '+(current?.status==='CLOSED'?'closed':'open')}>{current?.status==='CLOSED'?t('مقفلة','Closed'):t('مفتوحة','Open')}</span>:'—'}</dd></div>
    <div><dt>{t('حساب الأرباح المحتجزة','Retained earnings account')}</dt><dd><bdi>{calendar?.retainedEarningsAccount??'—'}</bdi>{retainedName&&<small> — {ar?retainedName.ar:retainedName.en}</small>}</dd></div>
   </dl>
   <section className="settings-card fiscal-calendar-settings" aria-labelledby="fiscal-calendar-title"><h3 id="fiscal-calendar-title">{t('إعداد التقويم المالي','Fiscal calendar configuration')}</h3>
    {!calendar&&<p className="settings-hint">{t('القيمة المقترحة هي 01/01 إلى 31/12؛ يمكن تعديلها. لن تُحفظ أو تُعتمد حتى تضغط حفظ إعداد السنة. عرض السنوات لا ينشئ سجلات أو قيودًا محاسبية.','Suggested default is January 1 through December 31. You can change it; no calendar is saved until you explicitly select Save fiscal calendar. Displaying years creates no accounting records or entries.')}</p>}
    {locked&&<p className="fiscal-notice">{ready.setupLockReason==='ACTIVITY'?t('بدأت العمليات الفعلية؛ تعديل إعدادات التأسيس مقفل. السنة تبقى مفتوحة للتسجيل ما لم تُقفل محاسبيًا.','Actual operations have started; setup changes are locked. The year remains open for posting until explicitly closed.'):ready.setupLockReason==='OPENING_REVIEW'?t('توجد أرصدة افتتاحية أو تخصيصات مرتبطة بالفترة؛ تغيير إعدادها يحتاج مراجعة هذه الأرصدة أولًا. هذا لا يعني أن السنة مقفلة.','Opening balances or source assignments reference this period and require review before configuration changes. This does not mean the year is closed.'):ready.setupLockReason==='BUDGET_REVIEW'?t('توجد موازنة مرتبطة بتواريخ التقويم؛ يلزم مراجعة ارتباطها قبل تعديل الإعدادات.','A budget references this calendar; review its period binding before changing configuration.'):t('تعديل إعدادات التقويم محمي بسبب سجلات فترات قائمة؛ التصحيح يحتاج إجراءً محاسبيًا مصرحًا ومسجلًا.','Existing period records protect calendar configuration; correction requires an authorized, audited procedure.')}</p>}
    {!locked&&ready.canConfigure&&<p className="settings-hint">{t('إعدادات التأسيس قابلة للتعديل قبل العمليات. تغيير تاريخ البداية يحفظ تاريخ قواعد الترحيل ويجهّز مسودة للفترة الجديدة تحتاج المراجعة والاعتماد.','Setup remains editable before operations. Changing the start date preserves posting-rule history and prepares a new-period draft for review and approval.')}</p>}
    <form className="settings-form" onSubmit={e=>{e.preventDefault();if(!ready.canConfigure||locked||!changed||busy)return;void command({action:'calendar',organization,month:Number(month),day:Number(day),retainedAccount:retained,expectedVersion:ready.calendar?.version??0,reason},t('تم حفظ إعداد السنة المالية.','Fiscal calendar saved.'))}}>
     <label>{t('شهر بداية السنة','Fiscal start month')}<select required aria-label={t('شهر بداية السنة','Fiscal start month')} lang="en" value={month} disabled={!ready.canConfigure||locked||busy} onChange={e=>setMonth(e.target.value)}><option value="">{t('اختر الشهر','Select month')}</option>{(ar?arabicMonths:englishMonths).map((label,i)=><option key={i} value={String(i+1)}>{String(i+1).padStart(2,'0')} — {label}</option>)}</select></label>
     <label>{t('يوم بداية السنة','Fiscal start day')}<input required aria-label={t('يوم بداية السنة','Fiscal start day')} type="number" lang="en" dir="ltr" min="1" max="31" value={day} disabled={!ready.canConfigure||locked||busy} onChange={e=>setDay(e.target.value)}/></label>
    <label>{t('حساب الأرباح المحتجزة التفصيلي','Retained earnings posting account')}<select required aria-label={t('حساب الأرباح المحتجزة التفصيلي','Retained earnings posting account')} value={retained} disabled={!ready.canConfigure||locked||busy||(!retainedCandidates.length&&!ready.calendar)} onChange={e=>setRetained(e.target.value)}>
     <option value="">{t('اختر حساباً تفصيلياً من دليل المؤسسة','Select an organization posting account')}</option>
     {calendar?.retainedEarningsAccount==='3300'&&<option value="3300">{t('3300 — حساب نظامي سابق (للتوافق فقط)','3300 — legacy system account (compatibility only)')}</option>}
     {retainedCandidates.map(a=><option key={a.code} value={a.code}>{a.code} — {ar?a.ar:a.en}</option>)}
    </select></label>
    {(!locked&&!retainedCandidates.length)&&<p className="settings-hint">{t('أنشئ أولاً حساباً تفصيلياً نشطاً وقابلاً للترحيل تحت الحساب 3300 في دليل حسابات المؤسسة.','First create an active, postable account beneath control 3300 in the organization chart of accounts.')} <Link href={`/${locale}/chart-of-accounts?organization=${encodeURIComponent(organization)}`}>{t('فتح دليل الحسابات','Open chart of accounts')}</Link></p>}
    {calendar?.retainedEarningsAccount==='3300'&&<p className="settings-hint">{t('هذا ربط قديم بالحساب النظامي الرئيسي. لن يتغير تلقائياً، والتصحيح يخضع لحماية الفترات المعتمدة.','This is a legacy link to the system control account. It will not be changed automatically; approved periods remain protected.')}</p>}
     {ready.canConfigure&&!locked&&<label>{t('سبب الإعداد أو الإجراء','Setup or action reason')}<input required aria-label={t('سبب الإعداد أو الإجراء','Setup or action reason')} minLength={3} maxLength={1000} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>}
     {preview&&<p role="status" className="settings-hint fiscal-period-preview" data-fiscal-period>{t('الفترة المالية المحسوبة: ','Calculated fiscal period: ')}<bdi>{preview.start} — {preview.end}</bdi></p>}
     {ready.canConfigure&&!locked&&<button className="btn" disabled={busy||!changed||!preview||reason.trim().length<3}>{t('حفظ إعداد السنة','Save fiscal calendar')}</button>}
    </form>
   </section>
   <section className="settings-card"><h3>{t('السنوات المالية','Fiscal years')}</h3><p className="settings-hint">{t('السنوات السابقة والحالية والمستقبلية تُحسب للعرض فقط. الإقفال وحده ينفذ مسار المحرك المالي وصلاحياته.','Previous, current and future years are calculated for display only. Closing a year explicitly runs the financial engine and its authorization checks.')}</p>
    {!calendar?<p>{t('اضبط التقويم لإظهار السنوات المالية.','Configure the calendar to display fiscal years.')}</p>:<><div className="fiscal-years-scroll" tabIndex={0} role="region" aria-label={t('جدول السنوات المالية','Fiscal years table')}><table className="fiscal-years-table"><thead><tr>{[t('السنة المالية','Fiscal year'),t('تاريخ البداية','Start date'),t('تاريخ النهاية','End date'),t('الحالة','Status'),t('الإجراءات','Actions')].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.start} data-fiscal-year={row.start} aria-current={row.phase==='CURRENT'?'date':undefined}>
     <th scope="row"><bdi>{row.start.slice(0,4)}{row.end&&row.end.slice(0,4)!==row.start.slice(0,4)?' / '+row.end.slice(0,4):''}</bdi><small>{row.phase==='CURRENT'?t('الحالية','Current'):row.phase==='FUTURE'?t('مستقبلية','Future'):t('سابقة','Previous')}{!row.recorded?' · '+t('عرض فقط','Display only'):''}</small></th>
     <td><bdi>{row.start}</bdi></td><td><bdi>{row.end??'—'}</bdi></td><td><span className={'fiscal-status '+(row.status==='CLOSED'?'closed':'open')}>{row.status==='CLOSED'?t('مقفلة','Closed'):t('مفتوحة','Open')}</span>{row.mismatch&&<small className="fiscal-conflict">{t('فترة قائمة تحتاج مراجعة','Existing period requires review')}</small>}</td>
     <td><div className="fiscal-row-actions"><Link href={`/${locale}/opening-balances?${new URLSearchParams({organization,fiscalStart:row.start})}`}>{t('الأرصدة الافتتاحية','Opening balances')}</Link>{row.canClose&&<button type="button" className="btn secondary" disabled={busy} onClick={()=>{setAction({kind:'close',start:row.start});setActionReason('')}}>{t('إقفال السنة','Close year')}</button>}{row.canReopen&&<button type="button" className="btn secondary" disabled={busy} onClick={()=>{setAction({kind:'reopen',start:row.start,id:row.closure!.id,version:row.closure!.version});setActionReason('')}}>{t('إعادة الفتح للتصحيح','Reopen for correction')}</button>}</div></td>
    </tr>)}</tbody></table></div><button type="button" className="btn secondary fiscal-more" disabled={span>=10} onClick={()=>setSpan(s=>Math.min(10,s+2))}>{t('عرض سنوات إضافية','Show more years')}</button></>}
   </section>
   <section className="settings-card" data-budget-calendar-check><h3>{t('ارتباط الموازنات التقديرية','Budget calendar alignment')}</h3><p>{!calendar?t('يلزم تحديد تقويم المؤسسة للتحقق من الخطط المرتبطة.','Configure the organization calendar to check linked plans.'):!budgets.length?t('لا توجد خطط موازنة مرتبطة بهذه المؤسسة.','No budget plans are linked to this organization.'):matching?t('تواريخ بداية جميع الخطط المرتبطة مطابقة لتقويم المؤسسة.','All linked plan start dates match the organization calendar.'):t('توجد خطط مرتبطة بتواريخ تختلف عن التقويم. تبقى بياناتها محفوظة وتحتاج إلى مراجعة محاسبية.','Some linked plan dates differ from the calendar. Their records are preserved and require accounting review.')}</p><p className="settings-hint">{t('عدد الخطط المرتبطة: ','Linked plans: ')}<bdi>{String(budgets.length)}</bdi></p><Link href={`/${locale}/budget-planning?organization=${encodeURIComponent(organization)}`}>{t('فتح التخطيط المالي والموازنات','Open budget planning')}</Link></section>
   {action&&<section className="settings-card fiscal-action-panel" role="region" aria-label={t('تأكيد الإجراء المحاسبي','Confirm accounting action')}><h3>{action.kind==='close'?t('إقفال السنة وتجهيز الافتتاح التالي','Close year and prepare next opening'):t('إعادة فتح السنة للتصحيح','Reopen year for correction')}</h3><p><bdi>{action.start}</bdi></p><p className="settings-hint">{action.kind==='close'?t('يفحص النظام توازن الأرصدة واكتمال المصادر والصلاحيات، ثم يسجل الإقفال وافتتاح السنة التالية.','The engine validates balances, source coverage and permissions, then records the close and next opening.'):t('يسجل النظام سبب التصحيح ويحافظ على إصدار الإقفال السابق، ويرفض الإجراء إذا كانت سنوات تالية معتمدة تمنعه.','The engine records the correction reason and preserves the prior close version. Approved successor years can block reopening.')}</p><form className="settings-form" onSubmit={e=>{e.preventDefault();if(busy||actionReason.trim().length<3)return;void command(action.kind==='close'?{action:'close',organization,fiscalStart:action.start,requestId:crypto.randomUUID(),reason:actionReason}:{action:'reopen',organization,closeId:action.id,expectedVersion:action.version,reason:actionReason},t('تم تنفيذ الإجراء المحاسبي وتسجيله.','Accounting action completed and audited.'))}}><label>{t('سبب الإجراء المحاسبي','Accounting action reason')}<textarea autoFocus required minLength={3} maxLength={1000} value={actionReason} onChange={e=>setActionReason(e.target.value)} disabled={busy}/></label><div className="fiscal-row-actions"><button className="btn" disabled={busy||actionReason.trim().length<3}>{t('تأكيد الإجراء','Confirm action')}</button><button className="btn secondary" type="button" disabled={busy} onClick={()=>setAction(null)}>{t('إلغاء','Cancel')}</button></div></form></section>}
  </>}
 </div>;
}
