'use client';
import {useEffect,useRef,useState} from 'react';
import {OpeningWorkspace} from './OpeningBalancesPreview';
import {openingError,type OpeningWorkspaceData,type OpeningEntries} from '../../lib/financial-opening-workspace';
const endpoint='/api/financial-reporting/openings';
type Org={id:string;name:string;base_currency:string};
async function json(response:Response){const data=await response.json();if(!response.ok)throw Error(data.error??'OPENING_UNAVAILABLE');return data}
export default function LiveOpeningBalances({locale,preferredOrg=''}:{locale:string;preferredOrg?:string}){
 const en=locale==='en',t=(ar:string,english:string)=>en?english:ar;
 const[organizations,setOrganizations]=useState<Org[]>([]),[organization,setOrganization]=useState(''),[fiscalStart,setFiscalStart]=useState(new Date().getFullYear()+'-01-01'),[data,setData]=useState<OpeningWorkspaceData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const generation=useRef(0),current=useRef('');current.current=organization+fiscalStart;
 useEffect(()=>{const controller=new AbortController();fetch(endpoint+'?action=context',{cache:'no-store',signal:controller.signal}).then(json).then((orgs:Org[])=>{setOrganizations(orgs);setOrganization((preferredOrg?orgs.find((o:{id:string})=>o.id===preferredOrg):orgs[0])?.id??'')}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[preferredOrg]);
 useEffect(()=>{const controller=new AbortController(),key=++generation.current;setData(null);setError('');if(!organization)return()=>controller.abort();setBusy(true);
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
 return <div className="fs-root" lang={en?'en':'ar'} dir={en?'ltr':'rtl'}><div className="fs-filter-strip ob-live-scope"><label>{t('المؤسسة','Organization')}<select disabled={busy} value={organization} onChange={e=>setOrganization(e.target.value)}>{!organization&&<option value="">{t('اختر مؤسسة متاحة','Select an available organization')}</option>}{organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><label>{t('بداية السنة المالية','Fiscal year start')}<input disabled={busy} type="date" value={fiscalStart} onChange={e=>{if(e.target.value)setFiscalStart(e.target.value)}}/></label><button disabled={busy||!organization} onClick={refreshSources}>{t('تحديث المصادر','Refresh sources')}</button></div>
  {error&&<p className="ob-invalid" role="alert">{openingError(error,en)}</p>}{busy&&!data&&<p role="status">{t('جار تحميل الأرصدة والسندات…','Loading balances and vouchers…')}</p>}
  {!organizations.length&&!busy&&!error&&<p role="status">{t('لا توجد مؤسسات متاحة بصلاحية عرض القوائم.','No organizations are available with financial report permission.')}</p>}
  {ready&&!!ready.periodAssetOpenings?.length&&<section className="fs-card"><h2>{t('سندات افتتاح الأصول المسجلة خلال السنة','Asset opening vouchers recorded during the year')}</h2><p>{t('تظهر بتاريخ السند ولا تُضاف مرة ثانية إلى رصيد ما قبل بداية السنة.','Shown on their voucher dates and excluded from the preceding year-end balance.')}</p><table><thead><tr>{[t('التاريخ','Date'),t('الأصل','Asset'),t('القيمة','Amount')].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{ready.periodAssetOpenings.map(v=><tr key={v.id}><td>{v.date}</td><td><a href={`/${locale}/transactions?scope=ORGANIZATION&organization=${organization}&transaction_id=${v.id}`}>{v.name}</a></td><td>{v.amount} {v.currency}</td></tr>)}</tbody></table></section>}
  {ready?.workspace?.status==='APPROVED'&&<button disabled={busy||!ready.canSave} onClick={()=>command({action:'save',organization,fiscalStart,expectedVersion:0,sourceRevision:ready.source.revision,entries:ready.workspace!.entries,reason:''})}>{t('إنشاء مسودة تصحيحية','Create a correction draft')}</button>}{ready&&<OpeningWorkspace key={organization+fiscalStart+':'+(ready.workspace?.version??0)+':'+ready.source.revision} org={organization} en={en} live={{data:ready,busy,onSave:save,onApprove:approve,beforeExport}}/>}
 </div>;
}
