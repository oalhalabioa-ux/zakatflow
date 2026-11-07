'use client';
import TopbarOrganizationControls from '../TopbarOrganizationControls';
import WorkspaceOrganizationPicker from '../WorkspaceOrganizationPicker';
import {rememberedOrganization} from '../../lib/workspace-organization';
import {useEffect,useMemo,useState} from 'react';
import './chart-of-accounts.css';
import {accountingPresentationTree,chartIntegrationMessage,type ChartPostingIntegration} from '../../lib/financial-chart-hierarchy';
import {FINANCIAL_INDUSTRIES,industryAccountTemplate,industryTemplatePreview,isFinancialIndustry,type FinancialIndustry,type FinancialAccountTemplate} from '../../lib/financial-chart-templates';

type Account={id:string;code:string;parentCode:string|null;reportingCode:string;ar:string;en:string;kind:string;presentation?:string;normalSide:'DEBIT'|'CREDIT';isSystem:boolean;isActive:boolean;isPostable:boolean;version:number};
type Workspace={organizationId:string;accounts:Account[];canManage:boolean;postingIntegration:ChartPostingIntegration};
type Institution={id:string;name:string;base_currency:string};
type Draft={code:string;parentCode:string;nameAr:string;nameEn:string;normalSide:'DEBIT'|'CREDIT';isPostable:boolean;isActive:boolean;expectedVersion:number;reason:string};
const blank=(parentCode=''):Draft=>({code:'',parentCode,nameAr:'',nameEn:'',normalSide:'DEBIT',isPostable:true,isActive:true,expectedVersion:0,reason:''});
const statusCodes:Record<string,string>={CHART_PARENT_NOT_FOUND:'الحساب الأب غير موجود أو غير نشط.',CHART_PARENT_IS_POSTABLE:'حوّل الحساب الأب إلى حساب تجميعي قبل إضافة حساب فرعي له.',CHART_VERSION_CONFLICT:'تم تعديل الحساب من مستخدم آخر. حدّث الصفحة ثم أعد المحاولة.',CHART_HAS_ACTIVE_CHILDREN:'لا يمكن تعطيل أو تفعيل الترحيل على حساب له فروع نشطة.',CHART_REFERENCED_BY_POLICY:'لا يمكن إيقاف الحساب أو تغيير طبيعته لأنه مستخدم في قواعد ترحيل محفوظة.',CHART_STRUCTURE_IMMUTABLE:'لا يمكن تغيير تبعية حساب موجود.',CHART_WRITE_DENIED:'ليس لديك صلاحية تعديل دليل الحسابات.',CHART_ACCESS_DENIED:'لا تملك صلاحية قراءة دليل هذه المؤسسة.',CHART_INPUT_INVALID:'راجع رمز الحساب والحقول المطلوبة وسبب التعديل.'};
const standardized=new Map(FINANCIAL_INDUSTRIES.flatMap(industry=>industryAccountTemplate(industry.id)).map(account=>[account.code,account]));
const parentCode=(code:string)=>code.slice(0,-2);
function suggestion(parent:string,accounts:Account[]){
 if(!parent)return '';
 for(let n=1;n<=99;n++){const code=parent+String(n).padStart(2,'0');if(!accounts.some(a=>a.code===code))return code}
 return '';
}
async function json(response:Response){const result=await response.json();if(!response.ok)throw Error(result.error??'CHART_UNAVAILABLE');return result}
export default function ChartOfAccountsWorkspace({locale,preferredOrg='',preferredTemplate='',setupEmbedded=false,setupSection='all'}:{
 locale:string;preferredOrg?:string;preferredTemplate?:string;setupEmbedded?:boolean;
 setupSection?:'all'|'structure'|'accounts'|'templates'|'review';
}){
 const en=locale==='en',t=(ar:string,english:string)=>en?english:ar;
 const[orgs,setOrgs]=useState<Institution[]>([]),[organization,setOrganization]=useState(''),[data,setData]=useState<Workspace|null>(null);
 const[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const[revision,setRevision]=useState(0),[query,setQuery]=useState(''),[kind,setKind]=useState('ALL'),[activeOnly,setActiveOnly]=useState(true);
 const[selected,setSelected]=useState(''),[expanded,setExpanded]=useState<string[]>([]),[draft,setDraft]=useState<Draft|null>(null);
 const[templateOpen,setTemplateOpen]=useState(!!preferredTemplate),[templateIndustry,setTemplateIndustry]=useState<FinancialIndustry>(isFinancialIndustry(preferredTemplate)?preferredTemplate:'GENERAL');
 useEffect(()=>{const controller=new AbortController();fetch('/api/financial-reporting/openings?action=context',{cache:'no-store',signal:controller.signal}).then(json).then((organizations:Institution[])=>{if(controller.signal.aborted)return;setOrgs(organizations);setOrganization(v=>v||organizations.find(o=>o.id===(preferredOrg||rememberedOrganization()))?.id||organizations[0]?.id||'');setLoading(false)}).catch(e=>{if(!controller.signal.aborted){setError(String(e.message));setLoading(false)}});return()=>controller.abort()},[preferredOrg]);
 useEffect(()=>{if(!organization){setData(null);return}const controller=new AbortController();setLoading(true);setError('');setDraft(null);fetch('/api/financial-reporting/chart?'+new URLSearchParams({organization}),{cache:'no-store',signal:controller.signal}).then(json).then((value:Workspace)=>{if(controller.signal.aborted)return;if(value.organizationId!==organization)throw Error('CHART_UNAVAILABLE');setData(value);setLoading(false)}).catch(e=>{if(!controller.signal.aborted){setData(null);setError(e.message);setLoading(false)}});return()=>controller.abort()},[organization,revision]);
 const accounts=useMemo(()=>data?.accounts??[],[data]),byCode=useMemo(()=>new Map(accounts.map(a=>[a.code,a])),[accounts]);
 const roots=useMemo(()=>accounts.filter(a=>!a.parentCode),[accounts]);
 const presentationTree=useMemo(()=>accountingPresentationTree(accounts),[accounts]);
 const templatePreview=useMemo(()=>industryTemplatePreview(templateIndustry,accounts),[templateIndustry,accounts]);
 const matching=useMemo(()=>accounts.filter(a=>(!activeOnly||a.isActive)&&(kind==='ALL'||a.kind===kind)&&(!selected||a.code===selected||a.code.startsWith(selected))&&(!query||`${a.code} ${a.ar} ${a.en}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))),[accounts,activeOnly,kind,query,selected]);
 const types=[...new Set(roots.map(r=>r.kind))];
 function toggle(code:string){setExpanded(v=>v.includes(code)?v.filter(c=>c!==code):[...v,code])}
 function create(parent:string){const parentAccount=byCode.get(parent);setDraft({...blank(parent),code:suggestion(parent,accounts),normalSide:parentAccount?.normalSide??'DEBIT'});setError('');setSuccess('')}
 function edit(account:Account){if(account.isSystem)return;setDraft({code:account.code,parentCode:account.parentCode??'',nameAr:account.ar,nameEn:account.en,normalSide:account.normalSide,isPostable:account.isPostable,isActive:account.isActive,expectedVersion:account.version,reason:''});setError('');setSuccess('')}
 async function submit(){if(!draft||!organization)return;setBusy(true);setError('');setSuccess('');try{
  if(draft.parentCode!==parentCode(draft.code))throw Error('CHART_INPUT_INVALID');
  await json(await fetch('/api/financial-reporting/chart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organization,...draft})}));
  setSelected(draft.parentCode);setExpanded(v=>[...new Set([...v,draft.parentCode])]);setDraft(null);setSuccess(t('تم حفظ الحساب في دليل المؤسسة.','Organization account saved.'));setRevision(v=>v+1);
 }catch(e){setError(e instanceof Error?e.message:'CHART_UNAVAILABLE')}finally{setBusy(false)}}
 async function addTemplateAccount(item:FinancialAccountTemplate){
  if(!data?.canManage||!organization||busy||templatePreview.find(row=>row.code===item.code)?.status!=='available')return;
  setBusy(true);setError('');setSuccess('');
  try{
   await json(await fetch('/api/financial-reporting/chart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    organization,code:item.code,parentCode:item.parentCode,nameAr:item.nameAr,nameEn:item.nameEn,normalSide:item.normalSide,
    isPostable:true,isActive:true,expectedVersion:0,reason:`Account template ${item.source}: ${item.code}`,
   })}));
   setSelected('');setExpanded(previous=>[...new Set([...previous,item.parentCode])]);
   setSuccess(t('أُضيف الحساب الفرعي إلى دليل المؤسسة دون تغيير أي حساب قائم.','The child account was added without changing an existing account.'));
   setRevision(value=>value+1);
  }catch(error){setError(error instanceof Error?error.message:'CHART_UNAVAILABLE')}finally{setBusy(false)}
 }
 function exportCsv(){const rows=[['Account Code','Arabic Name','English Name','Parent','Reporting Code','Normal Side','Active','Postable'],...matching.map(a=>[a.code,a.ar,a.en,a.parentCode??'',a.reportingCode,a.normalSide,String(a.isActive),String(a.isPostable)])];const safe=(value:string)=>'"'+(/^[\s]*[=+@-]/.test(value)?"'"+value:value).replace(/"/g,'""')+'"';const csv='\uFEFF'+rows.map(row=>row.map(safe).join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='yaqeen-chart-of-accounts.csv';a.click();URL.revokeObjectURL(url)}
 const renderNode=(account:Account,depth=0):React.ReactNode=>{const children=accounts.filter(a=>a.parentCode===account.code);const open=expanded.includes(account.code);return <div key={account.code}>
  <div className={'coa-tree-item'+(selected===account.code?' selected':'')} style={{paddingInlineStart:12+depth*14}}>
   <button aria-label={t('توسيع الحساب','Expand account')} className="coa-tree-expand" onClick={()=>toggle(account.code)} disabled={!children.length}>{children.length?(open?'⌄':'›'):'·'}</button>
   <button className="coa-tree-label" onClick={()=>setSelected(v=>v===account.code?'':account.code)} title={account.code+' · '+account.ar}><bdi dir="ltr">{account.code}</bdi> {en?account.en:account.ar}</button>
   {!account.isSystem&&!account.isActive&&<span className="coa-inactive-dot" title={t('غير نشط','Inactive')}/>}
   {data?.canManage&&account.code.length<10&&<button className="coa-small-add" onClick={()=>create(account.code)} aria-label={t('إضافة حساب فرعي','Add child account')}>+</button>}
  </div>
  {open&&children.map(c=>renderNode(c,depth+1))}
 </div>};
 return <main className="coa-page" dir={en?'ltr':'rtl'}><div className="coa-title"><div><h1>{t('دليل الحسابات','Chart of accounts')}</h1><p>{t('هيكل الحسابات المالية الخاص بكل مؤسسة','Organization-specific financial account structure')}</p></div><div className="coa-top-actions">
  <button onClick={exportCsv} disabled={!matching.length}>{t('تصدير CSV','Export CSV')}</button>
  <button aria-expanded={templateOpen} aria-controls="coa-industry-templates" onClick={()=>setTemplateOpen(open=>!open)}>{t('قوالب الحسابات الفرعية','Subaccount templates')}</button>
  <button className="coa-primary" disabled={!data?.canManage} onClick={()=>create(roots[0]?.code??'')}>+ {t('إضافة حساب فرعي','Add subaccount')}</button>
 </div></div>
 <div className="coa-notice" role="note">{chartIntegrationMessage(data?.postingIntegration,locale)}</div>
 <div className="coa-org">{!setupEmbedded&&<TopbarOrganizationControls><WorkspaceOrganizationPicker ar={!en} label={t('المؤسسة','Organization')} organizations={orgs} value={organization} restore={false} disabled={busy||setupEmbedded} beforeChange={()=>!draft||window.confirm(t('تجاهل تعديل الحساب غير المحفوظ؟','Discard the unsaved account edit?'))} onChange={id=>{setData(null);setSelected('');setSuccess('');setOrganization(id)}}/></TopbarOrganizationControls>}<button onClick={()=>setRevision(v=>v+1)} disabled={loading}>{t('تحديث','Refresh')}</button></div>
 {error&&<div className="coa-alert" role="alert">{statusCodes[error]??t('تعذرت العملية. راجع الصلاحيات أو البيانات ثم حاول مجدداً.','Operation failed. Check your permissions and input.')}</div>}
 {success&&<div className="coa-success" role="status">{success}</div>}
 {loading&&<p role="status">{t('جار تحميل الدليل…','Loading chart…')}</p>}
 {!loading&&!!data&&<><div className="coa-stats"><div><span>{t('إجمالي الحسابات','Total accounts')}</span><b>{accounts.length}</b></div><div><span>{t('الحسابات الفرعية','Subaccounts')}</span><b>{accounts.filter(a=>!a.isSystem).length}</b></div><div><span>{t('الحسابات النشطة','Active accounts')}</span><b>{accounts.filter(a=>a.isActive).length}</b></div><div><span>{t('الحسابات التجميعية','Summary accounts')}</span><b>{accounts.filter(a=>!a.isPostable).length}</b></div></div>
 {(templateOpen||(setupEmbedded&&setupSection==='templates'))&&<section id="coa-industry-templates" className="coa-template-panel" aria-label={t('قوالب الحسابات الفرعية','Subaccount templates')}>
  <div className="coa-template-heading"><div><h2>{t('دليل رئيسي موحد — حسابات فرعية بحسب النشاط','Shared main chart — industry-specific subaccounts')}</h2><p>{t('كل حساب في القالب يتبع رقمًا رئيسيًا من 4 خانات، وله رقم تفصيلي من 6 خانات. لا تُستبدل الحسابات الرئيسية ولا تُعدّل الأرصدة الحالية.','Every template account sits beneath a four-digit shared control account and uses a six-digit child code. Existing accounts and balances are never overwritten.')}</p></div><label>{t('نوع النشاط','Industry')}<select value={templateIndustry} onChange={event=>setTemplateIndustry(event.target.value as FinancialIndustry)}>{FINANCIAL_INDUSTRIES.map(item=><option key={item.id} value={item.id}>{en?item.en:item.ar}</option>)}</select></label></div>
  <div className="coa-template-scroll"><table><thead><tr><th>{t('الحساب الرئيسي المشترك','Shared control account')}</th><th>{t('رقم الحساب الفرعي','Child account code')}</th><th>{t('اسم الحساب الفرعي','Child account name')}</th><th>{t('القالب','Template')}</th><th>{t('حالة الرقم','Code status')}</th><th>{t('إجراء','Action')}</th></tr></thead><tbody>{templatePreview.map(item=><tr key={item.code}><td><bdi dir="ltr">{item.parentCode}</bdi><span>{en?byCode.get(item.parentCode)?.en:byCode.get(item.parentCode)?.ar}</span></td><td><strong dir="ltr">{item.code}</strong></td><td>{en?item.nameEn:item.nameAr}</td><td>{item.source==='CORE'?t('مشترك','Shared'):(en?FINANCIAL_INDUSTRIES.find(group=>group.id===item.source)?.en:FINANCIAL_INDUSTRIES.find(group=>group.id===item.source)?.ar)}</td><td><span className={'coa-template-status '+item.status}>{item.status==='available'?t('جاهز للإضافة','Available'):item.status==='matching'?t('موجود في الدليل','Already in chart'):t('تعارض: الرقم مستخدم','Code occupied')}</span></td><td><button type="button" disabled={!data.canManage||busy||item.status!=='available'} onClick={()=>void addTemplateAccount(item)}>{item.status==='available'?t('+ إضافة','+ Add'):'—'}</button></td></tr>)}</tbody></table></div>
  <p className="coa-template-explanation">{t('تُضاف الحسابات المختارة إلى دليل هذه المؤسسة فقط، واحدًا تلو الآخر، مع سجل مراجعة لكل إضافة. أي رقم مستخدم لحساب مختلف يُعرض كتعارض ولا يُغيَّر تلقائيًا. الربط المحاسبي والاعتمادات إجراء مستقل.','Selected accounts are added only to this organization, one at a time, with an audit record per addition. Occupied codes are flagged and never replaced. Posting and accounting approval remain separate.')}</p>
 </section>}
 <div className="coa-workspace"><aside className="coa-tree"><h2>{t('شجرة الحسابات','Account tree')}</h2><button className="coa-show-all" onClick={()=>setSelected('')}>{t('عرض جميع الحسابات','Show all accounts')}</button>{presentationTree.map(group=><section className="coa-account-group" key={group.key} aria-label={en?group.en:group.ar}><h3>{en?group.en:group.ar}</h3>{group.sections.map(section=><div className="coa-account-section" key={section.key}><h4>{en?section.en:section.ar}</h4>{section.accounts.map(a=>renderNode(a))}</div>)}</section>)}</aside>
 <section className="coa-register"><div className="coa-filter"><input aria-label={t('بحث','Search')} placeholder={t('البحث برمز الحساب أو الاسم…','Search by code or name…')} value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label={t('التصنيف','Classification')} value={kind} onChange={e=>setKind(e.target.value)}><option value="ALL">{t('جميع التصنيفات','All categories')}</option>{types.map(k=><option value={k} key={k}>{k}</option>)}</select><label><input type="checkbox" checked={activeOnly} onChange={e=>setActiveOnly(e.target.checked)}/>{t('النشطة فقط','Active only')}</label></div>
 <div className="coa-scroll"><table><thead><tr>{[t('رمز الحساب','Code'),t('اسم الحساب','Account name'),t('التصنيف','Category'),t('طبيعة الحساب','Normal side'),t('الحساب الرقابي','Control account'),t('الحالة','Status'),t('الإجراءات','Actions')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{matching.map(a=><tr key={a.code}><td><bdi dir="ltr">{a.code}</bdi></td><td>{en?a.en:a.ar}{a.isSystem?<small>{t('رئيسي مشترك','Shared main account')}</small>:standardized.get(a.code)?.nameAr===a.ar&&standardized.get(a.code)?.nameEn===a.en?<small>{t('حساب فرعي مطابق للقالب','Template-matched subaccount')}</small>:<small>{t('حساب فرعي للمؤسسة','Organization subaccount')}</small>}</td><td>{a.kind}</td><td>{a.normalSide==='DEBIT'?t('مدين','Debit'):t('دائن','Credit')}</td><td><bdi dir="ltr">{a.reportingCode}</bdi></td><td><span className={a.isActive?'coa-pill active':'coa-pill'}>{a.isActive?t('نشط','Active'):t('غير نشط','Inactive')}</span></td><td>{!a.isSystem&&data.canManage?<button onClick={()=>edit(a)}>{t('تعديل','Edit')}</button>:'—'}</td></tr>)}</tbody></table>{!matching.length&&<p className="coa-empty">{t('لا توجد حسابات تطابق البحث.','No matching accounts.')}</p>}</div></section></div></>}
 {draft&&<div className="coa-drawer-backdrop" onClick={()=>!busy&&setDraft(null)}><section className="coa-drawer" style={{direction:en?'ltr':'rtl'}} onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('إدارة حساب','Account editor')}><header><h2>{draft.expectedVersion?t('تعديل حساب','Edit account'):t('إضافة حساب فرعي','Add subaccount')}</h2><button disabled={busy} onClick={()=>setDraft(null)}>✕</button></header>
  <label>{t('الحساب الأب','Parent account')}<select disabled={busy||draft.expectedVersion>0} value={draft.parentCode} onChange={e=>{const parent=e.target.value;setDraft(v=>v?{...v,parentCode:parent,code:suggestion(parent,accounts),normalSide:byCode.get(parent)?.normalSide??'DEBIT'}:v)}}><option value="">{t('اختر حساباً','Choose parent')}</option>{accounts.filter(a=>a.isActive&&a.code.length<10&&(a.isSystem||!a.isPostable)).map(a=><option key={a.code} value={a.code}>{a.code} · {en?a.en:a.ar}</option>)}</select></label>
  <label>{t('رمز الحساب','Account code')}<input required disabled={busy||draft.expectedVersion>0} value={draft.code} onChange={e=>setDraft(v=>v?{...v,code:e.target.value}:v)} dir="ltr" maxLength={10}/></label>
  <label>{t('اسم الحساب بالعربية','Arabic name')}<input required disabled={busy} value={draft.nameAr} onChange={e=>setDraft(v=>v?{...v,nameAr:e.target.value}:v)} maxLength={160}/></label>
  <label>{t('اسم الحساب بالإنجليزية','English name')}<input required disabled={busy} value={draft.nameEn} onChange={e=>setDraft(v=>v?{...v,nameEn:e.target.value}:v)} maxLength={160}/></label>
  <label>{t('طبيعة الرصيد','Normal balance')}<select disabled={busy} value={draft.normalSide} onChange={e=>setDraft(v=>v?{...v,normalSide:e.target.value as 'DEBIT'|'CREDIT'}:v)}><option value="DEBIT">{t('مدين','Debit')}</option><option value="CREDIT">{t('دائن','Credit')}</option></select></label>
  <label className="coa-check"><input type="checkbox" disabled={busy} checked={draft.isPostable} onChange={e=>setDraft(v=>v?{...v,isPostable:e.target.checked}:v)}/>{t('حساب تفصيلي (متاح لقواعد الترحيل الجديدة)','Detail account (available in new posting policies)')}</label>
  <label className="coa-check"><input type="checkbox" disabled={busy} checked={draft.isActive} onChange={e=>setDraft(v=>v?{...v,isActive:e.target.checked}:v)}/>{t('حساب نشط','Active account')}</label>
  <label>{t('سبب الإضافة أو التعديل','Reason for change')}<textarea required disabled={busy} value={draft.reason} onChange={e=>setDraft(v=>v?{...v,reason:e.target.value}:v)} maxLength={1000} rows={3}/></label>
  <footer><button onClick={()=>setDraft(null)} disabled={busy}>{t('إلغاء','Cancel')}</button><button className="coa-primary" disabled={busy||!draft.code||!draft.parentCode||!draft.nameAr.trim()||!draft.nameEn.trim()||draft.reason.trim().length<3} onClick={submit}>{busy?t('جار الحفظ…','Saving…'):t('حفظ الحساب','Save account')}</button></footer>
 </section></div>}
 </main>;
}
