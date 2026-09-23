'use client';

import {use, useCallback, useEffect, useMemo, useState} from 'react';
import {organizationDisplayName} from '@/lib/organization-display';
import './organizations.css';

type Organization={id:string;name:string;legal_name?:string|null;entity_type:string;base_currency:string;status?:string;parent_organization_id?:string|null;organization_kind:'HOLDING'|'SUBSIDIARY';sort_order?:number;created_at?:string};
type LegalEntity={id:string;organization_id:string;name:string;entity_type:string;base_currency:string;registration_no?:string|null;active?:boolean};
type EntityType='COMPANY'|'FAMILY'|'PERSON'|'TRUST'|'OTHER';
type OrganizationForm={name:string;legal_name:string;entity_type:EntityType;base_currency:string;parent_organization_id:string};
type EntityForm={id?:string;name:string;entity_type:EntityType;base_currency:string;registration_no:string};

const emptyOrganizationForm:OrganizationForm={name:'',legal_name:'',entity_type:'COMPANY',base_currency:'SAR',parent_organization_id:''};
const emptyEntityForm:EntityForm={name:'',entity_type:'COMPANY',base_currency:'SAR',registration_no:''};
const entityTypes:Array<{value:EntityType;ar:string;en:string}>=[
 {value:'COMPANY',ar:'شركة',en:'Company'},
 {value:'FAMILY',ar:'مكتب عائلي',en:'Family Office'},
 {value:'PERSON',ar:'فرد',en:'Individual'},
 {value:'TRUST',ar:'وقف / ائتمان',en:'Trust'},
 {value:'OTHER',ar:'مؤسسة / جهة أخرى',en:'Institution / Other'}
];
const typeLabel=(type:string,ar:boolean)=>entityTypes.find(item=>item.value===type)?.[ar?'ar':'en']??type;
const messageFor=(error:string,ar:boolean)=>{
 const messages:Record<string,[string,string]>={
  ORGANIZATION_NAME_REQUIRED:['أدخل اسم الجهة.','Enter an organization name.'],
  ENTITY_NAME_REQUIRED:['أدخل اسم الكيان.','Enter an entity name.'],
  PARENT_ORGANIZATION_NOT_FOUND:['الجهة الأم غير موجودة أو لا تملك صلاحية الوصول إليها.','The parent organization was not found or is not accessible.'],
  ORGANIZATION_PARENT_SELF_REFERENCE:['لا يمكن اختيار الجهة نفسها كجهة أم.','An organization cannot be its own parent.'],
  UNAUTHORIZED:['انتهت الجلسة أو لا تملك صلاحية تنفيذ هذا الإجراء.','Your session expired or you are not authorized to perform this action.']
 };
 return messages[error]?.[ar?0:1]??(ar?'تعذر إكمال الطلب. تحقق من البيانات ثم حاول مرة أخرى.':'Could not complete the request. Check the details and try again.');
};

