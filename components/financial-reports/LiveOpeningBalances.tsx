'use client';
import TopbarOrganizationControls from '../TopbarOrganizationControls';
import WorkspaceOrganizationPicker from '../WorkspaceOrganizationPicker';
import {rememberedOrganization} from '../../lib/workspace-organization';
import type {OpeningTab} from '../../lib/financial-opening-preview';
import {useEffect,useRef,useState} from 'react';
import {OpeningWorkspace} from './OpeningBalancesPreview';
import {ReportCard} from './ReportCharts';
import {fiscalError,type OpeningWorkspaceData,type OpeningEntries} from '../../lib/financial-opening-workspace';
const endpoint='/api/financial-reporting/openings';
type Org={id:string;name:string;base_currency:string;currentFiscalStart?:string|null;canEditCenterOpenings?:boolean};
async function json(response:Response){const data=await response.json();if(!response.ok)throw Error(data.error??'OPENING_UNAVAILABLE');return data}
export default function LiveOpeningBalances({locale,preferredOrg='',preferredFiscalStart='',setupEmbedded=false,onSaved}:{locale:string;preferredOrg?:string;preferredFiscalStart?:string;setupEmbedded?:boolean;onSaved?:()=>void}){
 const en=locale==='en',t=(ar:string,english:string)=>en?english:ar;
 const[organizations,setOrganizations]=useState<Org[]>([]),[organization,setOrganization]=useState(''),[fiscalStart,setFiscalStart]=useState(''),[data,setData]=useState<OpeningWorkspaceData|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const[contextLoading,setContextLoading]=useState(true),[contextError,setContextError]=useState(''),[validatedContext,setValidatedContext]=useState('');
 const contextKey=JSON.stringify([preferredOrg,preferredFiscalStart]),contextReady=!contextLoading&&!contextError&&validatedContext===contextKey;
 const dirty=useRef(false);
 const reportDirty=useRef((value:boolean)=>{dirty.current=value}).current;
 const selectedTab=useRef<{scope:string;tab:OpeningTab}|null>(null);
 const generation=useRef(0),current=useRef('');current.current=organization+fiscalStart;
 useEffect(()=>{const controller=new AbortController();setContextLoading(true);setContextError('');fetch(endpoint+'?action=context',{cache:'no-store',signal:controller.signal}).then(json).then((orgs:Org[])=>{if(controller.signal.aborted)return;setOrganizations(orgs);const desired=preferredOrg;const initial=desired?orgs.find((o:{id:string})=>o.id===desired):(orgs.find(o=>o.id===rememberedOrganization())??orgs[0]);setOrganization(initial?.id??'');setFiscalStart(/^\d{4}-\d{2}-\d{2}$/.test(preferredFiscalStart)?preferredFiscalStart:initial?.currentFiscalStart??'');setValidatedContext(JSON.stringify([preferredOrg,preferredFiscalStart]))}).catch(e=>{if(!controller.signal.aborted){setOrganizations([]);setOrganization('');setFiscalStart('');setData(null);setContextError(e.message)}}).finally(()=>{if(!controller.signal.aborted)setContextLoading(false)});return()=>controller.abort()},[preferredOrg,preferredFiscalStart]);
 useEffect(()=>{const controller=new AbortController(),key=++generation.current;setData(null);setError('');if(!contextReady||!organization||!fiscalStart){setBusy(false);return()=>controller.abort()}setBusy(true);
  fetch(endpoint+'?'+new URLSearchParams({organization,fiscalStart}),{cache:'no-store',signal:controller.signal}).then(json).then(value=>{if(generation.current===key)setData(value)}).catch(e=>{if(!controller.signal.aborted&&generation.current===key)setError(e.message)}).finally(()=>{if(!controller.signal.aborted&&generation.current===key)setBusy(false)});
  return()=>controller.abort();
 },[organization,fiscalStart,reload,contextReady]);
 function refreshSources(){
  generation.current++;
  setData(null);
  setError('');
  setBusy(true);
  setReload(v=>v+1);
 }
 async function command(body:unknown,action?:'save'|'approve'){const key=generation.current;setBusy(true);setError('');setNotice('');try{const saved=await json(await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));if(generation.current===key){if(action==='save')setNotice(t('تم حفظ المسودة بنجاح · الإصدار ','Draft saved successfully · version ')+String(saved.version??''));if(action==='approve')setNotice(t('تم اعتماد الأرصدة بنجاح.','Opening balances approved successfully.'));setReload(v=>v+1);onSaved?.();}}catch(e){if(generation.current===key){setError(e instanceof Error?e.message:'OPENING_UNAVAILABLE');if(e instanceof Error&&/DENIED|UNAUTHORIZED/.test(e.message))setData(null)}}finally{if(generation.current===key)setBusy(false)}}
 async function save(entries:OpeningEntries,reason:string){if(!data)return;await command({action:'save',organization,fiscalStart,expectedVersion:data.workspace?.status==='DRAFT'?data.workspace.version:0,sourceRevision:data.source.revision,entries,reason},'save')}
 async function approve(){if(!data?.workspace)return;await command({action:'approve',id:data.workspace.id,expectedVersion:data.workspace.version},'approve')}
 async function beforeExport(){if(!data)throw Error('OPENING_UNAVAILABLE');const key=current.current,requestGeneration=generation.current;let fresh:OpeningWorkspaceData;try{fresh=await json(await fetch(endpoint+'?'+new URLSearchParams({organization,fiscalStart}),{cache:'no-store'}))}catch(e){if(current.current===key){setError(e instanceof Error?e.message:'OPENING_UNAVAILABLE');setData(null)}throw e}if(generation.current!==requestGeneration||current.current!==key||fresh.source.revision!==data.source.revision||fresh.workspace?.version!==data.workspace?.version)throw Error('OPENING_SOURCE_CHANGED')}
 function confirmSwitch(){return !dirty.current||window.confirm(t('لديك تغييرات غير محفوظة. هل تريد تجاهلها؟','Discard unsaved changes?'))}
 const ready=contextReady&&data?.organizationId===organization&&data.fiscalStart===fiscalStart?data:null;
 function changeFiscalStart(value:string){
  if(value&&confirmSwitch())setFiscalStart(value);
 }
 function createCorrectionDraft(){
  if(ready?.workspace?.status!=='APPROVED')return;
  void command({action:'save',organization,fiscalStart,expectedVersion:0,sourceRevision:ready.source.revision,entries:ready.workspace.entries,reason:''});
 }
 return <div className="fs-root" lang={en?'en':'ar'} dir={en?'ltr':'rtl'}>
  {!setupEmbedded&&<TopbarOrganizationControls><WorkspaceOrganizationPicker ar={!en} label={t('المؤسسة','Organization')} organizations={organizations} value={organization} restore={false} disabled={!contextReady||busy} beforeChange={confirmSwitch} onChange={id=>{const url=new URL(location.href);url.searchParams.delete('fiscalStart');window.history.replaceState(null,'',url);setOrganization(id);setFiscalStart(organizations.find(o=>o.id===id)?.currentFiscalStart??'')}}/></TopbarOrganizationControls>}
  {(contextError||error)&&<p className="ob-invalid" role="alert">{fiscalError(contextError||error,en)}</p>}{notice&&<p className="ob-save-success" role="status">{notice}</p>}{(contextLoading||busy&&!data)&&<p role="status">{t('جار تحميل الأرصدة والسندات…','Loading balances and vouchers…')}</p>}
  {contextReady&&!organizations.length&&!busy&&!error&&<p role="status">{t('لا توجد مؤسسات متاحة بصلاحية عرض القوائم.','No organizations are available with financial report permission.')}</p>}
  {contextReady&&!busy&&!error&&!fiscalStart&&organizations.some(o=>o.id===organization)&&<div className="fs-surface ob-surface">
   <header className="fs-page-header"><div><h1>{t('الأرصدة الافتتاحية','Opening balances')}</h1></div></header>
   <ReportCard icon="calendar" title={t('يلزم إعداد السنة المالية','Fiscal year setup required')}>
    <div role="status" data-opening-prerequisite="SETUP"><p>{t('لم تُعدّ السنة المالية لهذه المؤسسة بعد. راجع إعداد السنة المالية أولًا، ثم عُد إلى الأرصدة الافتتاحية.','This organization’s fiscal year is not configured yet. Review its fiscal year setup, then return to opening balances.')}</p>
     <a href={`/${en?'en':'ar'}/settings/financial/fiscal-years?scope=ORGANIZATION&organization=${encodeURIComponent(organization)}&level=COMPANY`}>{t('إعداد السنة المالية للمؤسسة','Set up this organization’s fiscal year')}</a>
    </div>
   </ReportCard>
  </div>}
  {contextReady&&!ready&&organization&&!busy&&error&&!/DENIED|UNAUTHORIZED/.test(error)&&<div className="fs-filter-strip ob-scope">
   <label>{t('بداية السنة المالية','Fiscal year start')}<input type="date" value={fiscalStart} onChange={e=>changeFiscalStart(e.target.value)}/></label>
   <button className="ob-review-trigger" disabled={!fiscalStart} onClick={refreshSources}>{t('إعادة المحاولة','Retry')}</button>
  </div>}
  {ready&&<OpeningWorkspace key={organization+fiscalStart+':'+(ready.workspace?.version??0)+':'+ready.source.revision} org={organization} en={en} initialTab={selectedTab.current?.scope===organization+fiscalStart?selectedTab.current.tab:undefined} onTabChange={tab=>{selectedTab.current={scope:organization+fiscalStart,tab}}} live={{
   data:ready,busy,onSave:save,onApprove:approve,beforeExport,onSourcesChanged:refreshSources,onDirtyChange:reportDirty,
   onRefresh:()=>{if(confirmSwitch())refreshSources()},onFiscalStartChange:changeFiscalStart,onCreateCorrection:createCorrectionDraft,
   canEditCenterOpenings:organizations.find(o=>o.id===organization)?.canEditCenterOpenings===true,
  }}/>}
 </div>;
}
