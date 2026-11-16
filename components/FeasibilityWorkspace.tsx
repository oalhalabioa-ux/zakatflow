'use client';
import {useEffect,useMemo,useRef,useState,type ChangeEvent,type ReactNode} from 'react';
import {useSearchParams} from 'next/navigation';
import {rememberedOrganization} from '@/lib/workspace-organization';
import {useWorkspaceScope} from '@/hooks/useWorkspaceScope';
import {currentWorkspaceScope} from '@/lib/topbar-navigation';
import {accountDraftsVisibleInScope} from '@/lib/feasibility/portfolio-scope';
import {createStudy,evaluateStudy,scenarioLabels,waterFactoryLegalItems,type ChecklistStatus,type FeasibilityStudy,type Sector,type StudyStatus,type StudyTab,type TaskStatus,type Scenario} from '@/lib/feasibility/engine';
import ProjectHandoffPanel from '@/components/feasibility/ProjectHandoffPanel';
import CollaborationPanel from '@/components/feasibility/CollaborationPanel';
import JoinInvitationPanel from '@/components/feasibility/JoinInvitationPanel';
import AdvancedModelPanel from '@/components/feasibility/AdvancedModelPanel';
import SectorAnalysisPanel from '@/components/feasibility/SectorAnalysisPanel';
import SupplierComparisonPanel from '@/components/feasibility/SupplierComparisonPanel';
import {sectorTemplates} from '@/lib/feasibility/sector-templates';
import {createIndustrialStarter,type IndustrialStarter} from '@/lib/feasibility/project-templates';
import {parseLocalStudyCache,parseStudyBackup,parseCloudStudyRows,parseInstitutionalCloudRows,partitionPersonalCloudRows,canPersistLocalStudyCache,FEASIBILITY_BACKUP_SCHEMA,type InstitutionalCloudDraft} from '@/lib/feasibility/local-drafts';

