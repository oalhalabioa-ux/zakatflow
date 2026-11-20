'use client';
import {useEffect,useMemo,useRef,useState,type ChangeEvent,type ReactNode} from 'react';
import {useSearchParams} from 'next/navigation';
import Link from 'next/link';
import OrganizationStudyShares from '@/components/feasibility/OrganizationStudyShares';
import {rememberedOrganization,type WorkspaceOrganization} from '@/lib/workspace-organization';
import WorkspaceOrganizationPicker from '@/components/WorkspaceOrganizationPicker';
import TopbarOrganizationControls from '@/components/TopbarOrganizationControls';
import {useWorkspaceScope} from '@/hooks/useWorkspaceScope';
import {currentWorkspaceScope,type WorkspaceScope} from '@/lib/topbar-navigation';
import {accountDraftsVisibleInScope} from '@/lib/feasibility/portfolio-scope';
import {createStudy,evaluateStudy,type FeasibilityStudy,type Sector,type StudyStatus,type StudyTab,type Scenario} from '@/lib/feasibility/engine';
import ProjectHandoffPanel from '@/components/feasibility/ProjectHandoffPanel';
import CollaborationPanel from '@/components/feasibility/CollaborationPanel';
import JoinInvitationPanel from '@/components/feasibility/JoinInvitationPanel';
import AdvancedModelPanel from '@/components/feasibility/AdvancedModelPanel';
import SectorAnalysisPanel from '@/components/feasibility/SectorAnalysisPanel';
import RawLandPanel from '@/components/feasibility/RawLandPanel';
import WaterModelPanel from '@/components/feasibility/WaterModelPanel';
import CopyToOrganizationDialog from '@/components/feasibility/CopyToOrganizationDialog';
import FeasibilityReport from '@/components/feasibility/FeasibilityReport';
import MonthlyLiquidityPanel from '@/components/feasibility/MonthlyLiquidityPanel';
import StudyProfilePanel from '@/components/feasibility/StudyProfilePanel';
import GeneralInvestmentPanel from '@/components/feasibility/GeneralInvestmentPanel';
import FeasibilitySidebar from '@/components/feasibility/FeasibilitySidebar';
import StudyRegisters from '@/components/feasibility/StudyRegisters';
import EvidenceDocuments from '@/components/feasibility/EvidenceDocuments';
import { RoyalIcon, studyTabIcons } from '@/components/feasibility/RoyalIcon';
import RoyalOverview from '@/components/feasibility/RoyalOverview';
import RoyalScenarios from '@/components/feasibility/RoyalScenarios';
import {handoffReadiness} from '@/lib/feasibility/handoff';
import { RoyalBars, RoyalCashTrend, RoyalOwnership } from '@/components/feasibility/RoyalCharts';
import {sectorTemplates} from '@/lib/feasibility/sector-templates';
import {createIndustrialStarter,createRawLandStarter,type IndustrialStarter} from '@/lib/feasibility/project-templates';
import {importWaterBackup} from '@/lib/feasibility/water-backup';
import {importRawLandBackup} from '@/lib/feasibility/raw-land-backup';
import {appendImportedStudies,parseLocalStudyCache,parseStudyBackup,parseCloudStudyRows,parseInstitutionalCloudRows,partitionPersonalCloudRows,mergePersonalCloudDrafts,canPersistLocalStudyCache,FEASIBILITY_BACKUP_SCHEMA,type InstitutionalCloudDraft} from '@/lib/feasibility/local-drafts';

