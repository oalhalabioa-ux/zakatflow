'use client';

import {useEffect,useMemo,useState} from 'react';

export type BudgetOrganization={id:string;name:string;parent_organization_id?:string|null;organization_kind:'HOLDING'|'SUBSIDIARY';sort_order:number;created_at?:string};
type Organization=BudgetOrganization;
type CostCenterType='ADMIN'|'OPERATING'|'PROJECT_OPERATING'|'INVESTMENT'|'TREASURY'|'FINANCING';
type CostCenter={id:string;organization_id:string;code:string;display_code?:string|null;name:string;active:boolean;center_type:CostCenterType};
const COST_CENTER_TYPES:Array<{value:CostCenterType;ar:string;en:string}>= [
 {value:'ADMIN',ar:'إداري',en:'Administrative'},
 {value:'OPERATING',ar:'تشغيلي',en:'Operating'},
 {value:'PROJECT_OPERATING',ar:'مشاريع تشغيلية',en:'Operating Projects'},
 {value:'INVESTMENT',ar:'استثماري',en:'Investment'},
 {value:'TREASURY',ar:'خزينة ورأس المال العامل',en:'Treasury & Working Capital'},
 {value:'FINANCING',ar:'تمويلي',en:'Financing'}
];
const centerTypeLabel=(type:CostCenterType,ar:boolean)=>COST_CENTER_TYPES.find(item=>item.value===type)?.[ar?'ar':'en']??type;
const sortOrganizations=(items:Organization[])=>[...items].sort((a,b)=>Number(a.sort_order??100)-Number(b.sort_order??100)||(a.organization_kind==='HOLDING'?0:1)-(b.organization_kind==='HOLDING'?0:1)||a.name.localeCompare(b.name,'ar'));
const organizationOptionLabel=(item:Organization)=>item.organization_kind==='HOLDING'?'▣ '+item.name:'↳ '+item.name;