const tabs:Array<{id:StudyTab;ar:string;en:string}>= [
 {id:'overview',ar:'لوحة المشروع',en:'Overview'}, {id:'profile',ar:'بيانات المشروع',en:'Profile'},
 {id:'investment',ar:'تكاليف الاستثمار',en:'Investment'}, {id:'partners',ar:'الشراكة والملكية',en:'Partnership'},
 {id:'operations',ar:'الإنتاج والمبيعات',en:'Operations'}, {id:'scenarios',ar:'السيناريوهات',en:'Scenarios'},
 {id:'cashflow',ar:'التدفقات والعوائد',en:'Cash flow'}, {id:'advanced',ar:'النموذج المالي المتقدم',en:'Advanced model'}, {id:'sector',ar:'التحليل القطاعي',en:'Sector analysis'}, {id:'legal',ar:'القانون والتراخيص',en:'Legal'},
 {id:'tasks',ar:'المهام',en:'Tasks'}, {id:'risks',ar:'المخاطر',en:'Risks'},
 {id:'suppliers',ar:'عروض الموردين',en:'Supplier quotes'}, {id:'decisions',ar:'القرارات',en:'Decisions'},
 {id:'handoff',ar:'الاعتماد وتأسيس الشركة',en:'Approval & company setup'},
 {id:'sharing',ar:'المشاركون',en:'Collaboration'}
];
const sectors:Record<Sector,{ar:string;en:string}>={
 INDUSTRIAL:{ar:'صناعي',en:'Industrial'},COMMERCIAL:{ar:'تجاري',en:'Commercial'},
 REAL_ESTATE:{ar:'عقاري',en:'Real estate'},SERVICES:{ar:'خدمي',en:'Services'},
 AGRICULTURE:{ar:'زراعي',en:'Agricultural'},CUSTOM:{ar:'مخصص',en:'Custom'}
};
const projectStatus:Record<StudyStatus,{ar:string;en:string}>={
 IDEA:{ar:'فكرة',en:'Idea'},FEASIBILITY:{ar:'قيد الدراسة',en:'Feasibility'},
 APPROVED:{ar:'معتمد مبدئيًا',en:'Approved in principle'},
 ESTABLISHMENT:{ar:'قيد التأسيس',en:'Establishment'},OPERATING:{ar:'قيد التشغيل',en:'Operating'},
 CANCELLED:{ar:'ملغى',en:'Cancelled'}
};
const legalStatus:Record<ChecklistStatus,{ar:string;en:string}>={
 NOT_STARTED:{ar:'لم يبدأ',en:'Not started'},UNDER_REVIEW:{ar:'قيد الفحص',en:'Under review'},
 VERIFIED:{ar:'متحقق منه',en:'Verified'},BLOCKED:{ar:'مانع / مشكلة',en:'Blocked'}
};
const taskStatus:Record<TaskStatus,{ar:string;en:string}>={
 TODO:{ar:'قيد الانتظار',en:'To do'},IN_PROGRESS:{ar:'قيد التنفيذ',en:'In progress'},DONE:{ar:'منجز',en:'Done'}
};
const uid=()=>globalThis.crypto?.randomUUID?.()??String(Date.now())+'-'+Math.random().toString(36).slice(2);
const fmt=(n:number|null|undefined,digits=0)=>n==null||!Number.isFinite(n)?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(n);
const txt=(ar:boolean,a:string,b:string)=>ar?a:b;
function Button({children,onClick,secondary=false,disabled=false}:{children:ReactNode;onClick:()=>void;secondary?:boolean;disabled?:boolean}){
 return <button type="button" className={'fs-btn'+(secondary?' fs-btn--secondary':'')} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Field({label,value,onChange,min=0,step='any',hint}:{label:string;value:number;onChange:(v:number)=>void;min?:number;step?:string;hint?:string}){
 return <label className="fs-field"><span>{label}</span><input type="number" inputMode="decimal" min={min} step={step} value={value} onChange={e=>onChange(Number(e.currentTarget.value)||0)}/>{hint&&<small>{hint}</small>}</label>;
}
function Info({label,value,sub}:{label:string;value:string;sub?:string}){
 return <div className="fs-metric"><small>{label}</small><strong dir="ltr">{value}</strong>{sub&&<span>{sub}</span>}</div>;
}
function SelectField<T extends string>({label,value,items,onChange}:{label:string;value:T;items:Array<{value:T;label:string}>;onChange:(value:T)=>void}){
 return <label className="fs-field"><span>{label}</span><select value={value} onChange={e=>onChange(e.currentTarget.value as T)}>{items.map(x=><option value={x.value} key={x.value}>{x.label}</option>)}</select></label>;
}
export default function FeasibilityWorkspace({locale,userId,readOnly=false}:{locale:string;userId:string;readOnly?:boolean}){
 const searchParams=useSearchParams();
 const [scope]=useWorkspaceScope(currentWorkspaceScope('feasibility',searchParams.toString()));
 const personalScope=scope==='PERSONAL';
 const ar=locale==='ar', storageKey='yaqeen-feasibility-drafts-v1:'+userId;
 const [loaded,setLoaded]=useState(false);
 const [hydratedStorageKey,setHydratedStorageKey]=useState('');
 const currentUserRef=useRef(userId);
 currentUserRef.current=userId;
 // If local cache is malformed, preserve it verbatim: no automatic empty overwrite.
 const [storageSafe,setStorageSafe]=useState(true);
 const [studies,setStudies]=useState<FeasibilityStudy[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [tab,setTab]=useState<StudyTab>('overview');
 const [projectName,setProjectName]=useState('');
 const [newSector,setNewSector]=useState<Sector>('INDUSTRIAL');
 const [newStarter,setNewStarter]=useState<IndustrialStarter>('GENERAL');
 const [scenario,setScenario]=useState<Scenario>('BASE');
 const [notice,setNotice]=useState('');
 const cloudEnabled=process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA==='true';
 const sharingEnabled=cloudEnabled&&process.env.NEXT_PUBLIC_FEASIBILITY_SHARING_QA==='true';
 const [cloudBusy,setCloudBusy]=useState(false);
 const [cloudRevisions,setCloudRevisions]=useState<Record<string,number>>({});
 const [cloudSavedStudyVersions,setCloudSavedStudyVersions]=useState<Record<string,string>>({});
 const [cloudOwnerIds,setCloudOwnerIds]=useState<Record<string,string>>({});
 // Collaborator-readable cloud studies are never written to personal localStorage.
 const [sharedStudies,setSharedStudies]=useState<FeasibilityStudy[]>([]);
 const [sharedSelectedId,setSharedSelectedId]=useState('');
 const [sharedBusy,setSharedBusy]=useState(false);
 const [sharedError,setSharedError]=useState('');
 const [sharedRefresh,setSharedRefresh]=useState(0);
 useEffect(()=>{
  const onAccepted=()=>setSharedRefresh(count=>count+1);
  window.addEventListener('feasibility:invitation-accepted',onAccepted);
  return ()=>window.removeEventListener('feasibility:invitation-accepted',onAccepted);
 },[]);
 useEffect(()=>{
  setSharedStudies([]);setSharedSelectedId('');setSharedError('');
  if(!sharingEnabled||!personalScope)return;
  const controller=new AbortController();
  setSharedBusy(true);
  void (async()=>{
   try{
    const response=await fetch('/api/feasibility/projects',{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('SHARED_FETCH_FAILED');
    const rows=parseCloudStudyRows(await response.json());
    const partition=rows&&partitionPersonalCloudRows(rows,userId);
    if(!partition)throw Error('INVALID_SHARED_RESPONSE');
    if(controller.signal.aborted||currentUserRef.current!==userId)return;
    const shared=partition.shared.map(x=>x.study);
    setSharedStudies(shared);
    setSharedSelectedId(current=>shared.some(x=>x.id===current)?current:'');
   }catch{
    if(controller.signal.aborted||currentUserRef.current!==userId)return;
    setSharedError(txt(ar,'تعذر تحديث الدراسات المشتركة؛ لم تتغير مسوداتك الشخصية.','Could not refresh shared studies; your personal drafts are unchanged.'));
   }finally{
    if(!controller.signal.aborted&&currentUserRef.current===userId)setSharedBusy(false);
   }
  })();
  return ()=>controller.abort();
 },[sharingEnabled,personalScope,userId,sharedRefresh,ar]);
 // Organization state is strictly server-owned, never written to the legacy
 // per-user localStorage key. It resets on organization or account changes.
 const [organizationId,setOrganizationId]=useState('');
 const [organizationStudies,setOrganizationStudies]=useState<FeasibilityStudy[]>([]);
 const [organizationSelectedId,setOrganizationSelectedId]=useState('');
 const [organizationRecords,setOrganizationRecords]=useState<Record<string,InstitutionalCloudDraft>>({});
 const [organizationCanWrite,setOrganizationCanWrite]=useState(false);
 const [organizationLoaded,setOrganizationLoaded]=useState(false);
 const [organizationLoadedId,setOrganizationLoadedId]=useState('');
 const [organizationError,setOrganizationError]=useState('');
 const [organizationBusy,setOrganizationBusy]=useState(false);
 const [organizationReload,setOrganizationReload]=useState(0);
 const organizationRequestRef=useRef(0);
 useEffect(()=>{
  const read=()=>{
   const params=new URLSearchParams(window.location.search);
   setOrganizationId(params.get('organization')||rememberedOrganization()||'');
  };
  read();
  window.addEventListener('zf-organization-selection',read);
  window.addEventListener('popstate',read);
  return ()=>{
   window.removeEventListener('zf-organization-selection',read);
   window.removeEventListener('popstate',read);
  };
 },[searchParams.toString()]);
 useEffect(()=>{
  const requestId=++organizationRequestRef.current;
  setOrganizationStudies([]);setOrganizationSelectedId('');
  setOrganizationRecords({});setOrganizationCanWrite(false);
  setOrganizationBusy(false);setOrganizationError('');
  setOrganizationLoaded(false);setOrganizationLoadedId('');
  if(personalScope||!organizationId){setOrganizationLoaded(true);return}
  const controller=new AbortController();
  void (async()=>{
   try{
    const response=await fetch(
     '/api/feasibility/organization-projects?organization='+encodeURIComponent(organizationId),
     {cache:'no-store',signal:controller.signal}
    );
    if(!response.ok)throw Error(response.status===404?'ORG_NOT_AVAILABLE':'ORG_LOAD_FAILED');
    const result=await response.json() as {studies?:unknown;canWrite?:unknown};
    const rows=parseInstitutionalCloudRows(result.studies,organizationId);
    if(!rows||typeof result.canWrite!=='boolean')throw Error('INVALID_COMPANY_RESPONSE');
    if(controller.signal.aborted||organizationRequestRef.current!==requestId||currentUserRef.current!==userId)return;
    setOrganizationLoadedId(organizationId);
    setOrganizationStudies(rows.map(x=>x.study));
    setOrganizationSelectedId(rows[0]?.id||'');
    setOrganizationRecords(Object.fromEntries(rows.map(x=>[x.id,x])));
    setOrganizationCanWrite(result.canWrite&&!readOnly);
   }catch(e){
    if(controller.signal.aborted||organizationRequestRef.current!==requestId||currentUserRef.current!==userId)return;
    setOrganizationError(e instanceof Error&&e.message==='ORG_NOT_AVAILABLE'
     ?txt(ar,'المحفظة المؤسسية غير مفعّلة بعد أو لا تملك صلاحية الوصول إليها.','Institutional studies are disabled or not authorized yet.')
     :txt(ar,'تعذر تحميل دراسات المؤسسة؛ لم تتغير مسوداتك الشخصية.','Unable to load company studies; personal drafts are unchanged.'));
   }finally{
    if(!controller.signal.aborted&&organizationRequestRef.current===requestId&&currentUserRef.current===userId)
     setOrganizationLoaded(true);
   }
  })();
  return ()=>controller.abort();
 },[personalScope,organizationId,organizationReload,userId,readOnly,ar]);
 useEffect(()=>{
  // Account changes must never reuse the previous user's local or cloud data.
  setLoaded(false);setStorageSafe(true);
  setStudies([]);setSelectedId('');setSharedSelectedId('');setTab('overview');
  setCloudRevisions({});setCloudSavedStudyVersions({});setCloudOwnerIds({});
  try{
   const saved=JSON.parse(localStorage.getItem(storageKey)||'null') as unknown;
   if(saved!==null){
    const checked=parseLocalStudyCache(saved);
    if(!checked)throw Error('INVALID_CACHE');
    setStudies(checked.studies);setSelectedId(checked.selectedId);
   }
  }catch{
   setStorageSafe(false);
   setNotice(txt(ar,'المسودات المحلية غير صالحة؛ لن نكتب فوق الملف الموجود. يمكنك استعادة نسخة JSON سليمة أو مسودات QA V2.','Local study data are invalid and will not be overwritten. Restore a valid JSON backup or QA V2 copy.'));
  }
  setHydratedStorageKey(storageKey);
  setLoaded(true);
 },[storageKey,ar]);
 useEffect(()=>{
  if(!canPersistLocalStudyCache(loaded,storageSafe,hydratedStorageKey,storageKey))return;
  try{localStorage.setItem(storageKey,JSON.stringify({version:1,studies,selectedId}));}
  catch{setNotice(txt(ar,'تعذر حفظ المسودة محليًا. صدّر نسخة JSON.','Could not save locally. Export a JSON backup.'));}
 },[loaded,storageSafe,hydratedStorageKey,storageKey,studies,selectedId,ar]);
 // Account-scoped legacy drafts are never owned by the selected organization.
 const companyScopeReady=organizationLoaded&&organizationId.length>0&&organizationLoadedId===organizationId;
 const visibleStudies=personalScope?accountDraftsVisibleInScope(studies,scope):(companyScopeReady?organizationStudies:[]);
 const activeSelectedId=personalScope?(sharedSelectedId||selectedId):organizationSelectedId;
 const study=personalScope&&sharedSelectedId
  ?sharedStudies.find(s=>s.id===sharedSelectedId)??null
  :visibleStudies.find(s=>s.id===activeSelectedId)??null;
 const sharedStudy=Boolean(personalScope&&study&&(
  sharedSelectedId||(cloudOwnerIds[study.id]&&cloudOwnerIds[study.id]!==userId)
 ));
 const effectiveReadOnly=readOnly||sharedStudy||(!personalScope&&(!organizationCanWrite||!companyScopeReady));
 const model=useMemo(()=>study?evaluateStudy(study,scenario):null,[study,scenario]);
 const base=useMemo(()=>study?evaluateStudy(study):null,[study]);
 const money=(v:number|null|undefined,d=0)=>v==null||!Number.isFinite(v)?'—':fmt(v,d)+(study?.currency?' '+study.currency:'');
 // Handoff review follows the source study revision; editing any study assumption invalidates it.
 const update=(patch:Partial<FeasibilityStudy>)=>{
  if(effectiveReadOnly||!study)return;
  const change=(p:FeasibilityStudy)=>p.id===study.id?{
   ...p,...patch,
   updatedAt:Object.keys(patch).every(k=>k==='handoff')?p.updatedAt:new Date().toISOString()
  }:p;
  if(personalScope)setStudies(prev=>prev.map(change));
  else setOrganizationStudies(prev=>prev.map(change));
 };
 const setNum=(key:keyof FeasibilityStudy)=>(v:number)=>update({[key]:v} as Partial<FeasibilityStudy>);
 const download=()=>{
  if(!personalScope)return;
  const blob=new Blob([JSON.stringify({schema:FEASIBILITY_BACKUP_SCHEMA,exportedAt:new Date().toISOString(),studies:visibleStudies},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='yaqeen-feasibility-backup.json';anchor.click();URL.revokeObjectURL(url);
 };
 // Explicit cloud synchronization: local drafts are never silently overwritten.
 const loadCloud=async()=>{
  if(!personalScope){
   if(organizationBusy||!organizationId)return;
   const dirty=organizationStudies.some(x=>
    organizationRecords[x.id]?.study.updatedAt!==x.updatedAt);
   if(dirty&&!window.confirm(txt(ar,
    'يوجد تعديل مؤسسي غير محفوظ؛ هل تريد إعادة تحميل النسخ المحفوظة؟',
    'Unsaved company changes will be replaced by saved versions. Continue?')))return;
   setOrganizationReload(n=>n+1);
   return;
  }
  if(cloudBusy)return;
  const requestedUser=userId;
  if(studies.length&&!window.confirm(txt(ar,'سيتم استبدال المسودات المحلية بمسودات QA المحفوظة؛ صدّر نسخة احتياطية أولًا. متابعة؟','This replaces local drafts with saved QA copies. Export a backup first. Continue?')))return;
  setCloudBusy(true);
  try{
   const response=await fetch('/api/feasibility/projects',{cache:'no-store'});
   if(!response.ok)throw new Error('READ_FAILED');
   const rows=parseCloudStudyRows(await response.json());
   if(!rows)throw new Error('INVALID_RESPONSE');
   if(currentUserRef.current!==requestedUser)return;
   const partition=partitionPersonalCloudRows(rows,requestedUser);
   if(!partition)throw Error('INVALID_OWNER_CONTEXT');
   // Never merge a collaborator's editable JSON document into a PERSONAL cache.
   const own=partition.owned,documents=own.map(x=>x.study);
   setStudies(documents);setSelectedId(documents[0]?.id??'');setSharedSelectedId('');setStorageSafe(true);setTab('overview');
   setCloudRevisions(Object.fromEntries(own.map(x=>[x.id,x.revision])));
   setCloudSavedStudyVersions(Object.fromEntries(own.map(x=>[x.id,x.study.updatedAt])));
   setCloudOwnerIds(Object.fromEntries(own.map(x=>[x.id,x.owner_user_id])));
   setNotice(txt(ar,'تم استرجاع الدراسات المملوكة لك فقط؛ الدراسات المشتركة تظهر بقائمة مستقلة.','Only your own drafts were restored; shared studies appear in a separate list.'));
  }catch{setNotice(txt(ar,'تعذر استرجاع المسودات من QA. لم تُغيّر البيانات المحلية.','Could not restore QA drafts; local data were not changed.'))}
  finally{setCloudBusy(false)}
 };
 const saveCloud=async()=>{
  if(!personalScope){
   if(effectiveReadOnly||!companyScopeReady||organizationBusy||!study||!organizationId)return;
   const row=organizationRecords[study.id];
   if(!row){setNotice(txt(ar,'يجب إنشاء الدراسة المؤسسية على الخادم أولًا.','Create the study on the company server first.'));return}
   const userAtRequest=userId,orgAtRequest=organizationId,requestId=organizationRequestRef.current;
   const document=study;
   setOrganizationBusy(true);
   try{
    const response=await fetch('/api/feasibility/organization-projects?organization='+
     encodeURIComponent(orgAtRequest),{
     method:'PATCH',headers:{'content-type':'application/json'},
     body:JSON.stringify({study:document,revision:row.revision})
    });
    if(response.status===409)throw Error('CONFLICT');
    if(!response.ok)throw Error('COMPANY_SAVE_FAILED');
    const saved=await response.json() as {revision:number;updated_at?:string};
    if(!Number.isSafeInteger(saved.revision)||saved.revision<=row.revision)
     throw Error('INVALID_REVISION');
    if(currentUserRef.current!==userAtRequest||
      organizationRequestRef.current!==requestId)return;
    setOrganizationRecords(prev=>({...prev,[document.id]:{
     ...row,study:document,revision:saved.revision,
     updated_at:saved.updated_at||new Date().toISOString()
    }}));
    setNotice(txt(ar,'حُفظت الدراسة للمؤسسة المحددة في QA V2.','Study saved for the selected QA V2 organization.'));
   }catch(e){
    if(currentUserRef.current!==userAtRequest||
      organizationRequestRef.current!==requestId)return;
    setNotice(e instanceof Error&&e.message==='CONFLICT'?
     txt(ar,'توجد نسخة مؤسسية أحدث؛ لا تُستبدل قبل مراجعتها.','A newer company revision exists; it was not overwritten.'):
     txt(ar,'فشل الحفظ المؤسسي. احتفظ بالتغييرات حتى تعالج المشكلة.','Company save failed; keep your changes while resolving it.'));
   }finally{
    if(organizationRequestRef.current===requestId)setOrganizationBusy(false);
   }
   return;
  }
  if(effectiveReadOnly||cloudBusy||!study)return;
  const requestedUser=userId;
  setCloudBusy(true);
  try{
   const revision=cloudRevisions[study.id];
   const response=await fetch('/api/feasibility/projects',{
    method:revision===undefined?'POST':'PATCH',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({study,...(revision===undefined?{}:{revision})})
   });
   if(response.status===409)throw new Error('CONFLICT');
   if(!response.ok)throw new Error('SAVE_FAILED');
   const result=await response.json() as {revision:number};
   if(currentUserRef.current!==requestedUser)return;
   setCloudRevisions(p=>({...p,[study.id]:result.revision}));
   setCloudSavedStudyVersions(p=>({...p,[study.id]:study.updatedAt}));
   setCloudOwnerIds(p=>({...p,[study.id]:userId}));
   setNotice(txt(ar,'حُفظت مسودة المشروع في QA V2، وهي ليست اعتمادًا نهائيًا.','Project draft saved in QA V2; this is not formal approval.'));
  }catch(e){setNotice(e instanceof Error&&e.message==='CONFLICT'?
   txt(ar,'توجد نسخة أحدث أو مسودة مطابقة على QA؛ احفظ نسخة JSON ثم استرجع المسودات قبل إعادة الحفظ.','A newer or duplicate QA draft exists. Export JSON, restore cloud copies and review before retrying.'):
   txt(ar,'تعذر الحفظ في QA. احتفظ بنسخة JSON من بياناتك.','QA save failed. Keep a JSON backup.'))}
  finally{setCloudBusy(false)}
 };
 const importBackup=async(e:ChangeEvent<HTMLInputElement>)=>{
  if(!personalScope||readOnly)return;
  const requestedUser=userId;
  const file=e.currentTarget.files?.[0];if(!file)return;
  try{
   if(file.size>2_000_000)throw new Error('large');
   const imported=parseStudyBackup(JSON.parse(await file.text()));
   if(!imported)throw new Error('format');
   if(currentUserRef.current!==requestedUser)return;
   // Imports replace local drafts. No financial ledger, database or Financial Core mutation.
   if(!window.confirm(txt(ar,'سيتم استبدال المسودات المحلية الحالية بالملف المستورد. متابعة؟','This replaces current local drafts. Continue?')))return;
   // Imported backups have no trusted server revision: do not reuse optimistic locks from a previous draft.
   setCloudRevisions({});
   setCloudSavedStudyVersions({});
   setCloudOwnerIds({});
   setStudies(imported);setSelectedId(imported[0]?.id||'');setSharedSelectedId('');setStorageSafe(true);setTab('overview');
   setNotice(txt(ar,'تم استيراد المسودات محليًا.','Local drafts imported.'));
  }catch{setNotice(txt(ar,'ملف النسخة الاحتياطية غير صالح.','Invalid backup file.'));}
  e.currentTarget.value='';
 };
 const create=async()=>{
  if(readOnly)return;
  const title=projectName.trim();if(!title)return;
  const next=newSector==='INDUSTRIAL'
   ?createIndustrialStarter(uid(),title,newStarter)
   :createStudy(uid(),title,newSector);
  if(personalScope){
   setStudies(p=>[next,...p]);setSelectedId(next.id);setSharedSelectedId('');
   setProjectName('');setTab('profile');
   return;
  }
  if(!organizationCanWrite||!companyScopeReady||organizationBusy||!organizationId)return;
  const requestedOrg=organizationId,requestedUser=userId,requestId=organizationRequestRef.current;
  setOrganizationBusy(true);
  try{
   const response=await fetch('/api/feasibility/organization-projects?organization='+
    encodeURIComponent(requestedOrg),{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({study:next})
   });
   if(!response.ok)throw Error(response.status===409?'CONFLICT':'CREATE_FAILED');
   const result=await response.json() as {revision:number;updated_at?:string;id?:string};
   if(result.id!==next.id||!Number.isSafeInteger(result.revision)||result.revision<1)
    throw Error('INVALID_RESPONSE');
   if(currentUserRef.current!==requestedUser||
     organizationRequestRef.current!==requestId)return;
   setOrganizationStudies(p=>[next,...p]);
   setOrganizationSelectedId(next.id);
   setOrganizationRecords(p=>({...p,[next.id]:{
    id:next.id,organization_id:requestedOrg,owner_user_id:null,
    created_by_user_id:requestedUser,title:next.title,study:next,
    revision:result.revision,updated_at:result.updated_at||new Date().toISOString()
   }}));
   setProjectName('');setTab('profile');
   setNotice(txt(ar,'تم إنشاء دراسة مؤسسية ضمن الشركة المحددة.','Institutional study created within the selected organization.'));
  }catch(e){
   if(currentUserRef.current!==requestedUser||
     organizationRequestRef.current!==requestId)return;
   setNotice(txt(ar,'لم يتم إنشاء الدراسة المؤسسية؛ تحقق من الترخيص والصلاحيات.','Study creation failed; verify company permissions and licence.'));
  }finally{
   if(organizationRequestRef.current===requestId)setOrganizationBusy(false);
  }
 };
 const remove=()=>{
  if(!personalScope||effectiveReadOnly||!study||!window.confirm(txt(ar,'حذف مسودة هذا المشروع من هذا المتصفح فقط؟','Delete this local draft from this browser only?')))return;
  setStudies(p=>p.filter(s=>s.id!==study.id));setSelectedId(studies.find(x=>x.id!==study.id)?.id||'');
 };
 const choices=<>
  <SelectField label={txt(ar,'النوع','Sector')} value={study?.sector??'INDUSTRIAL'} items={Object.entries(sectors).map(([value,name])=>({value:value as Sector,label:ar?name.ar:name.en}))} onChange={sector=>update({sector})}/>
  <SelectField label={txt(ar,'مرحلة المشروع','Stage')} value={study?.status??'IDEA'} items={Object.entries(projectStatus).map(([value,name])=>({value:value as StudyStatus,label:ar?name.ar:name.en}))} onChange={status=>update({status})}/>
 </>;
 const createCompanyDeniedReason=!personalScope
  ?(!organizationId
    ?txt(ar,'اختر المؤسسة من البانر الرئيسي لبدء دراسة جديدة.','Select an organization from the main banner to create a study.')
    :organizationError||(!companyScopeReady
      ?txt(ar,'جارٍ التحقق من عضوية المؤسسة وإتاحة المحفظة على QA.','Checking company membership and QA availability.')
      :!organizationCanWrite||readOnly
       ?txt(ar,'إنشاء الدراسات يتطلب عضوية مالك أو مدير وترخيصًا يتيح التعديل.','Creating a study requires an active owner/admin membership and editing entitlement.')
       :''))
  :'';
 const emptyTitle=personalScope?txt(ar,'ابدأ بأول مشروع','Start your first project'):txt(ar,'لا توجد دراسات لدى المؤسسة المحددة','No studies for the selected organization');
 const emptyDescription=personalScope?txt(ar,'ادخل اسم المشروع ونوعه. تبدأ الأرقام بصفر لتجنب عرض نتائج افتراضية على أنها دراسة حقيقية.','Enter a project name and sector. All figures start at zero to avoid implying a real feasibility result.'):organizationError||(!organizationId?txt(ar,'اختر المؤسسة من البانر الرئيسي أولًا.','Select the organization from the main topbar first.'):txt(ar,'يمكن للمستخدمين المخوّلين إنشاء الدراسات، ولا تظهر هنا المسودات الشخصية إلا بعد مشاركة معتمدة.','Authorized members may create company studies. Personal drafts do not appear here without an approved share.'));
 const legalDone=study?.legal.filter(x=>x.status==='VERIFIED').length??0;
 const taskDone=study?.tasks.filter(x=>x.status==='DONE').length??0;
 if(personalScope&&hydratedStorageKey!==storageKey){
  return <main className="container fs-page" dir={ar?'rtl':'ltr'}><p role="status">{txt(ar,'جاري تحميل مسودات الحساب الحالي…','Loading this account\'s drafts…')}</p></main>;
 }
 return <main className="container fs-page" dir={ar?'rtl':'ltr'}>
  <header className="fs-head"><div><span className="fs-eyebrow">YAQEEN BUSINESS / FEASIBILITY</span><h1>{txt(ar,'دراسات الجدوى وتأسيس المشاريع','Feasibility & project development')}</h1><p>{txt(ar,'دراسات مستقلة عن الدفاتر المحاسبية والمحرك المالي القديم؛ الربط لاحقًا مع Financial Core V2 فقط.','Pre-investment studies stay separate from accounting ledgers. Future integration will target Financial Core V2 only.')}</p></div>
   {personalScope&&<div className="fs-actions"><Button secondary onClick={download} disabled={!personalScope||!visibleStudies.length}>{txt(ar,'تصدير نسخة JSON','Export JSON')}</Button><label className="fs-btn fs-btn--secondary fs-upload">{txt(ar,'استيراد نسخة','Import backup')}<input type="file" accept=".json,application/json" onChange={importBackup} disabled={readOnly||!personalScope}/></label><Button secondary onClick={()=>window.print()} disabled={!study}>{txt(ar,'طباعة الدراسة','Print study')}</Button>{cloudEnabled&&personalScope&&<><Button secondary onClick={()=>void loadCloud()} disabled={cloudBusy}>{txt(ar,'استرجاع من QA V2','Restore from QA V2')}</Button><Button secondary onClick={()=>void saveCloud()} disabled={effectiveReadOnly||!study||cloudBusy}>{txt(ar,'حفظ في QA V2','Save to QA V2')}</Button></>}</div>}
   {!personalScope&&organizationId&&organizationLoaded&&!organizationError&&<div className="fs-actions">
    <Button secondary onClick={()=>void loadCloud()} disabled={organizationBusy}>{txt(ar,'إعادة تحميل دراسات المؤسسة','Refresh company studies')}</Button>
    <Button secondary onClick={()=>void saveCloud()} disabled={!study||effectiveReadOnly||organizationBusy}>{txt(ar,'حفظ دراسة المؤسسة','Save company study')}</Button>
    <Button secondary onClick={()=>window.print()} disabled={!study}>{txt(ar,'طباعة الدراسة','Print study')}</Button>
   </div>}
  </header>
  <p className="fs-warning" role="status">{!personalScope?organizationError||txt(ar,'محفظة المؤسسة مستقلة عن مسوداتك الشخصية. البيانات المؤسسية تحفظ على QA V2 بعد التحقق من عضوية المؤسسة وصلاحياتها.','The company portfolio is separate from your personal drafts. Organization records are saved on QA V2 using server-verified membership and permissions.'):sharedStudy?txt(ar,'مشروع مشترك للقراءة والمراجعة فقط؛ لا يمكنك تغيير بيانات مالكه.','Shared project: read and review only, without changes to its owner\u0027s data.'):readOnly?txt(ar,'الاشتراك في وضع القراءة والتصدير فقط؛ انتهت صلاحية التحرير أو تم تعليقها.','This subscription permits reading and exporting only; editing access expired or was suspended.'):cloudEnabled?txt(ar,'نسخة QA تجريبية: الحفظ المركزي يدوي في قاعدة V2 ومتاح لمالك المسودة فقط. لا توجد مشاركة أو اعتماد رسمي أو قيود محاسبية.','QA-only: cloud saving is manual in the V2 database and visible only to the draft owner. No sharing, formal approval or accounting entries.'):txt(ar,'نسخة أولية معزولة: تحفظ المسودات في متصفحك فقط، ولا تتزامن بين الأجهزة أو المستخدمين بعد. ليست دراسة معتمدة أو قيودًا محاسبية.','Isolated first iteration: drafts are browser-local, not synced between devices or users, and are not approved studies or accounting entries.')}</p>
  {notice&&<p className="fs-notice" role="status">{notice} <button type="button" onClick={()=>setNotice('')}>×</button></p>}
  {sharingEnabled&&personalScope&&<JoinInvitationPanel locale={locale}/>} 
  <section className="fs-create card"><div><h2>{txt(ar,'محفظة المشاريع','Project portfolio')}</h2><p>{txt(ar,'أنشئ دراسة جديدة أو افتح مشروعًا محفوظًا.','Create a study or open a saved draft.')}</p></div><div className="fs-create-controls"><input value={projectName} onChange={e=>setProjectName(e.currentTarget.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void create();}}} placeholder={txt(ar,'اسم المشروع الجديد','New project name')} aria-label={txt(ar,'اسم المشروع الجديد','New project name')}/><select value={newSector} onChange={e=>{setNewSector(e.currentTarget.value as Sector);setNewStarter('GENERAL')}} aria-label={txt(ar,'نوع المشروع','Project type')}>{Object.entries(sectors).map(([value,name])=><option key={value} value={value}>{ar?name.ar:name.en}</option>)}</select>{newSector==='INDUSTRIAL'&&<select value={newStarter}
  onChange={e=>setNewStarter(e.currentTarget.value as IndustrialStarter)}
  aria-label={txt(ar,'قالب المشروع','Project starter template')}>
  <option value="GENERAL">{txt(ar,'دراسة صناعية عامة','General industrial study')}</option>
  <option value="BOTTLED_WATER">{txt(ar,'مصنع مياه معبأة','Bottled-water factory')}</option>
  <option value="DAIRY_CHEESE">{txt(ar,'مصنع ألبان وأجبان','Dairy & cheese factory')}</option>
 </select>}<Button onClick={()=>void create()} disabled={readOnly||(!personalScope&&(!companyScopeReady||!organizationCanWrite||!!organizationError||organizationBusy||!organizationId))||!projectName.trim()}>{txt(ar,'إضافة مشروع +','Add project +')}</Button></div>{createCompanyDeniedReason&&<p className="fs-hint" role="status">{createCompanyDeniedReason}</p>}</section>
  <div className="fs-portfolio">{visibleStudies.map(p=><button key={p.id} type="button" className={'fs-project-pill'+(p.id===activeSelectedId?' fs-project-pill--active':'')} aria-pressed={p.id===activeSelectedId} onClick={()=>{if(personalScope){setSharedSelectedId('');setSelectedId(p.id)}else setOrganizationSelectedId(p.id);setTab('overview')}}><strong>{p.title}</strong><span>{ar?projectStatus[p.status].ar:projectStatus[p.status].en}</span></button>)}</div>

  {personalScope&&sharingEnabled&&<section className="card fs-panel" aria-label={txt(ar,'الدراسات المشتركة معي','Shared studies')}>
   <div className="fs-subhead">
    <h3>{txt(ar,'الدراسات المشتركة معي','Shared with me')}</h3>
    <Button secondary onClick={()=>setSharedRefresh(v=>v+1)} disabled={sharedBusy}>{txt(ar,'تحديث القائمة','Refresh shared studies')}</Button>
   </div>
   <p className="fs-hint">{txt(ar,'الدراسات التي قبلت دعوتها تظهر هنا للقراءة والمراجعة فقط؛ لا تضاف إلى مسوداتك الشخصية أو صادراتها.','Accepted invitations appear here as read-only shared studies and are never copied into your personal drafts or exports.')}</p>
   {sharedBusy&&<p role="status">{txt(ar,'جارٍ تحديث الدراسات المشتركة…','Loading shared studies…')}</p>}
   {sharedError&&<p role="alert">{sharedError}</p>}
   {!sharedBusy&&!sharedError&&!sharedStudies.length&&<p>{txt(ar,'لا توجد دراسات مشتركة معك حاليًا.','No studies have been shared with you yet.')}</p>}
   <div className="fs-portfolio">{sharedStudies.map(p=><button key={p.id} type="button"
    className={'fs-project-pill'+(p.id===sharedSelectedId?' fs-project-pill--active':'')}
    aria-pressed={p.id===sharedSelectedId}
    onClick={()=>{setSharedSelectedId(p.id);setTab('overview')}}>
     <strong>{p.title}</strong><span>{txt(ar,'مشتركة — للقراءة','Shared — read only')}</span>
    </button>)}</div>
  </section>}

  {!(personalScope?loaded:organizationLoaded)?<p>{txt(ar,'جاري تحميل الدراسات…','Loading studies…')}</p>:!study?<section className="card fs-empty"><h2>{emptyTitle}</h2><p>{emptyDescription}</p></section>:<>
   <div className="fs-subhead"><div><h2>{study.title}</h2><small>{study.country||txt(ar,'الدولة غير محددة','Country not selected')}{study.region?' · '+study.region:''} · {study.currency||txt(ar,'العملة غير محددة','Currency not selected')} · {ar?projectStatus[study.status].ar:projectStatus[study.status].en}</small></div>{personalScope&&<Button secondary onClick={remove} disabled={effectiveReadOnly}>{txt(ar,'حذف المسودة','Delete draft')}</Button>}</div>
   <nav className="fs-tabs" aria-label={txt(ar,'أقسام دراسة المشروع','Study sections')}>{tabs.filter(t=>t.id!=='sector'||study.sector==='INDUSTRIAL'||study.sector==='REAL_ESTATE').map(t=><button type="button" key={t.id} onClick={()=>setTab(t.id)} className={tab===t.id?'active':''} aria-current={tab===t.id?'page':undefined}>{ar?t.ar:t.en}</button>)}</nav>
   <fieldset className="fs-study-scope" disabled={effectiveReadOnly} aria-label={txt(ar,'محتوى دراسة المشروع','Study content')}>
   {tab==='overview'&&model&&<section className="fs-block">
    <div className="fs-kpis"><Info label={txt(ar,'إجمالي الاستثمار الاقتصادي','Economic investment')} value={money(model.totalInvestment)}/><Info label={txt(ar,'نسبة الممول في حقوق الملكية','Investor equity share')} value={model.investorShare===null?'—':fmt(model.investorShare,2)+'%'}/><Info label={txt(ar,'صافي القيمة الحالية','Net present value')} value={model.ready?money(model.npv):'—'}/><Info label={txt(ar,'العائد الداخلي المتوقع','Indicative IRR')} value={model.ready&&model.irr!==null?fmt(model.irr,2)+'%':'—'}/></div>
    <div className="fs-columns"><div className="card fs-panel"><h3>{txt(ar,'جاهزية الدراسة','Study readiness')}</h3><div className="fs-row"><span>{txt(ar,'التحقق القانوني','Legal checks')}</span><strong>{legalDone} / {study.legal.length}</strong></div><progress value={legalDone} max={study.legal.length||1}/><div className="fs-row"><span>{txt(ar,'المهام المنجزة','Tasks complete')}</span><strong>{taskDone} / {study.tasks.length}</strong></div><progress value={taskDone} max={study.tasks.length||1}/></div>
    <div className="card fs-panel"><h3>{txt(ar,'إشارات القرار','Decision diagnostics')}</h3><p>{model.cashFundingGap>0?txt(ar,'فجوة التمويل النقدي: ','Cash funding gap: ')+money(model.cashFundingGap):txt(ar,'لا توجد فجوة تمويل نقدية وفق المدخلات.','No positive cash funding gap under current inputs.')}</p><p>{!study.landTransferred&&study.landValue>0?txt(ar,'الأرض لم تنقل للشركة؛ لا تدخل قيمتها السوقية ضمن حقوق ملكيتها.','Land is not transferred; its full market value does not count as company equity.'):txt(ar,'راجع قيمة الحصة العينية مع جهة مستقلة.','Verify any in-kind contribution independently.')}</p><p>{!model.ready?txt(ar,'استكمل الاستثمار والسعر والحجم قبل اعتماد مؤشرات الجدوى.','Enter investment, price and sales volume before relying on projections.'):txt(ar,'النتائج استرشادية، وليست اعتمادًا للقرار الاستثماري.','Results are indicative, not investment approval.')}</p></div></div>
   </section>}
   {tab==='profile'&&<section className="card fs-panel"><h3>{txt(ar,'البيانات الأساسية','Project profile')}</h3><div className="fs-form-grid">
    <label className="fs-field"><span>{txt(ar,'اسم المشروع','Project title')}</span><input value={study.title} onChange={e=>update({title:e.currentTarget.value})}/></label>
    {choices}
    <label className="fs-field"><span>{txt(ar,'الدولة','Country')}</span><input value={study.country} onChange={e=>update({country:e.currentTarget.value})}/></label>
    <label className="fs-field"><span>{txt(ar,'المدينة أو المنطقة','City / region')}</span><input value={study.region} onChange={e=>update({region:e.currentTarget.value})}/></label>
    <label className="fs-field"><span>{txt(ar,'عملة الدراسة الواحدة','Study currency')}</span><select value={study.currency} onChange={e=>update({currency:e.currentTarget.value})}><option value="">{txt(ar,'اختر العملة','Select currency')}</option><option>USD</option><option>SYP</option><option>SAR</option><option>EUR</option></select></label>
   </div><p className="fs-hint">{txt(ar,'تغيير رمز العملة لا يقوم بتحويل القيم؛ يجب تحديث الأرقام يدويًا قبل اعتماد النتائج.','Changing the currency code does not convert amounts; update all figures before using the results.')}</p></section>}
   {tab==='investment'&&model&&<section className="card fs-panel"><h3>{txt(ar,'الموازنة الاستثمارية','Investment budget')}</h3><p className="fs-hint">{txt(ar,'أدخل بنود الإنشاء والتجهيز الفعلية. الأرض تظهر في الشراكة ولا تُضاف هنا منعًا لتكرارها.','Enter actual construction and commissioning costs. Land is valued under Partnership to prevent double counting.')}</p>
    <div className="fs-table-wrap"><table className="fs-table"><thead><tr><th>{txt(ar,'البند','Item')}</th><th>{txt(ar,'الفئة','Category')}</th><th>{txt(ar,'القيمة','Amount')}</th><th></th></tr></thead><tbody>{study.capex.map(item=><tr key={item.id}><td><input value={item.label} onChange={e=>update({capex:study.capex.map(x=>x.id===item.id?{...x,label:e.currentTarget.value}:x)})}/></td><td><select value={item.category} onChange={e=>update({capex:study.capex.map(x=>x.id===item.id?{...x,category:e.currentTarget.value as typeof x.category}:x)})}>{['BUILDINGS','EQUIPMENT','UTILITIES','LICENCES','OTHER'].map(v=><option key={v} value={v}>{v}</option>)}</select></td><td><input type="number" min="0" value={item.amount} onChange={e=>update({capex:study.capex.map(x=>x.id===item.id?{...x,amount:Number(e.currentTarget.value)||0}:x)})}/></td><td><button type="button" aria-label={txt(ar,'حذف','Remove')} onClick={()=>update({capex:study.capex.filter(x=>x.id!==item.id)})}>×</button></td></tr>)}</tbody><tfoot><tr><th colSpan={2}>{txt(ar,'الإجمالي','Total')}</th><th>{money(model.capex)}</th><th/></tr></tfoot></table></div>
    <Button secondary onClick={()=>update({capex:[...study.capex,{id:uid(),label:txt(ar,'بند جديد','New item'),category:'OTHER',amount:0}]})}>{txt(ar,'+ إضافة بند','+ Add item')}</Button><div className="fs-form-grid"><Field label={txt(ar,'رأس المال العامل الأولي','Opening working capital')} value={study.workingCapital} onChange={setNum('workingCapital')}/><Field label={txt(ar,'الصيانة الرأسمالية السنوية التقريبية','Indicative yearly maintenance')} value={study.annualMaintenance} onChange={setNum('annualMaintenance')}/></div>
   </section>}
   {tab==='partners'&&model&&<section className="card fs-panel"><h3>{txt(ar,'المساهمات وحصص الملكية','Contributions and equity')}</h3><label className="fs-check"><input type="checkbox" checked={study.landTransferred} onChange={e=>update({landTransferred:e.currentTarget.checked})}/>{txt(ar,'تُنقل الأرض إلى ملكية الشركة كحصة عينية مثبتة','Land is transferred into company ownership as an independently valued in-kind contribution')}</label>
    <div className="fs-form-grid"><Field label={txt(ar,'القيمة المقدرة للأرض','Estimated land value')} value={study.landValue} onChange={setNum('landValue')}/><Field label={txt(ar,'مساهمة الممول كرأس مال','Investor equity cash')} value={study.investorEquity} onChange={setNum('investorEquity')}/><Field label={txt(ar,'مساهمة صاحب الأرض النقدية','Land partner cash equity')} value={study.partnerCashEquity} onChange={setNum('partnerCashEquity')}/><Field label={txt(ar,'قرض الممول إلى الشركة','Investor shareholder loan')} value={study.investorLoan} onChange={setNum('investorLoan')}/><Field label={txt(ar,'تمويل ديون أخرى','Other debt')} value={study.otherDebt} onChange={setNum('otherDebt')}/></div>
    <div className="fs-kpis"><Info label={txt(ar,'حصة الممول','Investor ownership')} value={model.investorShare===null?'—':fmt(model.investorShare,2)+'%'}/><Info label={txt(ar,'حصة صاحب الأرض','Land partner ownership')} value={model.partnerShare===null?'—':fmt(model.partnerShare,2)+'%'}/><Info label={txt(ar,'فجوة التمويل النقدي','Cash funding gap')} value={money(model.cashFundingGap)}/></div>
    <p className="fs-hint">{txt(ar,'النسب اقتصادية تقديرية لحقوق الملكية فقط؛ قروض المساهمين لا تمنح ملكية تلقائيًا، ولا تتغير الحصص القانونية دون إجراءات معتمدة.','Economic indicative equity only: loans do not automatically generate shares; legal ownership changes require formal approval.')}</p>
   </section>}
   {tab==='operations'&&<section className="card fs-panel"><h3>{txt(ar,'افتراضات التشغيل والمبيعات','Operating assumptions')}</h3><div className="fs-form-grid">
    <Field label={ar?sectorTemplates[study.sector].volumeAr:sectorTemplates[study.sector].volumeEn} value={study.monthlyUnits} onChange={setNum('monthlyUnits')}/>
    <Field label={txt(ar,'سعر بيع الوحدة الصافي','Net selling price / unit')} value={study.unitPrice} onChange={setNum('unitPrice')}/>
    <Field label={txt(ar,'التكلفة المتغيرة للوحدة','Variable cost / unit')} value={study.variableCost} onChange={setNum('variableCost')}/>
    <Field label={txt(ar,'التكاليف الثابتة الشهرية','Monthly fixed costs')} value={study.monthlyFixedCost} onChange={setNum('monthlyFixedCost')}/>
    <Field label={txt(ar,'نمو حجم المبيعات سنويًا %','Volume growth % / year')} value={study.volumeGrowthPct} onChange={setNum('volumeGrowthPct')}/>
    <Field label={txt(ar,'نمو أسعار البيع سنويًا %','Price growth % / year')} value={study.priceGrowthPct} onChange={setNum('priceGrowthPct')}/>
    <Field label={txt(ar,'نمو التكاليف الثابتة سنويًا %','Fixed cost growth % / year')} value={study.fixedCostGrowthPct} onChange={setNum('fixedCostGrowthPct')}/>
    <Field label={txt(ar,'معدل الخصم %','Discount rate %')} value={study.discountRatePct} onChange={setNum('discountRatePct')}/>
    <Field label={txt(ar,'ضريبة تقديرية استرشادية %','Indicative tax assumption %')} value={study.indicativeTaxRatePct} onChange={setNum('indicativeTaxRatePct')}/>
    <Field label={txt(ar,'مدة الدراسة بالسنوات','Forecast horizon in years')} value={study.years} onChange={n=>update({years:Math.min(20,Math.max(1,Math.trunc(n)))})} min={1} step="1"/>
   </div></section>}
   {tab==='scenarios'&&<section className="card fs-panel"><h3>{txt(ar,'تحليل السيناريوهات','Scenario comparison')}</h3><p className="fs-hint">{txt(ar,'المتحفظ: حجم 70% وسعر 95% وتكلفة متغيرة 110%؛ المتفائل: حجم 120% وسعر 103% وتكلفة 97%.','Conservative: 70% volume, 95% price, 110% unit cost. Optimistic: 120% volume, 103% price, 97% cost.')}</p>
    <div className="fs-table-wrap"><table className="fs-table"><thead><tr><th>{txt(ar,'المؤشر','Metric')}</th>{(['CONSERVATIVE','BASE','OPTIMISTIC'] as Scenario[]).map(x=><th key={x}>{ar?scenarioLabels[x].ar:scenarioLabels[x].en}</th>)}</tr></thead><tbody>{(['initial','npv','irr','year1'] as const).map(metric=><tr key={metric}><th>{metric==='initial'?txt(ar,'الاستثمار','Investment'):metric==='npv'?'NPV':metric==='irr'?'IRR':txt(ar,'EBITDA السنة الأولى','Year 1 EBITDA')}</th>{(['CONSERVATIVE','BASE','OPTIMISTIC'] as Scenario[]).map(x=>{const calc=evaluateStudy(study,x);return <td key={x} dir="ltr">{metric==='initial'?money(calc.totalInvestment):!calc.ready?'—':metric==='npv'?money(calc.npv):metric==='irr'?(calc.irr===null?'—':fmt(calc.irr,2)+'%'):money(calc.annual[0]?.ebitda)}</td>})}</tr>)}</tbody></table></div>
    <SelectField label={txt(ar,'السيناريو النشط في اللوحة','Active dashboard scenario')} value={scenario} items={Object.entries(scenarioLabels).map(([value,label])=>({value:value as Scenario,label:ar?label.ar:label.en}))} onChange={setScenario}/>
   </section>}
   {tab==='cashflow'&&model&&<section className="card fs-panel"><h3>{txt(ar,'التدفقات النقدية التشغيلية المبسطة','Simplified annual project cash flows')}</h3><div className="fs-kpis"><Info label="NPV" value={model.ready?money(model.npv):'—'}/><Info label="IRR" value={model.ready&&model.irr!==null?fmt(model.irr,2)+'%':'—'}/><Info label={txt(ar,'مدة الاسترداد','Payback period')} value={model.ready&&model.paybackYears!==null?fmt(model.paybackYears,2)+' '+txt(ar,'سنة','years'):'—'}/><Info label={txt(ar,'التعادل الشهري بالوحدات','Monthly break-even units')} value={model.ready?fmt(model.breakevenMonthlyUnits):'—'}/></div>
    <div className="fs-table-wrap"><table className="fs-table"><thead><tr><th>{txt(ar,'السنة','Year')}</th><th>{txt(ar,'الإيرادات','Revenue')}</th><th>{txt(ar,'المتغيرة','Variable costs')}</th><th>{txt(ar,'الثابتة','Fixed costs')}</th><th>EBITDA</th><th>{txt(ar,'ضريبة تقديرية','Indicative tax')}</th><th>{txt(ar,'التدفق الحر','Project FCF')}</th></tr></thead><tbody><tr><td>0</td><td colSpan={5}>{txt(ar,'الاستثمار الأولي بما فيه الأرض العينية ورأس المال العامل','Initial investment including in-kind land and working capital')}</td><td>{money(model.flows[0])}</td></tr>{model.annual.map(a=><tr key={a.year}><td>{a.year}</td><td>{money(a.revenue)}</td><td>{money(a.variable)}</td><td>{money(a.fixed)}</td><td>{money(a.ebitda)}</td><td>{money(a.taxEstimate)}</td><td>{money(a.freeCashFlow)}</td></tr>)}</tbody></table></div>
    <ul className="fs-notes">{model.notes.map(x=><li key={x}>{x}</li>)}</ul>
   </section>}
   {tab==='advanced'&&<AdvancedModelPanel study={study} locale={locale} scenario={scenario} onChange={advanced=>update({advanced})}/>}
   {tab==='sector'&&(study.sector==='INDUSTRIAL'||study.sector==='REAL_ESTATE')&&<SectorAnalysisPanel study={study} locale={locale} onChange={sectorSchedule=>update({sectorSchedule})}/>}
    {tab==='legal'&&<section className="card fs-panel"><h3>{txt(ar,'الفحص القانوني والتراخيص','Legal and licensing checklist')}</h3><p className="fs-hint">{txt(ar,'هذه قائمة فحص عامة وليست تصديقًا قانونيًا. يجب التحقق من القوانين والمتطلبات السارية في دولة المشروع وموقعه بحسب النشاط.','General checklist only, not legal certification. Local counsel must verify the current requirements for the selected country, location and sector.')}</p>
    {study.legal.map(x=><div className="fs-item" key={x.id}><strong>{x.title}</strong><SelectField label={txt(ar,'الحالة','Status')} value={x.status} items={Object.entries(legalStatus).map(([value,name])=>({value:value as ChecklistStatus,label:ar?name.ar:name.en}))} onChange={status=>update({legal:study.legal.map(z=>z.id===x.id?{...z,status}:z)})}/><input value={x.notes} placeholder={txt(ar,'المستند / ملاحظات التحقق','Evidence / notes')} onChange={e=>update({legal:study.legal.map(z=>z.id===x.id?{...z,notes:e.currentTarget.value}:z)})}/></div>)}
    <Button secondary onClick={()=>update({legal:[...study.legal,{id:uid(),title:txt(ar,'متطلب جديد','New requirement'),status:'NOT_STARTED',notes:''}]})}>{txt(ar,'إضافة متطلب +','Add requirement +')}</Button>{study.sector==='INDUSTRIAL'&&<Button secondary onClick={()=>update({legal:[...study.legal,...waterFactoryLegalItems.filter(title=>!study.legal.some(l=>l.title===title)).map(title=>({id:uid(),title,status:'NOT_STARTED' as const,notes:''}))]})}>{txt(ar,'إضافة متطلبات مصنع مياه','Add water factory requirements')}</Button>}
   </section>}
   {tab==='tasks'&&<section className="card fs-panel"><h3>{txt(ar,'الجدول التنفيذي والمهام','Tasks and milestones')}</h3>{study.tasks.map(x=><div className="fs-item" key={x.id}><input aria-label={txt(ar,'عنوان المهمة','Task title')} value={x.title} onChange={e=>update({tasks:study.tasks.map(z=>z.id===x.id?{...z,title:e.currentTarget.value}:z)})}/><input aria-label={txt(ar,'المسؤول','Owner')} placeholder={txt(ar,'المسؤول','Owner')} value={x.owner} onChange={e=>update({tasks:study.tasks.map(z=>z.id===x.id?{...z,owner:e.currentTarget.value}:z)})}/><input aria-label={txt(ar,'الموعد','Due date')} type="date" value={x.due} onChange={e=>update({tasks:study.tasks.map(z=>z.id===x.id?{...z,due:e.currentTarget.value}:z)})}/><SelectField label={txt(ar,'الحالة','Status')} value={x.status} items={Object.entries(taskStatus).map(([value,name])=>({value:value as TaskStatus,label:ar?name.ar:name.en}))} onChange={status=>update({tasks:study.tasks.map(z=>z.id===x.id?{...z,status}:z)})}/><button type="button" aria-label={txt(ar,'حذف المهمة','Delete task')} onClick={()=>update({tasks:study.tasks.filter(z=>z.id!==x.id)})}>×</button></div>)}<Button secondary onClick={()=>update({tasks:[...study.tasks,{id:uid(),title:txt(ar,'مهمة جديدة','New task'),owner:'',due:'',status:'TODO',priority:'NORMAL'}]})}>{txt(ar,'إضافة مهمة +','Add task +')}</Button></section>}
   {tab==='risks'&&<section className="card fs-panel"><h3>{txt(ar,'سجل المخاطر','Risk register')}</h3>{study.risks.map(x=><div className="fs-item" key={x.id}><input value={x.title} aria-label={txt(ar,'الخطر','Risk')} onChange={e=>update({risks:study.risks.map(z=>z.id===x.id?{...z,title:e.currentTarget.value}:z)})}/><label>{txt(ar,'الاحتمال 1-5','Likelihood 1-5')}<input type="number" min="1" max="5" value={x.likelihood} onChange={e=>update({risks:study.risks.map(z=>z.id===x.id?{...z,likelihood:Math.max(1,Math.min(5,Number(e.currentTarget.value)||1))}:z)})}/></label><label>{txt(ar,'الأثر 1-5','Impact 1-5')}<input type="number" min="1" max="5" value={x.impact} onChange={e=>update({risks:study.risks.map(z=>z.id===x.id?{...z,impact:Math.max(1,Math.min(5,Number(e.currentTarget.value)||1))}:z)})}/></label><strong>{x.impact*x.likelihood}/25</strong><input placeholder={txt(ar,'إجراء المعالجة','Mitigation')} value={x.response} onChange={e=>update({risks:study.risks.map(z=>z.id===x.id?{...z,response:e.currentTarget.value}:z)})}/></div>)}<Button secondary onClick={()=>update({risks:[...study.risks,{id:uid(),title:txt(ar,'خطر جديد','New risk'),likelihood:3,impact:3,response:''}]})}>{txt(ar,'إضافة خطر +','Add risk +')}</Button></section>}
   {tab==='suppliers'&&<section className="card fs-panel"><h3>{txt(ar,'عروض الموردين والمقاولين','Supplier and contractor offers')}</h3>{study.suppliers.map(x=><div className="fs-item" key={x.id}><input aria-label={txt(ar,'المورد','Vendor')} placeholder={txt(ar,'اسم المورد','Vendor')} value={x.vendor} onChange={e=>update({suppliers:study.suppliers.map(z=>z.id===x.id?{...z,vendor:e.currentTarget.value}:z)})}/><input aria-label={txt(ar,'البند','Item')} placeholder={txt(ar,'المعدة أو الخدمة','Equipment / service')} value={x.item} onChange={e=>update({suppliers:study.suppliers.map(z=>z.id===x.id?{...z,item:e.currentTarget.value}:z)})}/><input aria-label={txt(ar,'القيمة','Quote')} type="number" min="0" value={x.offer} onChange={e=>update({suppliers:study.suppliers.map(z=>z.id===x.id?{...z,offer:Number(e.currentTarget.value)||0}:z)})}/><input aria-label={txt(ar,'ملاحظات','Notes')} placeholder={txt(ar,'الشروط والمدة','Terms / timeline')} value={x.notes} onChange={e=>update({suppliers:study.suppliers.map(z=>z.id===x.id?{...z,notes:e.currentTarget.value}:z)})}/><button type="button" aria-label={txt(ar,'حذف العرض','Remove quote')} onClick={()=>update({suppliers:study.suppliers.filter(z=>z.id!==x.id)})}>×</button></div>)}<Button secondary onClick={()=>update({suppliers:[...study.suppliers,{id:uid(),vendor:'',item:'',offer:0,notes:''}]})}>{txt(ar,'إضافة عرض +','Add offer +')}</Button><SupplierComparisonPanel suppliers={study.suppliers} currency={study.currency} locale={locale}/></section>}
   {tab==='sharing'&&<CollaborationPanel locale={locale} projectId={study.id} enabled={sharingEnabled&&personalScope} canWrite={!effectiveReadOnly} isOwner={cloudOwnerIds[study.id]===userId}/>}
   {tab==='handoff'&&<ProjectHandoffPanel study={study} locale={locale} onChange={handoff=>update({handoff})} cloudRevision={cloudRevisions[study.id]} cloudCurrent={cloudSavedStudyVersions[study.id]===study.updatedAt} cloudEnabled={cloudEnabled} canWrite={!effectiveReadOnly}/>}
   {tab==='decisions'&&<section className="card fs-panel"><h3>{txt(ar,'سجل القرارات ومحاضر الاجتماعات','Decision and meeting log')}</h3>{study.decisions.map(x=><div className="fs-item" key={x.id}><input aria-label={txt(ar,'القرار','Decision')} value={x.title} onChange={e=>update({decisions:study.decisions.map(z=>z.id===x.id?{...z,title:e.currentTarget.value}:z)})}/><input aria-label={txt(ar,'التاريخ','Date')} type="date" value={x.date} onChange={e=>update({decisions:study.decisions.map(z=>z.id===x.id?{...z,date:e.currentTarget.value}:z)})}/><textarea aria-label={txt(ar,'التفاصيل','Details')} value={x.notes} onChange={e=>update({decisions:study.decisions.map(z=>z.id===x.id?{...z,notes:e.currentTarget.value}:z)})}/></div>)}<Button secondary onClick={()=>update({decisions:[...study.decisions,{id:uid(),title:txt(ar,'قرار جديد','New decision'),date:new Date().toISOString().slice(0,10),notes:''}]})}>{txt(ar,'إضافة قرار +','Add decision +')}</Button></section>}
   </fieldset>
  </>}
 </main>;
}