const tabs:Array<{id:StudyTab;ar:string;en:string}>= [
 {id:'overview',ar:'لوحة المشروع',en:'Overview'}, {id:'profile',ar:'بيانات المشروع',en:'Profile'},
 {id:'investment',ar:'تكاليف الاستثمار',en:'Investment'}, {id:'partners',ar:'الشراكة والملكية',en:'Partnership'},
 {id:'operations',ar:'الإنتاج والمبيعات',en:'Operations'}, {id:'scenarios',ar:'السيناريوهات',en:'Scenarios'},
 {id:'cashflow',ar:'التدفقات والعوائد',en:'Cash flow'}, {id:'advanced',ar:'النموذج المالي المتقدم',en:'Advanced model'}, {id:'sector',ar:'التحليل القطاعي',en:'Sector analysis'}, {id:'legal',ar:'القانون والتراخيص',en:'Legal'},
 {id:'tasks',ar:'المهام',en:'Tasks'}, {id:'risks',ar:'المخاطر',en:'Risks'},
 {id:'suppliers',ar:'عروض الموردين',en:'Supplier quotes'}, {id:'decisions',ar:'القرارات',en:'Decisions'},
 {id:'handoff',ar:'الاعتماد وتأسيس الشركة',en:'Approval & company setup'},
 {id:'report',ar:'التقرير والتصدير',en:'Report and export'},
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
type WorkspaceProps={
 locale:string;
 userId:string;
 readOnly?:boolean;
 organizationEnabled?:boolean;
 organizationSharing?:boolean;
 evidenceEnabled?:boolean;
 organizations?:WorkspaceOrganization[];
 personalFallback?:ReactNode;
};

export default function FeasibilityWorkspace({personalFallback,...props}:WorkspaceProps){
 const searchParams=useSearchParams().toString();
 const [scope]=useWorkspaceScope(currentWorkspaceScope('feasibility',searchParams));
 if(scope==='PERSONAL'&&personalFallback)return personalFallback;
 return <FeasibilityWorkspaceContent {...props} scope={scope} searchParams={searchParams}/>;
}

function FeasibilityWorkspaceContent({
 locale,userId,readOnly=false,organizationEnabled=false,organizationSharing=false,evidenceEnabled=false,
 organizations=[],scope,searchParams,
}:Omit<WorkspaceProps,'personalFallback'>&{scope:WorkspaceScope;searchParams:string}){
 const personalScope=scope==='PERSONAL';
 const personalScopeRef=useRef(personalScope);
 personalScopeRef.current=personalScope;
 const ar=locale==='ar', storageKey='yaqeen-feasibility-drafts-v1:'+userId;
 const [loaded,setLoaded]=useState(false);
 const [hydratedStorageKey,setHydratedStorageKey]=useState('');
 const currentUserRef=useRef(userId);
 currentUserRef.current=userId;
 // If local cache is malformed, preserve it verbatim: no automatic empty overwrite.
 const [storageSafe,setStorageSafe]=useState(true);
 const [studies,setStudies]=useState<FeasibilityStudy[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [selectedTab,setTab]=useState<StudyTab>('overview');
 const [projectName,setProjectName]=useState('');
 const [newSector,setNewSector]=useState<Sector>('INDUSTRIAL');
 const [newStarter,setNewStarter]=useState<IndustrialStarter|'RAW_LAND'>('GENERAL');
 const [scenario,setScenario]=useState<Scenario>('BASE');
 const [notice,setNotice]=useState<{message:string;scopeId:string;userId:string}>();
 const setPersonalNotice=(message:string)=>setNotice({message,scopeId:'personal',userId});
 const [saveIssue,setSaveIssue]=useState<{kind:'conflict'|'save-error';message:string;studyId:string;scopeId:string;userId:string}>();

 const [copySelection,setCopySelection]=useState<{studyId:string;organizationId:string;userId:string}|null>(null);
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
 const createDialog=useRef<HTMLDialogElement>(null);
 const [createError,setCreateError]=useState('');
 const navigationRef=useRef<HTMLElement>(null);
 const sectionHeadingRef=useRef<HTMLDivElement>(null);
 const [detail,setDetail]=useState<'water'|'valuation'|'scenario'|'evidence'|'permissions'>();
 const [organizationCanShare,setOrganizationCanShare]=useState(false);
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
 },[searchParams]);
 useEffect(()=>{
  const requestId=++organizationRequestRef.current;
  setOrganizationStudies([]);setOrganizationSelectedId('');
  setOrganizationRecords({});setOrganizationCanWrite(false);setOrganizationCanShare(false);
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
    const result=await response.json() as {studies?:unknown;canWrite?:unknown;canShare?:unknown};
    const rows=parseInstitutionalCloudRows(result.studies,organizationId);
    if(!rows||typeof result.canWrite!=='boolean')throw Error('INVALID_COMPANY_RESPONSE');
    if(controller.signal.aborted||organizationRequestRef.current!==requestId||currentUserRef.current!==userId)return;
    setOrganizationLoadedId(organizationId);
    setOrganizationStudies(rows.map(x=>x.study));
    setOrganizationSelectedId(rows[0]?.id||'');
    setOrganizationRecords(Object.fromEntries(rows.map(x=>[x.id,x])));
    setOrganizationCanWrite(result.canWrite);
    setOrganizationCanShare(result.canShare===true);
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
 },[personalScope,organizationId,organizationReload,userId,ar]);
 useEffect(()=>{
  // Account changes must never reuse the previous user's local or cloud data.
  setLoaded(false);setStorageSafe(true);
  setStudies([]);setSelectedId('');setSharedSelectedId('');setTab('overview');
  setCloudRevisions({});setCloudSavedStudyVersions({});setCloudOwnerIds({});setCloudBusy(false);setSaveIssue(undefined);
  try{
   const saved=JSON.parse(localStorage.getItem(storageKey)||'null') as unknown;
   if(saved!==null){
    const checked=parseLocalStudyCache(saved);
    if(!checked)throw Error('INVALID_CACHE');
    setStudies(checked.studies);setSelectedId(checked.selectedId);
   }
  }catch{
   setStorageSafe(false);
   setPersonalNotice(txt(ar,'المسودات المحلية غير صالحة؛ لن نكتب فوق الملف الموجود. يمكنك استرجاع المسودات السحابية من ملف متصفح آخر.','Local study data are invalid and will not be overwritten. Use another browser profile to restore your cloud drafts.'));
  }
  setHydratedStorageKey(storageKey);
  setLoaded(true);
 },[storageKey,ar]);
 useEffect(()=>{
  if(!canPersistLocalStudyCache(loaded,storageSafe,hydratedStorageKey,storageKey))return;
  try{localStorage.setItem(storageKey,JSON.stringify({version:1,studies,selectedId}));}
  catch{setPersonalNotice(txt(ar,'تعذر حفظ المسودة محليًا. صدّر نسخة JSON.','Could not save locally. Export a JSON backup.'));}
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
 const effectiveReadOnly=sharedStudy||(personalScope?readOnly:!organizationCanWrite||!companyScopeReady);
 const saveScopeId=personalScope?'personal':organizationId;
 const visibleNotice=notice?.scopeId===saveScopeId&&notice.userId===userId?notice.message:undefined;
 const setCompanyNotice=(message:string)=>setNotice({message,scopeId:organizationId,userId});
 const visibleSaveIssue=saveIssue?.scopeId===saveScopeId&&saveIssue.studyId===study?.id&&saveIssue.userId===userId
  ?saveIssue:undefined;
 const copyRevision=study&&cloudOwnerIds[study.id]===userId&&cloudSavedStudyVersions[study.id]===study.updatedAt
  ?cloudRevisions[study.id]:undefined;
 const canOpenCopy=organizationEnabled&&cloudEnabled&&personalScope&&!effectiveReadOnly&&Boolean(study);
 useEffect(()=>{setCopySelection(null)},[study?.id,organizationId,userId,personalScope]);
 const openCopy=()=>{
  if(!study)return;
  if(!organizationId){
   setPersonalNotice(txt(ar,'اختر المؤسسة المستقبلة من البنر في النطاق المؤسسي، ثم عُد إلى الدراسة الشخصية للنسخ.','Select the receiving organization in the main banner in organization scope, then return to the personal study to copy it.'));
   return;
  }
  if(copyRevision===undefined){
   setPersonalNotice(txt(ar,'احفظ الإصدار الحالي من الدراسة شخصيًا في السحابة لتأكيد الملكية قبل النسخ.','Save this version to your personal cloud portfolio to verify ownership before copying.'));
   return;
  }
  setCopySelection({studyId:study.id,organizationId,userId});
 };
 const model=useMemo(()=>study?evaluateStudy(study,scenario):null,[study,scenario]);
 const studyReadiness=useMemo(()=>{
  if(!study)return '';
  const checks=handoffReadiness(study).checks;
  return new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:0})
   .format(checks.filter(check=>check.passed).length/checks.length);
 },[study,locale]);
 const base=useMemo(()=>study?evaluateStudy(study):null,[study]);
 const water=study?.water;
 const rawLand=study?.rawLand;
 const studyTabs=study?tabs.filter(({id})=>
  (id!=='sharing'||personalScope||organizationSharing&&organizationCanShare)&&
  (id!=='sector'||water||study.sector==='INDUSTRIAL'||study.sector==='REAL_ESTATE')
 ):[];
 const tab=studyTabs.some(({id})=>id===selectedTab)?selectedTab:'overview';
 const selectSection=(id:StudyTab)=>{
  setTab(id);
  setDetail(undefined);
 };

 const waterTab=tab==='overview'||tab==='investment'||tab==='partners'||tab==='operations'||tab==='scenarios'||tab==='cashflow'||tab==='advanced'||tab==='sector'?tab:null;
 const openReport=()=>selectSection('report');
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
  if(cloudBusy||!loaded||hydratedStorageKey!==storageKey)return;
  const requestedUser=userId;
  setCloudBusy(true);
  try{
   const response=await fetch('/api/feasibility/projects',{cache:'no-store'});
   if(!response.ok)throw Error('READ_FAILED');
   const rows=parseCloudStudyRows(await response.json());
   if(!rows)throw Error('INVALID_RESPONSE');
   if(currentUserRef.current!==requestedUser||!personalScopeRef.current)return;
   // Read after the request to preserve any changes made while it was in flight.
   const stored=localStorage.getItem(storageKey);
   const current=stored===null?{studies,selectedId}:parseLocalStudyCache(JSON.parse(stored));
   const merged=current&&mergePersonalCloudDrafts(current.studies,rows,requestedUser,current.selectedId);
   if(!merged)throw Error('INVALID_CACHE_OR_LIMIT');
   if(merged.restoredCount){
    localStorage.setItem(storageKey,JSON.stringify({
     version:1,studies:merged.studies,selectedId:merged.selectedId
    }));
   }
   setStudies(merged.studies);setSelectedId(merged.selectedId);setSharedSelectedId('');
   setCloudRevisions(Object.fromEntries(merged.synchronized.map(x=>[x.id,x.revision])));
   setCloudSavedStudyVersions(Object.fromEntries(merged.synchronized.map(x=>[x.id,x.study.updatedAt])));
   setCloudOwnerIds(Object.fromEntries(merged.synchronized.map(x=>[x.id,x.owner_user_id])));
   setPersonalNotice(merged.conflicts
    ?txt(ar,`أُضيفت ${merged.restoredCount} من المسودات السحابية. احتُفظ بالنسخ المحلية عند اختلافها (${merged.conflicts}).`,
     `Added ${merged.restoredCount} cloud drafts. Kept the local versions of ${merged.conflicts} differing drafts.`)
    :txt(ar,`أُضيفت ${merged.restoredCount} من المسودات السحابية. احتُفظ بجميع المسودات المحلية.`,
     `Added ${merged.restoredCount} cloud drafts. All local drafts were kept.`));
  }catch{
   if(currentUserRef.current===requestedUser&&personalScopeRef.current)
    setPersonalNotice(txt(ar,'تعذر استرجاع المسودات من السحابة. تحقّق من الاتصال وسلامة المسودات المحلية وحدّ المحفظة.','Could not restore cloud drafts. Check the connection, local drafts and portfolio limit.'));
  }finally{if(currentUserRef.current===requestedUser)setCloudBusy(false)}
 };
 const saveCloud=async()=>{
  // Both profile save entry points validate uncommitted numeric text before saving.
  const profileForm=document.querySelector<HTMLFormElement>('form.fs-royal-profile');
  if(profileForm&&!profileForm.reportValidity())return;
  if(!personalScope){
   if(effectiveReadOnly||!companyScopeReady||organizationBusy||!study||!organizationId)return;
   const row=organizationRecords[study.id];
   if(!row){setCompanyNotice(txt(ar,'يجب إنشاء الدراسة المؤسسية على الخادم أولًا.','Create the study on the company server first.'));return}
   const userAtRequest=userId,orgAtRequest=organizationId,requestId=organizationRequestRef.current;
   const document=study;
   setSaveIssue(undefined);
   setNotice(undefined);
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
    setCompanyNotice(txt(ar,'حُفظت الدراسة في سحابة المؤسسة المحددة.','Study saved to the selected organization’s cloud portfolio.'));
   }catch(e){
    if(currentUserRef.current!==userAtRequest||
      organizationRequestRef.current!==requestId)return;
    const conflict=e instanceof Error&&e.message==='CONFLICT';
    setSaveIssue({kind:conflict?'conflict':'save-error',studyId:document.id,scopeId:orgAtRequest,userId:userAtRequest,
     message:conflict?txt(ar,'توجد نسخة مؤسسية أحدث. راجع التغييرات قبل إعادة تحميل النسخة المحفوظة.','A newer company revision exists. Review your changes before reloading the saved revision.'):
      txt(ar,'تعذر الحفظ المؤسسي. راجع الاتصال والصلاحيات ثم أعد المحاولة.','Company save failed. Check your connection and permissions, then try again.')});
   }finally{
    if(organizationRequestRef.current===requestId)setOrganizationBusy(false);
   }
   return;
  }
  if(effectiveReadOnly||cloudBusy||!study)return;
  const requestedUser=userId;
  setSaveIssue(undefined);
  setNotice(undefined);
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
   setPersonalNotice(txt(ar,'حُفظت مسودة المشروع في السحابة، وهي ليست اعتمادًا نهائيًا.','Project draft saved to the cloud; this is not formal approval.'));
  }catch(e){
   if(currentUserRef.current!==requestedUser)return;
   const conflict=e instanceof Error&&e.message==='CONFLICT';
   setSaveIssue({kind:conflict?'conflict':'save-error',studyId:study.id,scopeId:'personal',userId:requestedUser,
    message:conflict?txt(ar,'تعذر حفظ هذه النسخة بسبب تعارض مع نسخة QA. صدّر المسودة المحلية بصيغة JSON قبل مراجعة النسخة السحابية.','A version conflict prevented saving. Export the local draft as JSON before reviewing the cloud version.'):
     txt(ar,'تعذر الحفظ السحابي. احتفظ بنسخة JSON من بياناتك.','Cloud save failed. Keep a JSON backup.')});
  }
  finally{if(currentUserRef.current===requestedUser)setCloudBusy(false)}
 };
 const importBackup=async(e:ChangeEvent<HTMLInputElement>)=>{
  if(!personalScope||readOnly||!storageSafe||cloudBusy)return;
  const input=e.currentTarget;
  const file=input.files?.[0];if(!file)return;
  try{
   if(file.size>2_000_000)throw Error('large');
   const raw:unknown=JSON.parse(await file.text());
   const previewId=uid();
   const land=importRawLandBackup(raw,previewId);
   const legacyStudy=land??importWaterBackup(raw,previewId);
   const imported=legacyStudy?[legacyStudy]:parseStudyBackup(raw);
   if(!imported?.length)throw Error('format');
   if(currentUserRef.current!==userId||!personalScopeRef.current)return;
   if(!window.confirm(txt(ar,'ستُضاف نسخة مستقلة إلى محفظتك الشخصية. متابعة؟','Add independent copies to your personal portfolio?')))return;
   // Use the current browser cache so an import cannot replace a study saved while reading the file.
   const stored=localStorage.getItem(storageKey);
   const current=stored===null?{studies}:parseLocalStudyCache(JSON.parse(stored));
   const next=current&&appendImportedStudies(current.studies,imported,uid);
   if(!next)throw Error('invalid_cache_or_limit');
   localStorage.setItem(storageKey,JSON.stringify({version:1,...next}));
   setStudies(next.studies);setSelectedId(next.selectedId);setSharedSelectedId('');setTab('overview');
   setPersonalNotice(land?txt(ar,'استُورد ملف الأراضي كمسودة شخصية. راجع البيانات المرجعية في تبويب الشراكة.','Imported the land file as a personal draft. Review reference data in the partnership tab.'):
    txt(ar,'أُضيفت نسخة محلية إلى محفظتك الشخصية.','Added a local copy to your personal portfolio.'));
  }catch{
   if(currentUserRef.current===userId)setPersonalNotice(txt(ar,'تعذّر إضافة النسخة. تحقّق من صيغة الملف ومساحة التخزين وحدّ الدراسات.','Could not add the backup. Check the file format, storage and portfolio limit.'));
  }finally{input.value='';}
 };
 const create=async()=>{
  if(personalScope&&readOnly)return;
  const title=projectName.trim();if(!title)return;
  setCreateError('');
  const next=newSector==='REAL_ESTATE'&&newStarter==='RAW_LAND'
   ?createRawLandStarter(uid(),title)
   :newSector==='INDUSTRIAL'&&newStarter!=='RAW_LAND'
   ?createIndustrialStarter(uid(),title,newStarter)
   :createStudy(uid(),title,newSector);
  if(personalScope){
   setStudies(p=>[next,...p]);setSelectedId(next.id);setSharedSelectedId('');
   setProjectName('');createDialog.current?.close();setTab('profile');
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
   setProjectName('');createDialog.current?.close();setTab('profile');
   setCompanyNotice(txt(ar,'تم إنشاء دراسة مؤسسية ضمن الشركة المحددة.','Institutional study created within the selected organization.'));
  }catch(e){
   if(currentUserRef.current!==requestedUser||
     organizationRequestRef.current!==requestId)return;
   setCreateError(txt(ar,'لم يتم إنشاء الدراسة المؤسسية؛ تحقق من الترخيص والصلاحيات.','Study creation failed; verify company permissions and licence.'));
  }finally{
   if(organizationRequestRef.current===requestId)setOrganizationBusy(false);
  }
 };
 const remove=()=>{
  if(!personalScope||effectiveReadOnly||!study||!window.confirm(txt(ar,'حذف مسودة هذا المشروع من هذا المتصفح فقط؟','Delete this local draft from this browser only?')))return;
  setStudies(p=>p.filter(s=>s.id!==study.id));setSelectedId(studies.find(x=>x.id!==study.id)?.id||'');
 };
 const createCompanyDeniedReason=!personalScope
  ?(!organizationId
    ?txt(ar,'اختر المؤسسة من البانر الرئيسي لبدء دراسة جديدة.','Select an organization from the main banner to create a study.')
    :organizationError||(!companyScopeReady
      ?txt(ar,'جارٍ التحقق من عضوية المؤسسة وإتاحة المحفظة.','Checking company membership and portfolio access.')
      :!organizationCanWrite
       ?txt(ar,'هذه المحفظة للقراءة فقط. لإضافة دراسة، يلزم دور مالك أو مدير نشط وتجربة مؤسسية سارية أو باقة تشمل دراسات الجدوى.','This portfolio is read only. Adding a study requires an active owner or admin role and either an active organization trial or a subscription that includes feasibility studies.')
       :''))
  :'';
 const emptyTitle=personalScope?txt(ar,'ابدأ بأول مشروع','Start your first project'):txt(ar,'لا توجد دراسات لدى المؤسسة المحددة','No studies for the selected organization');
 const emptyDescription=personalScope?txt(ar,'ادخل اسم المشروع ونوعه. تبدأ الأرقام بصفر لتجنب عرض نتائج افتراضية على أنها دراسة حقيقية.','Enter a project name and sector. All figures start at zero to avoid implying a real feasibility result.'):organizationError||(!organizationId?txt(ar,'اختر المؤسسة من البانر الرئيسي أولًا.','Select the organization from the main topbar first.'):txt(ar,'يمكن للمستخدمين المخوّلين إنشاء الدراسات، ولا تظهر هنا المسودات الشخصية إلا بعد مشاركة معتمدة.','Authorized members may create company studies. Personal drafts do not appear here without an approved share.'));
 const canCreate=personalScope?!readOnly&&storageSafe:
  companyScopeReady&&organizationCanWrite&&!organizationError&&!organizationBusy&&!!organizationId;
 const details=tab==='operations'&&water?{id:'water' as const, label:txt(ar,'تفاصيل مصنع المياه','Water factory details')}:
  tab==='partners'&&water?{id:'valuation' as const,label:txt(ar,'تقييم الأرض والترخيص','Land and licence valuation')}:
  tab==='scenarios'&&water?{id:'scenario' as const,label:txt(ar,'محرر السيناريوهات','Scenario editor')}:
  tab==='legal'?{id:'evidence' as const,label:txt(ar,'أدلة التراخيص','Licensing evidence')}:
  tab==='sharing'?{id:'permissions' as const,label:txt(ar,'الصلاحيات والتدقيق','Permissions and audit')}:null;
 const openCreate=()=>{setNotice(undefined);setCreateError('');createDialog.current?.showModal()};
 const closeCreate=()=>{
  if(organizationBusy)return;
  createDialog.current?.close();
  setProjectName('');
 };
 const activeTab=tabs.find(item=>item.id===tab)!;
 const compactStudyHeader=Boolean(study&&(tab==='advanced'||tab==='report'));

 const portfolio=<section className="card fs-panel fs-royal-portfolio">
   <div className="fs-royal-heading">
    <h2><RoyalIcon name="layers"/>{txt(ar,'محفظة الدراسات الاستثمارية','Investment study portfolio')}</h2>
   </div>
   <div className="fs-royal-portfolio-toolbar">
   <div className="fs-royal-stats" aria-label={txt(ar,'حالات دراسات المحفظة','Portfolio study statuses')}>
    <span>{visibleStudies.length} {txt(ar,'دراسات','studies')}</span>
    <span>{visibleStudies.filter(p=>p.status==='FEASIBILITY').length} {txt(ar,'قيد الدراسة','in feasibility')}</span>
    <span>{visibleStudies.filter(p=>p.status==='IDEA').length} {txt(ar,'مسودات أولية','initial drafts')}</span>
   </div>
    <Button onClick={openCreate} disabled={!canCreate}><RoyalIcon name="plus"/>{txt(ar,'إضافة دراسة','New study')}</Button>
   </div>
   {createCompanyDeniedReason&&<p className="fs-hint" role="status">{createCompanyDeniedReason}</p>}
   {visibleStudies.length>0&&<div className="fs-portfolio">{visibleStudies.map(p=>{
    const checks=handoffReadiness(p).checks;
    const completed=checks.filter(check=>check.passed).length;
    const readiness=new Intl.NumberFormat(locale,{style:'percent',maximumFractionDigits:0}).format(completed/checks.length);
    return <button key={p.id} type="button" className={'fs-project-pill'+(p.id===activeSelectedId?' fs-project-pill--active':'')}
     aria-pressed={p.id===activeSelectedId} onClick={()=>{
      if(personalScope){setSharedSelectedId('');setSelectedId(p.id)}else setOrganizationSelectedId(p.id);
      setTab('overview');setDetail(undefined);
     }}>
     <RoyalIcon name={p.water?'droplet':p.sector==='INDUSTRIAL'?'factory':p.sector==='REAL_ESTATE'?'building':'briefcase'}/>
     <strong>{p.title}</strong>
     <span>{[ar?sectors[p.sector].ar:sectors[p.sector].en,p.country].filter(Boolean).join(' · ')}</span>
     <span className="fs-royal-portfolio-meta"><span className="fs-royal-tag">{ar?projectStatus[p.status].ar:projectStatus[p.status].en}</span>
      <span>{txt(ar,'جاهزية','Readiness')} <bdi>{readiness}</bdi></span></span>
     <progress className="fs-royal-portfolio-progress" value={completed} max={checks.length}
      aria-label={txt(ar,'جاهزية دراسة ','Study readiness: ')+p.title}/>
    </button>})}</div>}
  </section>;

 if(personalScope&&hydratedStorageKey!==storageKey){
  return <main className="container fs-page fs-royal" dir={ar?'rtl':'ltr'}><p role="status">{txt(ar,'جاري تحميل مسودات الحساب الحالي…','Loading this account\'s drafts…')}</p></main>;
 }
 return <main className="container fs-page fs-royal" data-compact-study-header={compactStudyHeader||undefined} dir={ar?'rtl':'ltr'}>
  {organizationEnabled&&!personalScope&&<TopbarOrganizationControls>
   <WorkspaceOrganizationPicker royalDialog ar={ar} organizations={organizations} value={organizationId}
    onChange={setOrganizationId} restore={false} disabled={organizationBusy}
    beforeChange={()=>!organizationStudies.some(x=>organizationRecords[x.id]?.study.updatedAt!==x.updatedAt)||
     window.confirm(txt(ar,'التعديلات غير محفوظة. هل تريد تبديل المؤسسة؟','Company changes are unsaved. Switch organizations?'))}/>
  </TopbarOrganizationControls>}
  <header className="fs-head"><div><h1><RoyalIcon name="building"/>{txt(ar,'دراسات الجدوى وتأسيس المشاريع','Feasibility & project development')}</h1><p>{txt(ar,'دراسات مستقلة عن الدفاتر المحاسبية والمحرك المالي القديم؛ الربط لاحقًا مع Financial Core V2 فقط.','Pre-investment studies stay separate from accounting ledgers. Future integration will target Financial Core V2 only.')}</p></div>
   {personalScope&&<div className="fs-actions"><Button secondary onClick={download} disabled={!personalScope||!visibleStudies.length}>{txt(ar,'تصدير نسخة JSON','Export JSON')}</Button><label className="fs-btn fs-btn--secondary fs-upload">{txt(ar,'استيراد نسخة','Import backup')}<input type="file" accept=".json,application/json" onChange={importBackup} disabled={readOnly||!personalScope||!storageSafe||cloudBusy}/></label><Button secondary onClick={openReport} disabled={!study}>{txt(ar,'عرض تقرير الطباعة','Open printable report')}</Button>{cloudEnabled&&personalScope&&<><Button secondary onClick={()=>void loadCloud()} disabled={cloudBusy}>{txt(ar,'استرجاع من السحابة','Restore from cloud')}</Button><Button secondary onClick={()=>void saveCloud()} disabled={effectiveReadOnly||!study||cloudBusy}>{txt(ar,'حفظ سحابي','Save to cloud')}</Button></>}</div>}
   {!personalScope&&organizationId&&organizationLoaded&&!organizationError&&<div className="fs-actions">
    <Button secondary onClick={()=>void loadCloud()} disabled={organizationBusy}>{txt(ar,'إعادة تحميل دراسات المؤسسة','Refresh company studies')}</Button>
    <Button secondary onClick={()=>void saveCloud()} disabled={!study||effectiveReadOnly||organizationBusy}>{txt(ar,'حفظ دراسة المؤسسة','Save company study')}</Button>
    <Button secondary onClick={openReport} disabled={!study}>{txt(ar,'عرض تقرير الطباعة','Open printable report')}</Button>
   </div>}
  </header>
  {!compactStudyHeader&&<section className="fs-royal-module-intro" aria-label={txt(ar,'وحدة دراسات الجدوى','Feasibility studies module')}>
   <RoyalIcon name="chart"/>
   <div><h2>{txt(ar,'وحدة دراسات الجدوى','Feasibility studies')}</h2>
    <p>{txt(ar,'تقييم فرص الاستثمار وتمويل المشاريع من خلال بيانات الدراسة الفعلية ومراجعة المخاطر والتراخيص.',
     'Assess investment opportunities and project funding using study inputs, risk reviews and licence checks.')}</p></div>
  </section>}
  <p className="fs-warning" role="status">{!personalScope?organizationError||txt(ar,'محفظة المؤسسة مستقلة عن مسوداتك الشخصية. تُحفظ الدراسات المؤسسية بعد التحقق من عضوية المؤسسة وصلاحياتها.','The company portfolio is separate from your personal drafts. Organization studies are saved using server-verified membership and permissions.'):sharedStudy?txt(ar,'مشروع مشترك للقراءة والمراجعة فقط؛ لا يمكنك تغيير بيانات مالكه.','Shared project: read and review only, without changes to its owner\u0027s data.'):readOnly?txt(ar,'الاشتراك في وضع القراءة والتصدير فقط؛ انتهت صلاحية التحرير أو تم تعليقها.','This subscription permits reading and exporting only; editing access expired or was suspended.'):cloudEnabled?txt(ar,'تحفظ المسودة الشخصية في محفظتك. استخدم الحفظ السحابي لاستعادتها أو نسخها إلى مؤسسة بإذن صريح.','Save your personal draft to the cloud to restore it later or to copy it to an organization with your explicit consent.'):txt(ar,'نسخة أولية معزولة: تحفظ المسودات في متصفحك فقط، ولا تتزامن بين الأجهزة أو المستخدمين بعد. ليست دراسة معتمدة أو قيودًا محاسبية.','Isolated first iteration: drafts are browser-local, not synced between devices or users, and are not approved studies or accounting entries.')}</p>
  {visibleNotice&&<p className="fs-notice" role="status">{visibleNotice} <button type="button" onClick={()=>setNotice(undefined)} aria-label={txt(ar,'إغلاق الرسالة','Dismiss message')}>×</button></p>}
  {visibleSaveIssue&&<section className="fs-royal-state" data-tone="warning" role="alert">
   <h2><RoyalIcon name="file"/>{visibleSaveIssue.kind==='conflict'?txt(ar,'تعارض في الإصدار','Revision conflict'):txt(ar,'تعذّر حفظ الدراسة','Study could not be saved')}</h2>
   <p>{visibleSaveIssue.message}</p>
   {personalScope&&<Button secondary onClick={download} disabled={!visibleStudies.length}>{txt(ar,'تنزيل نسخة JSON','Download JSON backup')}</Button>}
  </section>}
  {study&&effectiveReadOnly&&<section className="fs-royal-state" data-tone="neutral" role="status">
   <h2><RoyalIcon name="shield"/>{txt(ar,'الدراسة للقراءة فقط','Study is read only')}</h2>
   <p>{txt(ar,'يمكنك فتح أقسام الدراسة حسب صلاحيتك الحالية.','Open the study sections available under your current access.')}</p>
  </section>}
  {!study&&portfolio}
  <dialog ref={createDialog} className="fs-dialog fs-royal-dialog" aria-labelledby="fs-royal-create-title"
   onCancel={event=>{event.preventDefault();closeCreate()}}>
   <div className="fs-royal-heading"><h2 id="fs-royal-create-title"><RoyalIcon name="plus"/>
    {txt(ar,'إنشاء دراسة جدوى جديدة','Create a feasibility study')}</h2>
    <button type="button" className="fs-royal-close" disabled={organizationBusy} onClick={closeCreate}
     aria-label={txt(ar,'إغلاق','Close')}>×</button></div>
   <p className="fs-hint">{personalScope?txt(ar,'النطاق الشخصي','Personal workspace'):
    txt(ar,'المؤسسة المحددة في البنر الرئيسي','Organization selected in the main banner')+
    ' · '+(organizations.find(item=>item.id===organizationId)?.name??'')}</p>
   <form onSubmit={event=>{event.preventDefault();if(canCreate)void create()}}>
    <div className="fs-form-grid">
     <label className="fs-field"><span>{txt(ar,'اسم المشروع الجديد','New project name')}</span>
      <input required maxLength={300} value={projectName} disabled={organizationBusy}
       onChange={event=>setProjectName(event.currentTarget.value)} /></label>
     <label className="fs-field"><span>{txt(ar,'نوع المشروع','Project type')}</span>
      <select aria-label={txt(ar,'نوع المشروع','Project type')} value={newSector} disabled={organizationBusy} onChange={event=>{setNewSector(event.currentTarget.value as Sector);setNewStarter('GENERAL')}}>
       {Object.entries(sectors).map(([value,name])=><option key={value} value={value}>{ar?name.ar:name.en}</option>)}
      </select></label>
    </div>
    <p className="fs-hint">{personalScope
     ?txt(ar,'تظهر الدراسة في محفظتك الشخصية بعد الإنشاء.','Your study appears in your personal portfolio after creation.')
     :txt(ar,'تُنشأ الدراسة في محفظة المؤسسة المحددة في البنر.','The study is created in the portfolio of the organization selected in the main banner.')}</p>
    <fieldset className="fs-royal-starter">
     <legend>{txt(ar,'اختر قالبًا للبدء','Choose a starter template')}</legend>
     <div className="fs-royal-template-grid">
     {([
      ['BOTTLED_WATER','مصنع مياه معبأة','Bottled-water factory','الطاقة والتعبئة والترخيص','Capacity, bottling and licensing','droplet'],
      ['DAIRY_CHEESE','مصنع ألبان وأجبان','Dairy & cheese factory','الحليب والمعالجة والتبريد','Milk processing and refrigeration','factory'],
      ['GENERAL','مشروع عام','General study','أساسيات الاستثمار والتشغيل','Investment and operating assumptions','layers'],
      ['RAW_LAND','تطوير الأراضي الخام والمخططات العقارية','Raw land and subdivision development','المساحات والاستخدامات والمرحلية','Land uses and phased development','building'],
      ['REAL_ESTATE','مشروع عقاري','Property project','المراحل والعقود والتحصيل','Development phases, contracts and collections','building']
     ] as const).map(([kind,a,b,subAr,subEn,icon])=>{
      const current=newSector==='REAL_ESTATE'?(newStarter==='RAW_LAND'?'RAW_LAND':'REAL_ESTATE'):newSector==='INDUSTRIAL'?newStarter:'GENERAL';
      return <label key={kind} className="fs-check" data-selected={current===kind}>
       <input type="radio" name="feasibility-template" aria-label={txt(ar,a,b)} checked={current===kind} disabled={organizationBusy}
        onChange={()=>{
         if(kind==='REAL_ESTATE'||kind==='RAW_LAND'){setNewSector('REAL_ESTATE');setNewStarter(kind==='RAW_LAND'?kind:'GENERAL');return}
         if(kind!=='GENERAL'||newSector==='REAL_ESTATE')setNewSector('INDUSTRIAL');
         setNewStarter(kind);
        }}/>
       <RoyalIcon name={icon}/><span><strong>{txt(ar,a,b)}</strong><small>{txt(ar,subAr,subEn)}</small></span>
      </label>;
     })}
     </div>
    </fieldset>
    {organizationBusy&&<p role="status">{txt(ar,'جارٍ إنشاء الدراسة…','Creating the study…')}</p>}
    {createError&&<p role="alert">{createError}</p>}
    <div className="fs-actions">
     <button type="submit" className="fs-btn" disabled={!canCreate||!projectName.trim()}>{txt(ar,'إضافة مشروع +','Add project +')}</button>
     <Button secondary onClick={closeCreate} disabled={organizationBusy}>{txt(ar,'إلغاء','Cancel')}</Button>
    </div>
   </form>
  </dialog>

  {(organizationSharing||personalScope&&sharingEnabled)&&<details className="fs-royal-shared-access">
   <summary><RoyalIcon name="share"/>{txt(ar,'الوصول إلى الدراسات المشتركة','Access shared studies')}</summary>
   <div className="fs-block">
  {organizationSharing&&<Link className="fs-btn fs-btn--secondary" href={'/'+locale+'/feasibility/shared'+(organizationId?'?organization='+encodeURIComponent(organizationId):'')}>
   {txt(ar,'الدراسات المشتركة مع المؤسسة','Studies shared with the organization')}
  </Link>}

   {sharingEnabled&&personalScope&&<JoinInvitationPanel locale={locale}/>}
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
   </div>
  </details>}

  {!(personalScope?loaded:organizationLoaded)?<section className="fs-royal-state" role="status" aria-busy="true">
   <h2><RoyalIcon name="file"/>{txt(ar,'جاري تحميل الدراسات…','Loading studies…')}</h2>
  </section>:!personalScope&&organizationError?<section className="fs-royal-state" data-tone="warning" role="alert">
   <h2><RoyalIcon name="shield"/>{txt(ar,'محفظة المؤسسة غير متاحة','Organization portfolio unavailable')}</h2>
   <p>{organizationError}</p>
   <Button secondary onClick={()=>setOrganizationReload(value=>value+1)}>{txt(ar,'إعادة محاولة التحميل','Retry loading')}</Button>
  </section>:!study?<section className="card fs-empty fs-royal-empty">
   <RoyalIcon name={personalScope?'file':'building'}/><h2>{emptyTitle}</h2><p>{emptyDescription}</p>
   {!personalScope&&companyScopeReady&&<p className="fs-hint">{[organizations.find(item=>item.id===organizationId)?.name,
    organizationCanWrite?txt(ar,'الإنشاء متاح','Creation available'):txt(ar,'القراءة فقط','Read only')].filter(Boolean).join(' · ')}</p>}
   <div className="fs-actions">
    {canCreate&&<Button onClick={openCreate}>{txt(ar,'إنشاء أول دراسة','Create first study')}</Button>}
    {!personalScope&&<Button secondary onClick={()=>{
      const control=document.querySelector<HTMLElement>('.corp-topbar .corp-workspace-scope button:first-child');
      control?.focus();control?.scrollIntoView({block:'nearest'});
     }}>{txt(ar,'الذهاب إلى النطاق الشخصي في البنر','Go to personal scope in the main banner')}</Button>}
   </div>
   {!personalScope&&<p className="fs-hint">{txt(ar,'لنسخ دراسة، افتح محفظتك الشخصية، احفظ الدراسة، ثم استخدم «نسخ إلى مؤسسة».','To copy a study, open your personal portfolio, save the study, then use Copy to organization.')}</p>}</section>:<>
   <div className="fs-subhead fs-print-study-title fs-royal-project-context"><div><h2><RoyalIcon name={study.water?'droplet':study.sector==='REAL_ESTATE'?'building':'briefcase'}/>{study.title}</h2><small>{[ar?sectors[study.sector].ar:sectors[study.sector].en,study.country||txt(ar,'الدولة غير محددة','Country not selected'),study.region,study.currency||txt(ar,'العملة غير محددة','Currency not selected')].filter(Boolean).join(' · ')}</small></div>
    <div className="fs-royal-context-badges" aria-label={txt(ar,'سياق الدراسة','Study context')}>
     <span className="fs-royal-tag" data-scope={scope}>{personalScope?txt(ar,'نطاق شخصي','Personal scope'):txt(ar,'نطاق مؤسسي','Organization scope')}</span>
     <span className="fs-royal-tag">{ar?projectStatus[study.status].ar:projectStatus[study.status].en}</span>
     <span className="fs-royal-tag">{txt(ar,'جاهزية','Readiness')} <bdi>{studyReadiness}</bdi></span>
     <span className="fs-royal-tag">{txt(ar,'آخر تعديل','Last updated')} <time dateTime={study.updatedAt}>{new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(study.updatedAt))}</time></span>
    </div>{personalScope&&<div className="fs-actions">
    {canOpenCopy&&tab!=='profile'&&<Button secondary onClick={openCopy}>{txt(ar,'نسخ إلى مؤسسة','Copy to organization')}</Button>}
    <Button secondary onClick={remove} disabled={effectiveReadOnly}>{txt(ar,'حذف المسودة','Delete draft')}</Button>
   </div>}</div>
   {canOpenCopy&&copyRevision!==undefined&&copySelection?.studyId===study.id&&
    copySelection.organizationId===organizationId&&copySelection.userId===userId&&
    <CopyToOrganizationDialog locale={locale} sourceId={study.id} sourceTitle={study.title}
     revision={copyRevision} organizationId={organizationId} onClose={()=>setCopySelection(null)}/>}
   <FeasibilitySidebar locale={locale} sections={studyTabs} active={tab} onSelect={id=>{
    selectSection(id);
    requestAnimationFrame(()=>sectionHeadingRef.current?.scrollIntoView({block:'start'}));
   }}/>
   <nav ref={navigationRef} className="fs-tabs" data-section={tab} aria-label={txt(ar,'أقسام دراسة المشروع','Study sections')}>{studyTabs.map(t=><button type="button" key={t.id} onClick={event=>{
    selectSection(t.id);
    if(navigationRef.current?.scrollWidth!==navigationRef.current?.clientWidth)
     event.currentTarget.scrollIntoView({block:'nearest',inline:'nearest'});
   }} className={tab===t.id?'active':''} aria-current={tab===t.id?'page':undefined}><RoyalIcon name={studyTabIcons[t.id]}/><span>{ar?t.ar:t.en}</span></button>)}</nav>
   <div className="fs-royal-section-lead" ref={sectionHeadingRef}>
    <h2><RoyalIcon name={studyTabIcons[tab]}/>{tab==='report'?txt(ar,'التقرير الشامل','Feasibility report'):details&&detail===details.id?details.label:ar?activeTab.ar:activeTab.en}</h2>
    {details&&<button className="fs-btn fs-btn--secondary" type="button" aria-pressed={detail===details.id}
     onClick={()=>setDetail(value=>value===details.id?undefined:details.id)}>
     {detail===details.id?txt(ar,'عودة إلى القسم','Back to section'):details.label}
    </button>}
   </div>
   {tab==='overview'&&portfolio}
   {tab==='report'&&<FeasibilityReport study={study} locale={locale} titleInWorkspace/>}
   {tab==='overview'&&model&&!rawLand&&<RoyalOverview study={study} locale={locale} model={model}
    sectorLabel={ar?sectors[study.sector].ar:sectors[study.sector].en}
    statusLabel={ar?projectStatus[study.status].ar:projectStatus[study.status].en}
    onTasks={()=>{setTab('tasks');setDetail(undefined)}}/>}
   <fieldset className="fs-study-scope" disabled={effectiveReadOnly} aria-label={txt(ar,'محتوى دراسة المشروع','Study content')}>
   {rawLand&&waterTab&&<RawLandPanel model={rawLand} tab={waterTab} locale={locale} currency={study.currency}
    onChange={value=>update({rawLand:value})}/>}
   {water&&waterTab&&waterTab!=='overview'&&<WaterModelPanel water={water} tab={waterTab} detail={details?.id===detail?detail:undefined}
     currency={study.currency} locale={locale} suppliers={study.suppliers} onChange={water=>update({water})}/>}
   {water&&tab==='overview'&&<details className="fs-royal-shared-access">
    <summary>{txt(ar,'تفاصيل ومؤشرات مصنع المياه','Detailed water factory indicators')}</summary>
    <WaterModelPanel water={water} tab="overview" currency={study.currency} locale={locale} onChange={water=>update({water})}/>
   </details>}
   {!water&&!rawLand&&tab==='overview'&&model&&<details className="fs-royal-shared-access">
    <summary>{txt(ar,'تفاصيل التمويل','Funding details')}</summary>
    <p>{txt(ar,'نسبة الممول في حقوق الملكية','Investor equity share')}: {model.investorShare===null?'—':fmt(model.investorShare,2)+'%'}</p>
    <div className="card fs-panel"><h3>{txt(ar,'إشارات القرار','Decision diagnostics')}</h3><p>{model.cashFundingGap>0?txt(ar,'فجوة التمويل النقدي: ','Cash funding gap: ')+money(model.cashFundingGap):txt(ar,'لا توجد فجوة تمويل نقدية وفق المدخلات.','No positive cash funding gap under current inputs.')}</p><p>{!study.landTransferred&&study.landValue>0?txt(ar,'الأرض لم تنقل للشركة؛ لا تدخل قيمتها السوقية ضمن حقوق ملكيتها.','Land is not transferred; its full market value does not count as company equity.'):txt(ar,'راجع قيمة الحصة العينية مع جهة مستقلة.','Verify any in-kind contribution independently.')}</p><p>{!model.ready?txt(ar,'استكمل الاستثمار والسعر والحجم قبل اعتماد مؤشرات الجدوى.','Enter investment, price and sales volume before relying on projections.'):txt(ar,'النتائج استرشادية، وليست اعتمادًا للقرار الاستثماري.','Results are indicative, not investment approval.')}</p></div>
   </details>}
   {tab==='profile'&&<StudyProfilePanel key={study.id} study={study} locale={locale}
    personalScope={personalScope} shared={!!sharedStudy} readOnly={effectiveReadOnly}
    organizationName={organizations.find(item=>item.id===organizationId)?.name}
    revision={personalScope?cloudRevisions[study.id]:organizationRecords[study.id]?.revision}
    savedToCloud={personalScope?cloudSavedStudyVersions[study.id]===study.updatedAt:organizationRecords[study.id]?.study.updatedAt===study.updatedAt}
    saveBusy={personalScope?cloudBusy:organizationBusy} onChange={update}
    onSave={cloudEnabled||!personalScope?()=>void saveCloud():undefined}
    onCopy={canOpenCopy?openCopy:undefined}
    sectorOptions={Object.entries(sectors).map(([value,name])=>({value:value as Sector,label:ar?name.ar:name.en}))}
    statusOptions={Object.entries(projectStatus).map(([value,name])=>({value:value as StudyStatus,label:ar?name.ar:name.en}))}/>}
   {!water&&!rawLand&&tab==='investment'&&<GeneralInvestmentPanel study={study} locale={locale} onChange={update}/>}
   {!water&&!rawLand&&tab==='partners'&&model&&<section className="card fs-panel"><h3>{txt(ar,'المساهمات وحصص الملكية','Contributions and equity')}</h3><label className="fs-check"><input type="checkbox" checked={study.landTransferred} onChange={e=>update({landTransferred:e.currentTarget.checked})}/>{txt(ar,'تُنقل الأرض إلى ملكية الشركة كحصة عينية مثبتة','Land is transferred into company ownership as an independently valued in-kind contribution')}</label>
    <div className="fs-form-grid"><Field label={txt(ar,'القيمة المقدرة للأرض','Estimated land value')} value={study.landValue} onChange={setNum('landValue')}/><Field label={txt(ar,'مساهمة الممول كرأس مال','Investor equity cash')} value={study.investorEquity} onChange={setNum('investorEquity')}/><Field label={txt(ar,'مساهمة صاحب الأرض النقدية','Land partner cash equity')} value={study.partnerCashEquity} onChange={setNum('partnerCashEquity')}/><Field label={txt(ar,'قرض الممول إلى الشركة','Investor shareholder loan')} value={study.investorLoan} onChange={setNum('investorLoan')}/><Field label={txt(ar,'تمويل ديون أخرى','Other debt')} value={study.otherDebt} onChange={setNum('otherDebt')}/></div>
    <div className="fs-kpis"><Info label={txt(ar,'حصة الممول','Investor ownership')} value={model.investorShare===null?'—':fmt(model.investorShare,2)+'%'}/><Info label={txt(ar,'حصة صاحب الأرض','Land partner ownership')} value={model.partnerShare===null?'—':fmt(model.partnerShare,2)+'%'}/><Info label={txt(ar,'فجوة التمويل النقدي','Cash funding gap')} value={money(model.cashFundingGap)}/></div>
    <p className="fs-hint">{txt(ar,'النسب اقتصادية تقديرية لحقوق الملكية فقط؛ قروض المساهمين لا تمنح ملكية تلقائيًا، ولا تتغير الحصص القانونية دون إجراءات معتمدة.','Economic indicative equity only: loans do not automatically generate shares; legal ownership changes require formal approval.')}</p>
   </section>}
   {!water&&!rawLand&&tab==='operations'&&<section className="card fs-panel"><h3>{txt(ar,'افتراضات التشغيل والمبيعات','Operating assumptions')}</h3><div className="fs-form-grid">
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
   {!water&&!rawLand&&tab==='scenarios'&&<RoyalScenarios study={study} locale={locale} selected={scenario}
    onSelect={setScenario} onChange={scenarioAssumptions=>update({scenarioAssumptions})}/> }
   {!water&&!rawLand&&tab==='cashflow'&&model&&<section className="card fs-panel"><h3>{txt(ar,'التدفقات النقدية التشغيلية المبسطة','Simplified annual project cash flows')}</h3><div className="fs-kpis"><Info label="NPV" value={model.ready?money(model.npv):'—'}/><Info label="IRR" value={model.ready&&model.irr!==null?fmt(model.irr,2)+'%':'—'}/><Info label={txt(ar,'مدة الاسترداد','Payback period')} value={model.ready&&model.paybackYears!==null?fmt(model.paybackYears,2)+' '+txt(ar,'سنة','years'):'—'}/><Info label={txt(ar,'التعادل الشهري بالوحدات','Monthly break-even units')} value={model.ready?fmt(model.breakevenMonthlyUnits):'—'}/></div>
    <div className="fs-table-wrap"><table className="fs-table"><thead><tr><th>{txt(ar,'السنة','Year')}</th><th>{txt(ar,'الإيرادات','Revenue')}</th><th>{txt(ar,'المتغيرة','Variable costs')}</th><th>{txt(ar,'الثابتة','Fixed costs')}</th><th>EBITDA</th><th>{txt(ar,'ضريبة تقديرية','Indicative tax')}</th><th>{txt(ar,'التدفق الحر','Project FCF')}</th></tr></thead><tbody><tr><td>0</td><td colSpan={5}>{txt(ar,'الاستثمار الأولي بما فيه الأرض العينية ورأس المال العامل','Initial investment including in-kind land and working capital')}</td><td>{money(model.flows[0])}</td></tr>{model.annual.map(a=><tr key={a.year}><td>{a.year}</td><td>{money(a.revenue)}</td><td>{money(a.variable)}</td><td>{money(a.fixed)}</td><td>{money(a.ebitda)}</td><td>{money(a.taxEstimate)}</td><td>{money(a.freeCashFlow)}</td></tr>)}</tbody></table></div>
    <ul className="fs-notes">{model.notes.map(x=><li key={x}>{x}</li>)}</ul>
   </section>}
   {!water&&!rawLand&&model?.ready&&tab==='cashflow'&&<RoyalCashTrend
    title={txt(ar,'التدفق النقدي التراكمي','Cumulative cash flow')} locale={locale} unit={study.currency} flows={model.flows}/>}
   {tab==='cashflow'&&<MonthlyLiquidityPanel study={study} locale={locale} readOnly={effectiveReadOnly}
    onChange={monthlyLiquidity=>update({monthlyLiquidity})}/>}
   {!water&&!rawLand&&model&&tab==='partners'&&<RoyalOwnership title={txt(ar,'حصص الملكية الاقتصادية','Economic ownership')}
    locale={locale} data={[
     {label:txt(ar,'الممول','Investor'),value:model.investorShare??0},
     {label:txt(ar,'صاحب الأرض','Land partner'),value:model.partnerShare??0}
    ]}/>}
   {!water&&!rawLand&&tab==='advanced'&&<AdvancedModelPanel study={study} locale={locale} scenario={scenario} onChange={advanced=>update({advanced})}/>}
   {!water&&!rawLand&&tab==='sector'&&(study.sector==='INDUSTRIAL'||study.sector==='REAL_ESTATE')&&<SectorAnalysisPanel study={study} locale={locale} onChange={sectorSchedule=>update({sectorSchedule})}/>}
   {(tab==='legal'||tab==='tasks'||tab==='risks'||tab==='suppliers'||tab==='decisions')&&
    <StudyRegisters key={study.id+':'+tab} study={study} tab={tab} evidence={detail==='evidence'} locale={locale} onChange={update}/>}
   {tab==='sharing'&&personalScope&&<CollaborationPanel key={userId+':'+study.id} audit={detail==='permissions'} locale={locale} projectId={study.id} enabled={sharingEnabled&&personalScope} canWrite={!effectiveReadOnly} isOwner={cloudOwnerIds[study.id]===userId}/>}
   {tab==='handoff'&&<ProjectHandoffPanel study={study} locale={locale} onChange={handoff=>update({handoff})} cloudRevision={cloudRevisions[study.id]} cloudCurrent={cloudSavedStudyVersions[study.id]===study.updatedAt} cloudEnabled={cloudEnabled} canWrite={!effectiveReadOnly} bannerOrganizationId={organizationId}/>}
   </fieldset>
   {evidenceEnabled&&!sharedStudy&&(personalScope||organizationSharing)&&
    ((tab==='legal'&&detail==='evidence')||(tab==='partners'&&detail==='valuation'))&&
    <EvidenceDocuments key={userId+':'+saveScopeId+':'+study.id+':'+detail} locale={locale} project={study.id}
     organization={personalScope?undefined:organizationId}
     kind={detail==='evidence'?'licensing':'valuation'} requirements={study.legal}
     saved={personalScope?cloudOwnerIds[study.id]===userId:Boolean(organizationRecords[study.id])}
     canWrite={!effectiveReadOnly}/>}
   {tab==='sharing'&&!personalScope&&organizationSharing&&companyScopeReady&&organizationCanShare&&organizationRecords[study.id]&&
    <OrganizationStudyShares audit={detail==='permissions'} key={userId+':'+organizationId+':'+study.id} locale={locale} organization={organizationId}
     project={study.id} revision={organizationRecords[study.id].revision}
     saved={organizationCanWrite&&organizationRecords[study.id].study===study}/>}
  </>}
 </main>;
}
