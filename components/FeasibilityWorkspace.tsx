'use client';
import {useEffect,useMemo,useState,type ChangeEvent,type ReactNode} from 'react';
import {createStudy,evaluateStudy,scenarioLabels,waterFactoryLegalItems,type ChecklistStatus,type FeasibilityStudy,type Sector,type StudyStatus,type StudyTab,type TaskStatus,type Scenario} from '@/lib/feasibility/engine';
import ProjectHandoffPanel from '@/components/feasibility/ProjectHandoffPanel';
import CollaborationPanel from '@/components/feasibility/CollaborationPanel';
import JoinInvitationPanel from '@/components/feasibility/JoinInvitationPanel';
import AdvancedModelPanel from '@/components/feasibility/AdvancedModelPanel';
import SectorAnalysisPanel from '@/components/feasibility/SectorAnalysisPanel';
import {sectorTemplates} from '@/lib/feasibility/sector-templates';

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
 const ar=locale==='ar', storageKey='yaqeen-feasibility-drafts-v1:'+userId;
 const [loaded,setLoaded]=useState(false);
 const [studies,setStudies]=useState<FeasibilityStudy[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [tab,setTab]=useState<StudyTab>('overview');
 const [projectName,setProjectName]=useState('');
 const [newSector,setNewSector]=useState<Sector>('INDUSTRIAL');
 const [scenario,setScenario]=useState<Scenario>('BASE');
 const [notice,setNotice]=useState('');
 const cloudEnabled=process.env.NEXT_PUBLIC_FEASIBILITY_CLOUD_QA==='true';
 const sharingEnabled=cloudEnabled&&process.env.NEXT_PUBLIC_FEASIBILITY_SHARING_QA==='true';
 const [cloudBusy,setCloudBusy]=useState(false);
 const [cloudRevisions,setCloudRevisions]=useState<Record<string,number>>({});
 const [cloudSavedStudyVersions,setCloudSavedStudyVersions]=useState<Record<string,string>>({});
 const [cloudOwnerIds,setCloudOwnerIds]=useState<Record<string,string>>({});
 useEffect(()=>{
  try{
   const saved=JSON.parse(localStorage.getItem(storageKey)||'null') as {studies?:FeasibilityStudy[];selectedId?:string}|null;
   if(saved&&Array.isArray(saved.studies)) {
    const valid=saved.studies.filter(s=>s&&typeof s.id==='string'&&typeof s.title==='string'&&Array.isArray(s.capex)&&Array.isArray(s.legal)&&Array.isArray(s.tasks)&&Array.isArray(s.risks)&&Array.isArray(s.suppliers)&&Array.isArray(s.decisions));
    setStudies(valid);setSelectedId(saved.selectedId||valid[0]?.id||'');
   }
  }catch{setNotice(txt(ar,'لم يتم استرجاع المسودات المحلية؛ يمكن استيراد نسخة احتياطية JSON.','Local drafts could not be restored; you may import a JSON backup.'));}
  setLoaded(true);
 },[storageKey,ar]);
 useEffect(()=>{if(!loaded)return;try{localStorage.setItem(storageKey,JSON.stringify({version:1,studies,selectedId}));}catch{setNotice(txt(ar,'تعذر حفظ المسودة محليًا. صدّر نسخة JSON.','Could not save locally. Export a JSON backup.'));}},[loaded,storageKey,studies,selectedId,ar]);
 const study=studies.find(s=>s.id===selectedId)??null;
 const sharedStudy=Boolean(study&&cloudOwnerIds[study.id]&&cloudOwnerIds[study.id]!==userId);
 const effectiveReadOnly=readOnly||sharedStudy;
 const model=useMemo(()=>study?evaluateStudy(study,scenario):null,[study,scenario]);
 const base=useMemo(()=>study?evaluateStudy(study):null,[study]);
 const money=(v:number|null|undefined,d=0)=>v==null||!Number.isFinite(v)?'—':fmt(v,d)+' '+(study?.currency??'');
 // Handoff review follows the source study revision; editing any study assumption invalidates it.
 const update=(patch:Partial<FeasibilityStudy>)=>{if(effectiveReadOnly)return;setStudies(prev=>prev.map(p=>p.id===selectedId?{...p,...patch,updatedAt:Object.keys(patch).every(k=>k==='handoff')?p.updatedAt:new Date().toISOString()}:p));};
 const setNum=(key:keyof FeasibilityStudy)=>(v:number)=>update({[key]:v} as Partial<FeasibilityStudy>);
 const download=()=>{
  const blob=new Blob([JSON.stringify({schema:'YAQEEN_FEASIBILITY_DRAFT_V1',exportedAt:new Date().toISOString(),studies},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='yaqeen-feasibility-backup.json';anchor.click();URL.revokeObjectURL(url);
 };
 // Explicit cloud synchronization: local drafts are never silently overwritten.
 const loadCloud=async()=>{
  if(cloudBusy)return;
  if(studies.length&&!window.confirm(txt(ar,'سيتم استبدال المسودات المحلية بمسودات QA المحفوظة؛ صدّر نسخة احتياطية أولًا. متابعة؟','This replaces local drafts with saved QA copies. Export a backup first. Continue?')))return;
  setCloudBusy(true);
  try{
   const response=await fetch('/api/feasibility/projects',{cache:'no-store'});
   if(!response.ok)throw new Error('READ_FAILED');
   const rows=await response.json() as Array<{id:string;study:FeasibilityStudy;revision:number;owner_user_id:string}>;
   if(!Array.isArray(rows)||!rows.every(x=>x&&x.study&&x.study.id===x.id&&Array.isArray(x.study.capex)))throw new Error('INVALID_RESPONSE');
   const documents=rows.map(x=>x.study);
   setStudies(documents);setSelectedId(documents[0]?.id??'');setTab('overview');
   setCloudRevisions(Object.fromEntries(rows.map(x=>[x.id,x.revision])));
   setCloudSavedStudyVersions(Object.fromEntries(rows.map(x=>[x.id,x.study.updatedAt])));
   setCloudOwnerIds(Object.fromEntries(rows.map(x=>[x.id,x.owner_user_id])));
   setNotice(txt(ar,'تم استرجاع المسودات من QA V2.','Drafts restored from QA V2.'));
  }catch{setNotice(txt(ar,'تعذر استرجاع المسودات من QA. لم تُغيّر البيانات المحلية.','Could not restore QA drafts; local data were not changed.'))}
  finally{setCloudBusy(false)}
 };
 const saveCloud=async()=>{
  if(effectiveReadOnly||cloudBusy||!study)return;
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
  if(readOnly)return;
  const file=e.currentTarget.files?.[0];if(!file)return;
  try{
   if(file.size>2_000_000)throw new Error('large');
   const data=JSON.parse(await file.text()) as {schema?:string;studies?:FeasibilityStudy[]};
   if(data.schema!=='YAQEEN_FEASIBILITY_DRAFT_V1'||!Array.isArray(data.studies)||data.studies.length>300||
     !data.studies.every(x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&x.title.length<300&&
     Array.isArray(x.capex)&&Array.isArray(x.tasks)&&Array.isArray(x.legal)&&Array.isArray(x.risks)&&Array.isArray(x.suppliers)&&Array.isArray(x.decisions)))throw new Error('format');
   // Imports replace local drafts. No financial ledger, database or Financial Core mutation.
   if(!window.confirm(txt(ar,'سيتم استبدال المسودات المحلية الحالية بالملف المستورد. متابعة؟','This replaces current local drafts. Continue?')))return;
   // Imported backups have no trusted server revision: do not reuse optimistic locks from a previous draft.
   setCloudRevisions({});
   setCloudSavedStudyVersions({});
   setCloudOwnerIds({});
   setStudies(data.studies);setSelectedId(data.studies[0]?.id||'');setTab('overview');
   setNotice(txt(ar,'تم استيراد المسودات محليًا.','Local drafts imported.'));
  }catch{setNotice(txt(ar,'ملف النسخة الاحتياطية غير صالح.','Invalid backup file.'));}
  e.currentTarget.value='';
 };
 const create=()=>{
  if(readOnly)return;
  const title=projectName.trim();if(!title)return;
  const next=createStudy(uid(),title,newSector);
  setStudies(p=>[next,...p]);setSelectedId(next.id);setProjectName('');setTab('profile');
 };
 const remove=()=>{
  if(effectiveReadOnly||!study||!window.confirm(txt(ar,'حذف مسودة هذا المشروع من هذا المتصفح فقط؟','Delete this local draft from this browser only?')))return;
  setStudies(p=>p.filter(s=>s.id!==study.id));setSelectedId(studies.find(x=>x.id!==study.id)?.id||'');
 };
 const choices=<>
  <SelectField label={txt(ar,'النوع','Sector')} value={study?.sector??'INDUSTRIAL'} items={Object.entries(sectors).map(([value,name])=>({value:value as Sector,label:ar?name.ar:name.en}))} onChange={sector=>update({sector})}/>
  <SelectField label={txt(ar,'مرحلة المشروع','Stage')} value={study?.status??'IDEA'} items={Object.entries(projectStatus).map(([value,name])=>({value:value as StudyStatus,label:ar?name.ar:name.en}))} onChange={status=>update({status})}/>
 </>;
 const legalDone=study?.legal.filter(x=>x.status==='VERIFIED').length??0;
 const taskDone=study?.tasks.filter(x=>x.status==='DONE').length??0;
 return <main className="container fs-page" dir={ar?'rtl':'ltr'}>
  <header className="fs-head"><div><span className="fs-eyebrow">YAQEEN BUSINESS / FEASIBILITY</span><h1>{txt(ar,'دراسات الجدوى وتأسيس المشاريع','Feasibility & project development')}</h1><p>{txt(ar,'دراسات مستقلة عن الدفاتر المحاسبية والمحرك المالي القديم؛ الربط لاحقًا مع Financial Core V2 فقط.','Pre-investment studies stay separate from accounting ledgers. Future integration will target Financial Core V2 only.')}</p></div>
   <div className="fs-actions"><Button secondary onClick={download} disabled={!studies.length}>{txt(ar,'تصدير نسخة JSON','Export JSON')}</Button><label className="fs-btn fs-btn--secondary fs-upload">{txt(ar,'استيراد نسخة','Import backup')}<input type="file" accept=".json,application/json" onChange={importBackup} disabled={readOnly}/></label><Button secondary onClick={()=>window.print()} disabled={!study}>{txt(ar,'طباعة الدراسة','Print study')}</Button>{cloudEnabled&&<><Button secondary onClick={()=>void loadCloud()} disabled={cloudBusy}>{txt(ar,'استرجاع من QA V2','Restore from QA V2')}</Button><Button secondary onClick={()=>void saveCloud()} disabled={effectiveReadOnly||!study||cloudBusy}>{txt(ar,'حفظ في QA V2','Save to QA V2')}</Button></>}</div>
  </header>
  <p className="fs-warning" role="status">{sharedStudy?txt(ar,'مشروع مشترك للقراءة والمراجعة فقط؛ لا يمكنك تغيير بيانات مالكه.','Shared project: read and review only, without changes to its owner\u0027s data.'):readOnly?txt(ar,'الاشتراك في وضع القراءة والتصدير فقط؛ انتهت صلاحية التحرير أو تم تعليقها.','This subscription permits reading and exporting only; editing access expired or was suspended.'):cloudEnabled?txt(ar,'نسخة QA تجريبية: الحفظ المركزي يدوي في قاعدة V2 ومتاح لمالك المسودة فقط. لا توجد مشاركة أو اعتماد رسمي أو قيود محاسبية.','QA-only: cloud saving is manual in the V2 database and visible only to the draft owner. No sharing, formal approval or accounting entries.'):txt(ar,'نسخة أولية معزولة: تحفظ المسودات في متصفحك فقط، ولا تتزامن بين الأجهزة أو المستخدمين بعد. ليست دراسة معتمدة أو قيودًا محاسبية.','Isolated first iteration: drafts are browser-local, not synced between devices or users, and are not approved studies or accounting entries.')}</p>
  {notice&&<p className="fs-notice" role="status">{notice} <button type="button" onClick={()=>setNotice('')}>×</button></p>}
  {sharingEnabled&&<JoinInvitationPanel locale={locale}/>}
  <section className="fs-create card"><div><h2>{txt(ar,'محفظة المشاريع','Project portfolio')}</h2><p>{txt(ar,'أنشئ دراسة جديدة أو افتح مشروعًا محفوظًا.','Create a study or open a saved draft.')}</p></div><div className="fs-create-controls"><input value={projectName} onChange={e=>setProjectName(e.currentTarget.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();create();}}} placeholder={txt(ar,'اسم المشروع الجديد','New project name')} aria-label={txt(ar,'اسم المشروع الجديد','New project name')}/><select value={newSector} onChange={e=>setNewSector(e.currentTarget.value as Sector)} aria-label={txt(ar,'نوع المشروع','Project type')}>{Object.entries(sectors).map(([value,name])=><option key={value} value={value}>{ar?name.ar:name.en}</option>)}</select><Button onClick={create} disabled={readOnly||!projectName.trim()}>{txt(ar,'إضافة مشروع +','Add project +')}</Button></div></section>
  <div className="fs-portfolio">{studies.map(p=><button key={p.id} type="button" className={'fs-project-pill'+(p.id===selectedId?' fs-project-pill--active':'')} aria-pressed={p.id===selectedId} onClick={()=>{setSelectedId(p.id);setTab('overview')}}><strong>{p.title}</strong><span>{ar?projectStatus[p.status].ar:projectStatus[p.status].en}</span></button>)}</div>
  {!loaded?<p>{txt(ar,'جاري تحميل المسودات…','Loading drafts…')}</p>:!study?<section className="card fs-empty"><h2>{txt(ar,'ابدأ بأول مشروع','Start your first project')}</h2><p>{txt(ar,'ادخل اسم المشروع ونوعه. تبدأ الأرقام بصفر لتجنب عرض نتائج افتراضية على أنها دراسة حقيقية.','Enter a project name and sector. All figures start at zero to avoid implying a real feasibility result.')}</p></section>:<>
   <div className="fs-subhead"><div><h2>{study.title}</h2><small>{study.country}{study.region?' · '+study.region:''} · {study.currency} · {ar?projectStatus[study.status].ar:projectStatus[study.status].en}</small></div><Button secondary onClick={remove} disabled={effectiveReadOnly}>{txt(ar,'حذف المسودة','Delete draft')}</Button></div>
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
    <label className="fs-field"><span>{txt(ar,'عملة الدراسة الواحدة','Study currency')}</span><select value={study.currency} onChange={e=>update({currency:e.currentTarget.value})}><option>USD</option><option>SYP</option><option>SAR</option><option>EUR</option></select></label>
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
    {tab==='legal'&&<section className="card fs-panel"><h3>{txt(ar,'الفحص القانوني والتراخيص','Legal and licensing checklist')}</h3><p className="fs-hint">{txt(ar,'هذه قائمة فحص عامة وليست تصديقًا قانونيًا. يجب التحقق من القوانين والمتطلبات النافذة في سوريا لكل موقع ونشاط.','General checklist only, not legal certification. Local counsel must verify current Syrian requirements for each location and sector.')}</p>
    {study.legal.map(x=><div className="fs-item" key={x.id}><strong>{x.title}</strong><SelectField label={txt(ar,'الحالة','Status')} value={x.status} items={Object.entries(legalStatus).map(([value,name])=>({value:value as ChecklistStatus,label:ar?name.ar:name.en}))} onChange={status=>update({legal:study.legal.map(z=>z.id===x.id?{...z,status}:z)})}/><input value={x.notes} placeholder={txt(ar,'المستند / ملاحظات التحقق','Evidence / notes')} onChange={e=>update({legal:study.legal.map(z=>z.id===x.id?{...z,notes:e.currentTarget.value}:z)})}/></div>)}
    <Button secondary onClick={()=>update({legal:[...study.legal,{id:uid(),title:txt(ar,'متطلب جديد','New requirement'),status:'NOT_STARTED',notes:''}]})}>{txt(ar,'إضافة متطلب +','Add requirement +')}</Button>{study.sector==='INDUSTRIAL'&&<Button secondary onClick={()=>update({legal:[...study.legal,...waterFactoryLegalItems.filter(title=>!study.legal.some(l=>l.title===title)).map(title=>({id:uid(),title,status:'NOT_STARTED' as const,notes:''}))]})}>{txt(ar,'إضافة متطلبات مصنع مياه','Add water factory requirements')}</Button>}
   </section>}
   {tab==='tasks'&&<section className="card fs-panel"><h3>{txt(ar,'الجدول التنفيذي والمهام','Tasks and milestones')}</h3>{study.tasks.map(x=><div className="fs-item" key={x.id}><input aria-label={txt(ar,'عنوان المهمة','Task title')} value={x.title} onChange={e=>update({tasks:study.tasks.map(z=>z.id===x.id?{...z,title:e.currentTarget.value}:z)})}/><input aria-label={txt(ar,'المسؤول','Owner')} placeholder={txt(ar,'المسؤول','Owner')} value={x.owner} onChange={e=>update({tasks:study.tasks.map(z=>z.id===x.id?{...z,owner:e.currentTarget.value}:z)})}/><input aria-label={txt(ar,'الموعد','Due date')} type="date" value={x.due} onChange={e=>update({tasks:study.tasks.map(z=>z.id===x.id?{...z,due:e.currentTarget.value}:z)})}/><SelectField label={txt(ar,'الحالة','Status')} value={x.status} items={Object.entries(taskStatus).map(([value,name])=>({value:value as TaskStatus,label:ar?name.ar:name.en}))} onChange={status=>update({tasks:study.tasks.map(z=>z.id===x.id?{...z,status}:z)})}/><button type="button" aria-label={txt(ar,'حذف المهمة','Delete task')} onClick={()=>update({tasks:study.tasks.filter(z=>z.id!==x.id)})}>×</button></div>)}<Button secondary onClick={()=>update({tasks:[...study.tasks,{id:uid(),title:txt(ar,'مهمة جديدة','New task'),owner:'',due:'',status:'TODO',priority:'NORMAL'}]})}>{txt(ar,'إضافة مهمة +','Add task +')}</Button></section>}
   {tab==='risks'&&<section className="card fs-panel"><h3>{txt(ar,'سجل المخاطر','Risk register')}</h3>{study.risks.map(x=><div className="fs-item" key={x.id}><input value={x.title} aria-label={txt(ar,'الخطر','Risk')} onChange={e=>update({risks:study.risks.map(z=>z.id===x.id?{...z,title:e.currentTarget.value}:z)})}/><label>{txt(ar,'الاحتمال 1-5','Likelihood 1-5')}<input type="number" min="1" max="5" value={x.likelihood} onChange={e=>update({risks:study.risks.map(z=>z.id===x.id?{...z,likelihood:Math.max(1,Math.min(5,Number(e.currentTarget.value)||1))}:z)})}/></label><label>{txt(ar,'الأثر 1-5','Impact 1-5')}<input type="number" min="1" max="5" value={x.impact} onChange={e=>update({risks:study.risks.map(z=>z.id===x.id?{...z,impact:Math.max(1,Math.min(5,Number(e.currentTarget.value)||1))}:z)})}/></label><strong>{x.impact*x.likelihood}/25</strong><input placeholder={txt(ar,'إجراء المعالجة','Mitigation')} value={x.response} onChange={e=>update({risks:study.risks.map(z=>z.id===x.id?{...z,response:e.currentTarget.value}:z)})}/></div>)}<Button secondary onClick={()=>update({risks:[...study.risks,{id:uid(),title:txt(ar,'خطر جديد','New risk'),likelihood:3,impact:3,response:''}]})}>{txt(ar,'إضافة خطر +','Add risk +')}</Button></section>}
   {tab==='suppliers'&&<section className="card fs-panel"><h3>{txt(ar,'عروض الموردين والمقاولين','Supplier and contractor offers')}</h3>{study.suppliers.map(x=><div className="fs-item" key={x.id}><input aria-label={txt(ar,'المورد','Vendor')} placeholder={txt(ar,'اسم المورد','Vendor')} value={x.vendor} onChange={e=>update({suppliers:study.suppliers.map(z=>z.id===x.id?{...z,vendor:e.currentTarget.value}:z)})}/><input aria-label={txt(ar,'البند','Item')} placeholder={txt(ar,'المعدة أو الخدمة','Equipment / service')} value={x.item} onChange={e=>update({suppliers:study.suppliers.map(z=>z.id===x.id?{...z,item:e.currentTarget.value}:z)})}/><input aria-label={txt(ar,'القيمة','Quote')} type="number" min="0" value={x.offer} onChange={e=>update({suppliers:study.suppliers.map(z=>z.id===x.id?{...z,offer:Number(e.currentTarget.value)||0}:z)})}/><input aria-label={txt(ar,'ملاحظات','Notes')} placeholder={txt(ar,'الشروط والمدة','Terms / timeline')} value={x.notes} onChange={e=>update({suppliers:study.suppliers.map(z=>z.id===x.id?{...z,notes:e.currentTarget.value}:z)})}/></div>)}<Button secondary onClick={()=>update({suppliers:[...study.suppliers,{id:uid(),vendor:'',item:'',offer:0,notes:''}]})}>{txt(ar,'إضافة عرض +','Add offer +')}</Button></section>}
   {tab==='sharing'&&<CollaborationPanel locale={locale} projectId={study.id} enabled={sharingEnabled} canWrite={!effectiveReadOnly} isOwner={cloudOwnerIds[study.id]===userId}/>}
   {tab==='handoff'&&<ProjectHandoffPanel study={study} locale={locale} onChange={handoff=>update({handoff})} cloudRevision={cloudRevisions[study.id]} cloudCurrent={cloudSavedStudyVersions[study.id]===study.updatedAt} cloudEnabled={cloudEnabled} canWrite={!effectiveReadOnly}/>}
   {tab==='decisions'&&<section className="card fs-panel"><h3>{txt(ar,'سجل القرارات ومحاضر الاجتماعات','Decision and meeting log')}</h3>{study.decisions.map(x=><div className="fs-item" key={x.id}><input aria-label={txt(ar,'القرار','Decision')} value={x.title} onChange={e=>update({decisions:study.decisions.map(z=>z.id===x.id?{...z,title:e.currentTarget.value}:z)})}/><input aria-label={txt(ar,'التاريخ','Date')} type="date" value={x.date} onChange={e=>update({decisions:study.decisions.map(z=>z.id===x.id?{...z,date:e.currentTarget.value}:z)})}/><textarea aria-label={txt(ar,'التفاصيل','Details')} value={x.notes} onChange={e=>update({decisions:study.decisions.map(z=>z.id===x.id?{...z,notes:e.currentTarget.value}:z)})}/></div>)}<Button secondary onClick={()=>update({decisions:[...study.decisions,{id:uid(),title:txt(ar,'قرار جديد','New decision'),date:new Date().toISOString().slice(0,10),notes:''}]})}>{txt(ar,'إضافة قرار +','Add decision +')}</Button></section>}
   </fieldset>
  </>}
 </main>;
}