export default function BudgetOrganizationManager({ar,value,onChange,onCostCentersChange,onOrganizationsChange,disabled=false}:{ar:boolean;value:string;disabled?:boolean;onChange:(name:string,options?:{defaultSelection?:boolean})=>void;onCostCentersChange?:(centers:CostCenter[])=>void;onOrganizationsChange?:(organizations:BudgetOrganization[])=>void}){
 const [organizations,setOrganizations]=useState<Organization[]>([]);
 const [centers,setCenters]=useState<CostCenter[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [open,setOpen]=useState(false);
 const [newOrganization,setNewOrganization]=useState('');
 const [organizationDraft,setOrganizationDraft]=useState('');
 const [newCode,setNewCode]=useState('');
 const [newCenterType,setNewCenterType]=useState<CostCenterType|''>('');
 const [newCenter,setNewCenter]=useState('');
 const [centerDrafts,setCenterDrafts]=useState<Record<string,string>>({});
 const [centerTypeDrafts,setCenterTypeDrafts]=useState<Record<string,CostCenterType>>({});
 const [saving,setSaving]=useState(false);
 const [loading,setLoading]=useState(false);
 const [message,setMessage]=useState('');

 const loadOrganizations=async(showError=false)=>{
  setLoading(true);
  try{
   const response=await fetch('/api/organizations',{cache:'no-store'});
   if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||`LOAD_FAILED_${response.status}`)}
   const body=await response.json();
   if(Array.isArray(body)){const sorted=sortOrganizations(body);setOrganizations(sorted);onOrganizationsChange?.(sorted)}
   return Array.isArray(body)?body:[];
  }catch(error){if(showError)setMessage(ar?`تعذر تحميل المنشآت. أعد المحاولة. ${error instanceof Error?`(${error.message})`:''}`:(error instanceof Error?error.message:'Could not load organizations.'));return []}
  finally{setLoading(false)}
 };
 const loadCenters=async(organizationId:string,showError=false)=>{
  if(!organizationId){setCenters([]);onCostCentersChange?.([]);return}
  try{
   const response=await fetch(`/api/organizations/cost-centers?organization_id=${encodeURIComponent(organizationId)}`,{cache:'no-store'});
   if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||`LOAD_CENTERS_FAILED_${response.status}`)}
   const body=await response.json();
   const next=Array.isArray(body)?body:[];
   setCenters(next);setCenterDrafts(Object.fromEntries(next.map((center:CostCenter)=>[center.id,center.name])));setCenterTypeDrafts(Object.fromEntries(next.map((center:CostCenter)=>[center.id,center.center_type])));onCostCentersChange?.(next);
   return next;
  }catch(error){if(showError)setMessage(ar?`تعذر تحميل مراكز التكلفة. ${error instanceof Error?`(${error.message})`:''}`:(error instanceof Error?error.message:'Could not load cost centers.'));return []}
 };
 useEffect(()=>{void (async()=>{const loaded=await loadOrganizations();if(value)return;const holding=sortOrganizations(loaded as Organization[]).find(item=>item.organization_kind==='HOLDING'&&!item.parent_organization_id);if(!holding)return;setSelectedId(holding.id);setOrganizationDraft(holding.name);onChange(holding.name,{defaultSelection:true});await loadCenters(holding.id)})()},[]);
 useEffect(()=>{
  const selected=organizations.find(item=>item.name===value);
  if(selected&&selected.id!==selectedId){setSelectedId(selected.id);setOrganizationDraft(selected.name);loadCenters(selected.id)}
  if(!value&&selectedId){setSelectedId('');setOrganizationDraft('');setCenters([]);onCostCentersChange?.([])}
  if(value&&!selected){setSelectedId('');setOrganizationDraft('');setCenters([]);onCostCentersChange?.([])}
 },[organizations,value,selectedId]);
 const selectedOrganization=useMemo(()=>organizations.find(item=>item.id===selectedId),[organizations,selectedId]);
 const holdingOrganization=useMemo(()=>sortOrganizations(organizations).find(item=>item.organization_kind==='HOLDING'&&!item.parent_organization_id),[organizations]);

 const chooseOrganization=(id:string)=>{
  if(id==='__legacy__'){onChange(value);return}
  if(!id){
   setSelectedId('');setOrganizationDraft('');setCenters([]);onCostCentersChange?.([]);onChange('');
   return;
  }
  setSelectedId(id);
  const selected=organizations.find(item=>item.id===id);
  setOrganizationDraft(selected?.name??'');
  onChange(selected?.name??'');
  loadCenters(id,true);
 };
 const openManager=async()=>{
  setMessage('');
  setOpen(true);
  const fresh=await loadOrganizations(true);
  const selected=fresh.find((item:Organization)=>item.name===value);
  if(selected){setSelectedId(selected.id);setOrganizationDraft(selected.name);await loadCenters(selected.id,true)}
  else if(!value){setSelectedId('');setOrganizationDraft('');setCenters([]);onCostCentersChange?.([])}
 };
 const createOrganization=async()=>{
 const name=newOrganization.trim();
  const createAsHolding=organizations.length===0;
  if(!name){setMessage(ar?'أدخل اسم المنشأة أولًا.':'Enter the organization name first.');return}
  if(organizations.some(item=>item.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase())){setMessage(ar?'اسم المنشأة موجود بالفعل. اختره من القائمة أو استخدم اسمًا مختلفًا.':'That organization already exists. Choose it from the list or use a different name.');return}
  setSaving(true);setMessage('');
  try{
   const response=await fetch('/api/organizations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,parent_organization_id:createAsHolding?null:(holdingOrganization?.id??null),organization_kind:createAsHolding?'HOLDING':'SUBSIDIARY',sort_order:createAsHolding?10:Math.max(...organizations.map(item=>Number(item.sort_order??100)),10)+10})});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||'CREATE_FAILED');
   const updated=sortOrganizations([body,...organizations]);setOrganizations(updated);onOrganizationsChange?.(updated);setSelectedId(body.id);setOrganizationDraft(body.name);setNewOrganization('');onChange(body.name);setCenters([]);onCostCentersChange?.([]);
   setMessage(ar?'تمت إضافة المنشأة. يمكنك الآن إضافة مراكز التكلفة.':'Organization added. You can now add cost centers.');
  }catch(error){setMessage(ar?'تعذر إضافة المنشأة. قد يكون الاسم مستخدمًا.':(error instanceof Error?error.message:'Could not add organization.'))}
  finally{setSaving(false)}
 };
 const renameOrganization=async()=>{
  if(!selectedOrganization)return;
  const name=organizationDraft.trim();
  if(!name){setMessage(ar?'اسم المنشأة مطلوب.':'Organization name is required.');return}
  if(organizations.some(item=>item.id!==selectedOrganization.id&&item.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase())){setMessage(ar?'اسم المنشأة موجود بالفعل.':'That organization name already exists.');return}
  setSaving(true);setMessage('');
  try{
   const response=await fetch('/api/organizations',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:selectedOrganization.id,name})});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||'UPDATE_FAILED');
   const updated=organizations.map(item=>item.id===selectedOrganization.id?{...item,name:body.name}:item);setOrganizations(updated);onOrganizationsChange?.(updated);onChange(body.name);setMessage(ar?'تم تعديل اسم المنشأة.':'Organization name updated.');
  }catch(error){setMessage(ar?'تعذر تعديل اسم المنشأة.':(error instanceof Error?error.message:'Could not update organization.'))}
  finally{setSaving(false)}
 };
 const addCostCenter=async()=>{
  if(!selectedOrganization){setMessage(ar?'اختر منشأة قبل إضافة مركز تكلفة.':'Select an organization before adding a cost center.');return}
  const code=newCode.trim().toUpperCase(),name=newCenter.trim(),centerType=newCenterType;
  if(!code||!name||!centerType){setMessage(ar?'أدخل الرمز والاسم ونوع مركز التكلفة.':'Enter the code, name and cost-center type.');return}
  setSaving(true);setMessage('');
  try{
   const response=await fetch('/api/organizations/cost-centers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organization_id:selectedOrganization.id,code,name,center_type:centerType})});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||'CREATE_FAILED');
   const next=[...centers,body];setCenters(next);setCenterDrafts(current=>({...current,[body.id]:body.name}));setCenterTypeDrafts(current=>({...current,[body.id]:body.center_type}));onCostCentersChange?.(next);setNewCode('');setNewCenter('');setNewCenterType('');setMessage(ar?'تمت إضافة مركز التكلفة وحفظه.':'Cost center added and saved.');
  }catch(error){setMessage(ar?'تعذر إضافة مركز التكلفة. قد يكون الرمز مستخدمًا.':(error instanceof Error?error.message:'Could not add cost center.'))}
  finally{setSaving(false)}
 };
 const renameCostCenter=async(center:CostCenter,name?:string)=>{
  const nextName=(name??centerDrafts[center.id]??center.name).trim();
  const nextType=centerTypeDrafts[center.id]??center.center_type;
  if(!nextName||!nextType)return;
  setSaving(true);setMessage('');
  try{
   const response=await fetch('/api/organizations/cost-centers',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:center.id,name:nextName,center_type:nextType})});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||'UPDATE_FAILED');
   const next=centers.map(item=>item.id===center.id?body:item);setCenters(next);setCenterDrafts(current=>({...current,[center.id]:body.name}));setCenterTypeDrafts(current=>({...current,[center.id]:body.center_type}));onCostCentersChange?.(next);setMessage(ar?'تم تعديل اسم مركز التكلفة وحفظه.':'Cost-center name updated and saved.');
  }catch(error){setMessage(ar?'تعذر تعديل اسم مركز التكلفة.':(error instanceof Error?error.message:'Could not update cost center.'))}
  finally{setSaving(false)}
 };

 const legacyOption=value&&!organizations.some(item=>item.name===value);
 return <>
  <div className="budget-organization-control">
   <select value={selectedId|| (legacyOption?'__legacy__':'')} disabled={disabled} onChange={event=>chooseOrganization(event.target.value)}>
   <option value="">{ar?'اختر منشأة':'Select organization'}</option>
    {legacyOption&&<option value="__legacy__">{value}</option>}
    {sortOrganizations(organizations).map(item=><option key={item.id} value={item.id}>{organizationOptionLabel(item)}</option>)}
   </select>
   <button type="button" className="budget-organization-add" onClick={openManager} aria-label={ar?'إضافة أو إدارة المنشآت':'Add or manage organizations'} title={ar?'إضافة أو إدارة المنشآت':'Add or manage organizations'}>＋</button>
  </div>
  {open&&<div className="budget-org-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false)}}>
   <section className="budget-org-modal" role="dialog" aria-modal="true" aria-labelledby="budget-org-modal-title" dir={ar?'rtl':'ltr'}>
    <div className="budget-org-modal-head"><div><small>{ar?'مرجع نطاق الموازنة':'Budget scope reference'}</small><h2 id="budget-org-modal-title">{ar?'المنشآت ومراكز التكلفة':'Organizations & cost centers'}</h2></div><div className="budget-org-modal-actions"><button type="button" className="btn secondary" onClick={()=>void openManager()} disabled={loading}>{ar?'إعادة تحميل':'Reload'}</button><button type="button" className="budget-org-close" onClick={()=>setOpen(false)} aria-label={ar?'إغلاق':'Close'}>×</button></div></div>
    <div className="budget-org-modal-body">
     <div className="budget-org-section"><h3>{ar?'إضافة منشأة تابعة':'Add subsidiary organization'}</h3><small className="budget-org-hint">{ar?'ستُربط المنشأة الجديدة تلقائيًا بالمجموعة القابضة.':'New organizations are linked to the holding group automatically.'}</small><div className="budget-org-add-row"><input value={newOrganization} onChange={event=>setNewOrganization(event.target.value)} placeholder={ar?'اسم المنشأة':'Organization name'}/><button type="button" className="btn" disabled={saving} onClick={createOrganization}>{ar?'إضافة':'Add'}</button></div></div>
     <div className="budget-org-section"><h3>{ar?'اختيار وتعديل المنشأة':'Select and rename organization'}</h3><select value={selectedId} onChange={event=>chooseOrganization(event.target.value)}><option value="">{ar?'اختر منشأة':'Select organization'}</option>{sortOrganizations(organizations).map(item=><option key={item.id} value={item.id}>{organizationOptionLabel(item)}</option>)}</select>{selectedOrganization&&<div className="budget-org-add-row"><input value={organizationDraft} onChange={event=>setOrganizationDraft(event.target.value)}/><button type="button" className="btn secondary" disabled={saving} onClick={renameOrganization}>{ar?'حفظ الاسم':'Save name'}</button></div>}</div>
     <div className="budget-org-section"><div className="budget-org-section-title"><h3>{ar?'مراكز التكلفة التابعة':'Organization cost centers'}</h3><small>{selectedOrganization?selectedOrganization.name:(ar?'اختر منشأة أولًا':'Select an organization first')}</small></div>{selectedOrganization&&<><div className="budget-org-add-row budget-org-center-add"><input value={newCode} onChange={event=>setNewCode(event.target.value)} placeholder={ar?'الرمز':'Code'}/><input value={newCenter} onChange={event=>setNewCenter(event.target.value)} placeholder={ar?'اسم مركز التكلفة':'Cost-center name'}/><select value={newCenterType} onChange={event=>setNewCenterType(event.target.value as CostCenterType)} aria-label={ar?'نوع مركز التكلفة':'Cost-center type'}><option value="">{ar?'اختر نوع المركز':'Select center type'}</option>{COST_CENTER_TYPES.map(item=><option key={item.value} value={item.value}>{ar?item.ar:item.en}</option>)}</select><button type="button" className="btn" disabled={saving} onClick={addCostCenter}>{ar?'إضافة وحفظ المركز':'Add & save center'}</button></div><div className="budget-org-center-list">{centers.length?centers.map(center=><div className="budget-org-center-row" key={center.id}><code>{center.display_code??center.code}</code><input value={centerDrafts[center.id]??center.name} onChange={event=>setCenterDrafts(current=>({...current,[center.id]:event.target.value}))}/><select value={centerTypeDrafts[center.id]??center.center_type} onChange={event=>setCenterTypeDrafts(current=>({...current,[center.id]:event.target.value as CostCenterType}))} aria-label={ar?'نوع مركز التكلفة':'Cost-center type'}>{COST_CENTER_TYPES.map(item=><option key={item.value} value={item.value}>{ar?item.ar:item.en}</option>)}</select><span className="budget-org-type-hint">{centerTypeLabel(centerTypeDrafts[center.id]??center.center_type,ar)}</span><button type="button" className="btn secondary" disabled={saving} onClick={()=>renameCostCenter(center)}>{ar?'حفظ':'Save'}</button></div>):<p className="budget-org-empty">{ar?'لا توجد مراكز تكلفة مسجلة بعد.':'No cost centers registered yet.'}</p>}</div></>}</div>
     {message&&<div className="budget-org-message" role="status">{message}</div>}
    </div>
   </section>
  </div>}
 </>;
}
