'use client';
import FiscalPeriodControl from './FiscalPeriodControl';
import {useEffect,useRef,useState} from 'react';
import {OpeningWorkspace} from './OpeningBalancesPreview';
import {fiscalError,type OpeningWorkspaceData,type OpeningEntries} from '../../lib/financial-opening-workspace';
const endpoint='/api/financial-reporting/openings';
type Org={id:string;name:string;base_currency:string;currentFiscalStart?:string|null};
async function json(response:Response){const data=await response.json();if(!response.ok)throw Error(data.error??'OPENING_UNAVAILABLE');return data}
export default function LiveOpeningBalances({locale,preferredOrg='',preferredFiscalStart=''}:{locale:string;preferredOrg?:string;preferredFiscalStart?:string}){
 const en=locale==='en',t=(ar:string,english:string)=>en?english:ar;
 const[organizations,setOrganizations]=useState<Org[]>([]),[organization,setOrganization]=useState(''),[fiscalStart,setFiscalStart]=useState(''),[data,setData]=useState<OpeningWorkspaceData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const generation=useRef(0),current=useRef(''),selectedOrganization=useRef('');current.current=organization+fiscalStart;selectedOrganization.current=organization;
 useEffect(()=>{const controller=new AbortController();fetch(endpoint+'?action=context',{cache:'no-store',signal:controller.signal}).then(json).then((orgs:Org[])=>{if(controller.signal.aborted)return;setOrganizations(orgs);const desired=preferredOrg;const initial=desired?orgs.find((o:{id:string})=>o.id===desired):orgs[0];setOrganization(initial?.id??'');setFiscalStart(/^\d{4}-\d{2}-\d{2}$/.test(preferredFiscalStart)?preferredFiscalStart:initial?.currentFiscalStart??'')}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[preferredOrg,preferredFiscalStart]);
 useEffect(()=>{const controller=new AbortController(),key=++generation.current;setData(null);setError('');if(!organization||!fiscalStart)return()=>controller.abort();setBusy(true);
  fetch(endpoint+'?'+new URLSearchParams({organization,fiscalStart}),{cache:'no-store',signal:controller.signal}).then(json).then(value=>{if(generation.current===key)setData(value)}).catch(e=>{if(!controller.signal.aborted&&generation.current===key)setError(e.message)}).finally(()=>{if(!controller.signal.aborted&&generation.current===key)setBusy(false)});
  return()=>controller.abort();
 },[organization,fiscalStart,reload]);
 function refreshSources(){
  generation.current++;
  setData(null);
  setError('');
  setBusy(true);
  setReload(v=>v+1);
 }
 async function command(body:unknown){const key=generation.current;setBusy(true);setError('');try{await json(await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));if(generation.current===key)setReload(v=>v+1)}catch(e){if(generation.current===key){setError(e instanceof Error?e.message:'OPENING_UNAVAILABLE');if(e instanceof Error&&/DENIED|UNAUTHORIZED/.test(e.message))setData(null)}}finally{if(generation.current===key)setBusy(false)}}
 async function save(entries:OpeningEntries,reason:string){if(!data)return;await command({action:'save',organization,fiscalStart,expectedVersion:data.workspace?.status==='DRAFT'?data.workspace.version:0,sourceRevision:data.source.revision,entries,reason})}
 async function approve(){if(!data?.workspace)return;await command({action:'approve',id:data.workspace.id,expectedVersion:data.workspace.version})}
 async function beforeExport(){if(!data)throw Error('OPENING_UNAVAILABLE');const key=current.current,requestGeneration=generation.current;let fresh:OpeningWorkspaceData;try{fresh=await json(await fetch(endpoint+'?'+new URLSearchParams({organization,fiscalStart}),{cache:'no-store'}))}catch(e){if(current.current===key){setError(e instanceof Error?e.message:'OPENING_UNAVAILABLE');setData(null)}throw e}if(generation.current!==requestGeneration||current.current!==key||fresh.source.revision!==data.source.revision||fresh.workspace?.version!==data.workspace?.version)throw Error('OPENING_SOURCE_CHANGED')}
 const ready=data?.organizationId===organization&&data.fiscalStart===fiscalStart?data:null;
 return <div className="fs-root" lang={en?'en':'ar'} dir={en?'ltr':'rtl'}>{!/DENIED|UNAUTHORIZED/.test(error)&&<FiscalPeriodControl key={organization+':'+reload} organization={organization} en={en}/>}<div className="fs-filter-strip ob-live-scope"><label>{t('المؤسسة','Organization')}<select disabled={busy} value={organization} onChange={e=>{setOrganization(e.target.value);setFiscalStart(organizations.find(o=>o.id===e.target.value)?.currentFiscalStart??'')}}>{!organization&&<option value="">{t('اختر مؤسسة متاحة','Select an available organization')}</option>}{organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><label>{t('بداية السنة المالية','Fiscal year start')}<input disabled={busy} type="date" value={fiscalStart} onChange={e=>{if(e.target.value)setFiscalStart(e.target.value)}}/></label><button disabled={busy||!organization||!fiscalStart} onClick={refreshSources}>{t('تحديث المصادر','Refresh sources')}</button></div>
  {error&&<p className="ob-invalid" role="alert">{fiscalError(error,en)}</p>}{busy&&!data&&<p role="status">{t('جار تحميل الأرصدة والسندات…','Loading balances and vouchers…')}</p>}
  {!organizations.length&&!busy&&!error&&<p role="status">{t('لا توجد مؤسسات متاحة بصلاحية عرض القوائم.','No organizations are available with financial report permission.')}</p>}
  {ready?.workspace?.status==='APPROVED'&&<button disabled={busy||!ready.canSave} onClick={()=>command({action:'save',organization,fiscalStart,expectedVersion:0,sourceRevision:ready.source.revision,entries:ready.workspace!.entries,reason:''})}>{t('إنشاء مسودة تصحيحية','Create a correction draft')}</button>}{ready&&<OpeningWorkspace key={organization+fiscalStart+':'+(ready.workspace?.version??0)+':'+ready.source.revision} org={organization} en={en} live={{data:ready,busy,onSave:save,onApprove:approve,beforeExport,onSourcesChanged:refreshSources}}/>}
 </div>;
}