export default function Organizations({params}:{params:Promise<{locale:string}>}){
 const {locale}=use(params),ar=locale==='ar';
 const [organizations,setOrganizations]=useState<Organization[]>([]),[selectedId,setSelectedId]=useState(''),[entities,setEntities]=useState<LegalEntity[]>([]);
 const [search,setSearch]=useState(''),[typeFilter,setTypeFilter]=useState('ALL'),[loading,setLoading]=useState(true),[loadingEntities,setLoadingEntities]=useState(false),[saving,setSaving]=useState(false);
 const [notice,setNotice]=useState(''),[noticeIsError,setNoticeIsError]=useState(false);
 const [organizationModal,setOrganizationModal]=useState(false),[organizationForm,setOrganizationForm]=useState<OrganizationForm>(emptyOrganizationForm),[editingOrganization,setEditingOrganization]=useState<Organization|null>(null);
 const [entityModal,setEntityModal]=useState(false),[entityForm,setEntityForm]=useState<EntityForm>(emptyEntityForm);

 const selected=organizations.find(item=>item.id===selectedId)??null;
 const filteredOrganizations=useMemo(()=>organizations.filter(item=>{
  const query=search.trim().toLocaleLowerCase();
  const matchesSearch=!query||[item.name,item.legal_name??'',organizationDisplayName(item.name,ar)].some(value=>value.toLocaleLowerCase().includes(query));
  return matchesSearch&&(typeFilter==='ALL'||item.entity_type===typeFilter);
 }),[organizations,search,typeFilter]);
 const childrenCount=selected?organizations.filter(item=>item.parent_organization_id===selected.id).length:0;

 const loadOrganizations=useCallback(async(preferredId?:string)=>{
  setLoading(true);
  try{
   const response=await fetch('/api/organizations',{cache:'no-store'});
   if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'LOAD_FAILED');
   const rows=await response.json() as Organization[];
   setOrganizations(rows);
   setSelectedId(current=>preferredId&&rows.some(item=>item.id===preferredId)?preferredId:rows.some(item=>item.id===current)?current:(rows[0]?.id??''));
  }catch(error){setNotice(messageFor(error instanceof Error?error.message:'',ar));setNoticeIsError(true)}
  finally{setLoading(false)}
 },[ar]);
 const loadEntities=useCallback(async(organizationId:string)=>{
  if(!organizationId){setEntities([]);return}
  setLoadingEntities(true);
  try{
   const response=await fetch(`/api/organizations/entities?organization_id=${encodeURIComponent(organizationId)}`,{cache:'no-store'});
   if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'LOAD_FAILED');
   setEntities(await response.json());
  }catch(error){setNotice(messageFor(error instanceof Error?error.message:'',ar));setNoticeIsError(true);setEntities([])}
  finally{setLoadingEntities(false)}
 },[ar]);
 useEffect(()=>{void loadOrganizations()},[loadOrganizations]);
 useEffect(()=>{void loadEntities(selectedId)},[loadEntities,selectedId]);

 const openCreateOrganization=()=>{setEditingOrganization(null);setOrganizationForm(emptyOrganizationForm);setOrganizationModal(true)};
 const openEditOrganization=()=>{
  if(!selected)return;
  setEditingOrganization(selected);
  setOrganizationForm({name:selected.name,legal_name:selected.legal_name??'',entity_type:(entityTypes.some(item=>item.value===selected.entity_type)?selected.entity_type:'OTHER') as EntityType,base_currency:selected.base_currency||'SAR',parent_organization_id:''});
  setOrganizationModal(true);
 };
 const saveOrganization=async(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();setSaving(true);setNotice('');
  const payload={name:organizationForm.name.trim(),legal_name:organizationForm.legal_name.trim()||null,entity_type:organizationForm.entity_type,base_currency:organizationForm.base_currency,...(!editingOrganization?{parent_organization_id:organizationForm.parent_organization_id||null,organization_kind:organizationForm.parent_organization_id?'SUBSIDIARY':'HOLDING',sort_order:Math.max(0,...organizations.map(item=>Number(item.sort_order)||0))+10}:{})};
  try{
   const response=await fetch('/api/organizations',{method:editingOrganization?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(editingOrganization?{id:editingOrganization.id,...payload}:payload)});
   const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'SAVE_FAILED');
   setOrganizationModal(false);setNotice(editingOrganization?(ar?'تم تحديث بيانات الجهة.':'Organization details updated.'):(ar?'تمت إضافة الجهة.':'Organization added.'));setNoticeIsError(false);await loadOrganizations(body.id??editingOrganization?.id);
  }catch(error){setNotice(messageFor(error instanceof Error?error.message:'',ar));setNoticeIsError(true)}
  finally{setSaving(false)}
 };
 const openCreateEntity=()=>{setEntityForm(emptyEntityForm);setEntityModal(true)};
 const openEditEntity=(item:LegalEntity)=>{setEntityForm({id:item.id,name:item.name,entity_type:(entityTypes.some(type=>type.value===item.entity_type)?item.entity_type:'OTHER') as EntityType,base_currency:item.base_currency||'SAR',registration_no:item.registration_no??''});setEntityModal(true)};
 const saveEntity=async(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();if(!selected)return;setSaving(true);setNotice('');
  const payload={name:entityForm.name.trim(),entity_type:entityForm.entity_type,base_currency:entityForm.base_currency,registration_no:entityForm.registration_no.trim()||null};
  try{
   const response=await fetch('/api/organizations/entities',{method:entityForm.id?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify(entityForm.id?{id:entityForm.id,...payload}:{organization_id:selected.id,...payload})});
   const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'SAVE_FAILED');
   setEntityModal(false);setNotice(entityForm.id?(ar?'تم تحديث بيانات الكيان.':'Entity details updated.'):(ar?'تمت إضافة الكيان.':'Entity added.'));setNoticeIsError(false);await loadEntities(selected.id);
  }catch(error){setNotice(messageFor(error instanceof Error?error.message:'',ar));setNoticeIsError(true)}
  finally{setSaving(false)}
 };

 const totalEntities=entities.length;
 return <main className="container organizations-page" dir={ar?'rtl':'ltr'}>
  <header className="orgs-hero">
   <div className="orgs-title-block"><span className="orgs-eyebrow">{ar?'إدارة الهيكل المؤسسي':'ORGANIZATION MANAGEMENT'}</span><h1>{ar?'الجهات والمؤسسات':'Organizations & entities'}</h1><p>{ar?'نظّم الشركات والمؤسسات والأفراد والكيانات التابعة في مساحة واحدة واضحة.':'Organize companies, institutions, individuals and their entities in one clear workspace.'}</p></div>
   <button className="orgs-primary-btn" type="button" onClick={openCreateOrganization}><span aria-hidden="true">＋</span>{ar?'إضافة جهة':'Add organization'}</button>
  </header>

  <section className="orgs-summary" aria-label={ar?'ملخص الجهات':'Organization summary'}>
   <article className="orgs-summary-card"><span className="orgs-summary-icon">◫</span><div><small>{ar?'إجمالي الجهات':'Total organizations'}</small><strong>{organizations.length}</strong></div></article>
   <article className="orgs-summary-card"><span className="orgs-summary-icon company">▦</span><div><small>{ar?'الشركات':'Companies'}</small><strong>{organizations.filter(item=>item.entity_type==='COMPANY').length}</strong></div></article>
   <article className="orgs-summary-card"><span className="orgs-summary-icon people">♙</span><div><small>{ar?'الأفراد والعائلات':'Individuals & families'}</small><strong>{organizations.filter(item=>item.entity_type==='PERSON'||item.entity_type==='FAMILY').length}</strong></div></article>
   <article className="orgs-summary-card"><span className="orgs-summary-icon linked">⌘</span><div><small>{ar?'الكيانات لدى الجهة المحددة':'Entities in selected organization'}</small><strong>{totalEntities}</strong></div></article>
  </section>

  {notice&&<div className={`orgs-notice ${noticeIsError?'error':'success'}`} role="status">{notice}<button type="button" onClick={()=>setNotice('')} aria-label={ar?'إغلاق':'Dismiss'}>×</button></div>}

  <section className="orgs-workspace">
   <aside className="orgs-directory card">
    <div className="orgs-directory-head"><div><span>{ar?'دليل الجهات':'DIRECTORY'}</span><h2>{ar?'الجهات المسجلة':'Registered organizations'}</h2></div><button type="button" className="orgs-icon-btn" onClick={()=>void loadOrganizations(selectedId)} aria-label={ar?'تحديث القائمة':'Refresh list'} title={ar?'تحديث القائمة':'Refresh list'}>↻</button></div>
    <label className="orgs-search"><span aria-hidden="true">⌕</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder={ar?'ابحث بالاسم أو الاسم القانوني':'Search by name or legal name'}/></label>
    <label className="orgs-filter"><span>{ar?'نوع الجهة':'Organization type'}</span><select value={typeFilter} onChange={event=>setTypeFilter(event.target.value)}><option value="ALL">{ar?'كل الأنواع':'All types'}</option>{entityTypes.map(type=><option key={type.value} value={type.value}>{ar?type.ar:type.en}</option>)}</select></label>
    <div className="orgs-list" aria-live="polite">
     {loading?<div className="orgs-empty"><span className="orgs-loader"/>{ar?'جارٍ تحميل الجهات…':'Loading organizations…'}</div>:filteredOrganizations.length?filteredOrganizations.map(item=><button type="button" key={item.id} className={`orgs-list-item ${selectedId===item.id?'selected':''}`} onClick={()=>setSelectedId(item.id)} aria-pressed={selectedId===item.id}>
      <span className={`orgs-avatar ${item.entity_type.toLowerCase()}`}>{item.entity_type==='PERSON'?'♙':item.entity_type==='FAMILY'?'⌂':item.entity_type==='TRUST'?'◇':'▦'}</span><span className="orgs-list-copy"><strong>{organizationDisplayName(item.name,ar)}</strong><small>{typeLabel(item.entity_type,ar)}{item.organization_kind==='HOLDING'?(ar?' · شركة أم':' · Holding company'):(ar?' · تابعة':' · Subsidiary')}</small></span><span className="orgs-list-arrow" aria-hidden="true">{ar?'‹':'›'}</span>
     </button>):<div className="orgs-empty"><span>⌕</span><strong>{ar?'لا توجد نتائج':'No matching organizations'}</strong><small>{ar?'غيّر البحث أو أضف جهة جديدة.':'Change the search or add a new organization.'}</small></div>}
    </div>
    <div className="orgs-directory-foot"><span className="orgs-status-dot"/>{organizations.length} {ar?'جهة في حسابك':'organizations in your account'}</div>
   </aside>

   <section className="orgs-details card">
    {selected?<>
     <div className="orgs-details-head"><div className="orgs-profile"><span className={`orgs-avatar large ${selected.entity_type.toLowerCase()}`}>{selected.entity_type==='PERSON'?'♙':selected.entity_type==='FAMILY'?'⌂':selected.entity_type==='TRUST'?'◇':'▦'}</span><div><span className="orgs-section-kicker">{ar?'ملف الجهة':'ORGANIZATION PROFILE'}</span><h2>{organizationDisplayName(selected.name,ar)}</h2><div className="orgs-badges"><span className="orgs-type-badge">{typeLabel(selected.entity_type,ar)}</span><span className="orgs-state-badge"><i/>{selected.status==='INACTIVE'?(ar?'غير نشطة':'Inactive'):(ar?'نشطة':'Active')}</span></div></div></div><button type="button" className="orgs-secondary-btn" onClick={openEditOrganization}>✎ <span>{ar?'تعديل البيانات':'Edit details'}</span></button></div>
     <div className="orgs-meta-grid">
      <div><small>{ar?'الاسم القانوني':'Legal name'}</small><strong>{selected.legal_name?organizationDisplayName(selected.legal_name,ar):'—'}</strong></div>
      <div><small>{ar?'العملة الأساسية':'Base currency'}</small><strong>{selected.base_currency||'SAR'}</strong></div>
      <div><small>{ar?'نوع العلاقة':'Relationship'}</small><strong>{selected.organization_kind==='HOLDING'?(ar?'جهة أم':'Holding organization'):(ar?'جهة تابعة':'Subsidiary')}</strong></div>
      <div><small>{ar?'الجهات التابعة':'Subsidiaries'}</small><strong>{childrenCount}</strong></div>
     </div>
     <div className="orgs-section-head"><div><span className="orgs-section-kicker">{ar?'الكيانات المسجلة تحت هذه الجهة':'LEGAL ENTITIES UNDER THIS ORGANIZATION'}</span><h3>{ar?'الشركات والأفراد والكيانات':'Companies, individuals & entities'} <span>{entities.length}</span></h3><p>{ar?'أضف الكيانات القانونية التي تديرها هذه الجهة، مع نوعها ورقم تسجيلها إن وجد.':'Add legal entities managed by this organization, with their type and registration number when available.'}</p></div><button type="button" className="orgs-secondary-btn" onClick={openCreateEntity}>＋ <span>{ar?'إضافة كيان':'Add entity'}</span></button></div>
     <div className="orgs-entities-table-wrap"><table className="orgs-entities-table"><thead><tr><th>{ar?'اسم الكيان':'Entity name'}</th><th>{ar?'النوع':'Type'}</th><th>{ar?'رقم التسجيل':'Registration no.'}</th><th>{ar?'العملة':'Currency'}</th><th><span className="sr-only">{ar?'الإجراءات':'Actions'}</span></th></tr></thead><tbody>
      {loadingEntities?<tr><td className="orgs-table-empty" colSpan={5}>{ar?'جارٍ تحميل الكيانات…':'Loading entities…'}</td></tr>:entities.length?entities.map(item=><tr key={item.id}><td><span className="orgs-entity-name"><i>{item.entity_type==='PERSON'?'♙':item.entity_type==='FAMILY'?'⌂':'▦'}</i><strong>{organizationDisplayName(item.name,ar)}</strong></span></td><td><span className="orgs-type-badge">{typeLabel(item.entity_type,ar)}</span></td><td>{item.registration_no||'—'}</td><td>{item.base_currency||'SAR'}</td><td><button type="button" className="orgs-row-action" onClick={()=>openEditEntity(item)}>{ar?'تعديل':'Edit'}</button></td></tr>):<tr><td className="orgs-table-empty" colSpan={5}><span>◇</span><strong>{ar?'لا توجد كيانات مضافة بعد':'No entities added yet'}</strong><small>{ar?'أضف شركة أو فردًا أو كيانًا تديره هذه الجهة.':'Add a company, individual or entity managed by this organization.'}</small></td></tr>}
     </tbody></table></div>
    </>:<div className="orgs-no-selection"><span>◫</span><h2>{ar?'ابدأ بإضافة جهة':'Start by adding an organization'}</h2><p>{ar?'أنشئ شركة أو مؤسسة أو ملفًا لشخص أو عائلة، ثم أضف الكيانات التي تديرها.':'Create a company, institution or profile for a person or family, then add the entities it manages.'}</p><button type="button" className="orgs-primary-btn" onClick={openCreateOrganization}>{ar?'إضافة أول جهة':'Add your first organization'}</button></div>}
   </section>
  </section>

  {organizationModal&&<div className="orgs-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setOrganizationModal(false)}}><section className="orgs-modal" role="dialog" aria-modal="true" aria-labelledby="orgs-modal-title"><form onSubmit={saveOrganization}><div className="orgs-modal-head"><div><span>{ar?'إدارة سجل الجهة':'ORGANIZATION RECORD'}</span><h2 id="orgs-modal-title">{editingOrganization?(ar?'تعديل بيانات الجهة':'Edit organization'):(ar?'إضافة جهة جديدة':'Add organization')}</h2></div><button type="button" onClick={()=>setOrganizationModal(false)} aria-label={ar?'إغلاق':'Close'}>×</button></div><div className="orgs-form-grid">
    <label className="wide"><span>{ar?'الاسم المعروض':'Display name'} <b>*</b></span><input required autoFocus value={organizationForm.name} onChange={event=>setOrganizationForm({...organizationForm,name:event.target.value})} placeholder={ar?'مثال: شركة ليفانت القابضة':'e.g. Levant Holding Company'}/></label>
    <label className="wide"><span>{ar?'الاسم القانوني':'Legal name'} <small>{ar?'اختياري':'Optional'}</small></span><input value={organizationForm.legal_name} onChange={event=>setOrganizationForm({...organizationForm,legal_name:event.target.value})} placeholder={ar?'كما يظهر في الوثائق الرسمية':'As shown on legal documents'}/></label>
    <label><span>{ar?'تصنيف الجهة':'Organization type'}</span><select value={organizationForm.entity_type} onChange={event=>setOrganizationForm({...organizationForm,entity_type:event.target.value as EntityType})}>{entityTypes.map(type=><option value={type.value} key={type.value}>{ar?type.ar:type.en}</option>)}</select></label>
    <label><span>{ar?'العملة الأساسية':'Base currency'}</span><select value={organizationForm.base_currency} onChange={event=>setOrganizationForm({...organizationForm,base_currency:event.target.value})}><option value="SAR">SAR — {ar?'ريال سعودي':'Saudi Riyal'}</option><option value="USD">USD — {ar?'دولار أمريكي':'US Dollar'}</option><option value="EUR">EUR — {ar?'يورو':'Euro'}</option></select></label>
    {!editingOrganization&&<label className="wide"><span>{ar?'الجهة الأم':'Parent organization'} <small>{ar?'اختياري':'Optional'}</small></span><select value={organizationForm.parent_organization_id} onChange={event=>setOrganizationForm({...organizationForm,parent_organization_id:event.target.value})}><option value="">{ar?'لا توجد — إنشاء جهة أم':'None — create as a holding organization'}</option>{organizations.filter(item=>item.organization_kind==='HOLDING').map(item=><option value={item.id} key={item.id}>{organizationDisplayName(item.name,ar)}</option>)}</select><small className="orgs-field-help">{ar?'اختيار جهة أم يربط هذه الجهة بها كجهة تابعة.':'Selecting a parent links this organization as a subsidiary.'}</small></label>}
   </div><div className="orgs-modal-actions"><button type="button" className="orgs-secondary-btn" onClick={()=>setOrganizationModal(false)}>{ar?'إلغاء':'Cancel'}</button><button type="submit" className="orgs-primary-btn" disabled={saving}>{saving?(ar?'جارٍ الحفظ…':'Saving…'):(editingOrganization?(ar?'حفظ التغييرات':'Save changes'):(ar?'إنشاء الجهة':'Create organization'))}</button></div></form></section></div>}

  {entityModal&&selected&&<div className="orgs-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setEntityModal(false)}}><section className="orgs-modal" role="dialog" aria-modal="true" aria-labelledby="entity-modal-title"><form onSubmit={saveEntity}><div className="orgs-modal-head"><div><span>{ar?'كيان تابع لـ':'ENTITY UNDER'} {selected.name}</span><h2 id="entity-modal-title">{entityForm.id?(ar?'تعديل الكيان':'Edit entity'):(ar?'إضافة كيان':'Add entity')}</h2></div><button type="button" onClick={()=>setEntityModal(false)} aria-label={ar?'إغلاق':'Close'}>×</button></div><div className="orgs-form-grid">
    <label className="wide"><span>{ar?'اسم الكيان':'Entity name'} <b>*</b></span><input required autoFocus value={entityForm.name} onChange={event=>setEntityForm({...entityForm,name:event.target.value})} placeholder={ar?'اسم الشركة أو الفرد':'Company or individual name'}/></label>
    <label><span>{ar?'نوع الكيان':'Entity type'}</span><select value={entityForm.entity_type} onChange={event=>setEntityForm({...entityForm,entity_type:event.target.value as EntityType})}>{entityTypes.map(type=><option value={type.value} key={type.value}>{ar?type.ar:type.en}</option>)}</select></label>
    <label><span>{ar?'العملة الأساسية':'Base currency'}</span><select value={entityForm.base_currency} onChange={event=>setEntityForm({...entityForm,base_currency:event.target.value})}><option value="SAR">SAR</option><option value="USD">USD</option><option value="EUR">EUR</option></select></label>
    <label className="wide"><span>{ar?'رقم التسجيل':'Registration number'} <small>{ar?'اختياري':'Optional'}</small></span><input value={entityForm.registration_no} onChange={event=>setEntityForm({...entityForm,registration_no:event.target.value})} placeholder={ar?'رقم السجل التجاري أو الهوية':'Commercial registration or ID number'}/></label>
   </div><div className="orgs-modal-actions"><button type="button" className="orgs-secondary-btn" onClick={()=>setEntityModal(false)}>{ar?'إلغاء':'Cancel'}</button><button type="submit" className="orgs-primary-btn" disabled={saving}>{saving?(ar?'جارٍ الحفظ…':'Saving…'):(entityForm.id?(ar?'حفظ التغييرات':'Save changes'):(ar?'إضافة الكيان':'Add entity'))}</button></div></form></section></div>}
 </main>;
}
