'use client';

import {useEffect,useMemo,useState} from 'react';

type Organization={id:string;name:string};
type CostCenter={id:string;organization_id:string;code:string;display_code?:string|null;name:string;active:boolean};

export default function BudgetOrganizationManager({ar,value,onChange,onCostCentersChange}:{ar:boolean;value:string;onChange:(name:string)=>void;onCostCentersChange?:(centers:CostCenter[])=>void}){
 const [organizations,setOrganizations]=useState<Organization[]>([]);
 const [centers,setCenters]=useState<CostCenter[]>([]);
 const [selectedId,setSelectedId]=useState('');
 const [open,setOpen]=useState(false);
 const [newOrganization,setNewOrganization]=useState('');
 const [organizationDraft,setOrganizationDraft]=useState('');
 const [newCode,setNewCode]=useState('');
 const [newCenter,setNewCenter]=useState('');
 const [centerDrafts,setCenterDrafts]=useState<Record<string,string>>({});
 const [saving,setSaving]=useState(false);
 const [loading,setLoading]=useState(false);
 const [message,setMessage]=useState('');

 const loadOrganizations=async(showError=false)=>{
  setLoading(true);
  try{
   const response=await fetch('/api/organizations',{cache:'no-store'});
   if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||`LOAD_FAILED_${response.status}`)}
   const body=await response.json();
   if(Array.isArray(body))setOrganizations(body);
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
   setCenters(next);setCenterDrafts(Object.fromEntries(next.map((center:CostCenter)=>[center.id,center.name])));onCostCentersChange?.(next);
   return next;
  }catch(error){if(showError)setMessage(ar?`تعذر تحميل مراكز التكلفة. ${error instanceof Error?`(${error.message})`:''}`:(error instanceof Error?error.message:'Could not load cost centers.'));return []}
 };
 useEffect(()=>{loadOrganizations()},[]);
 useEffect(()=>{
  const selected=organizations.find(item=>item.name===value);
  if(selected&&selected.id!==selectedId){setSelectedId(selected.id);setOrganizationDraft(selected.name);loadCenters(selected.id)}
  if(!value&&selectedId){setSelectedId('');setOrganizationDraft('');setCenters([]);onCostCentersChange?.([])}
  if(value&&!selected){setSelectedId('');setOrganizationDraft('');setCenters([]);onCostCentersChange?.([])}
 },[organizations,value,selectedId]);
 const selectedOrganization=useMemo(()=>organizations.find(item=>item.id===selectedId),[organizations,selectedId]);

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
  if(selected){setSelectedId(selected.id);setOrganizationDraft(selected.name);if(!value)onChange(selected.name);await loadCenters(selected.id,true)}
  else if(!value){setSelectedId('');setOrganizationDraft('');setCenters([]);onCostCentersChange?.([])}
 };
 const createOrganization=async()=>{
 const name=newOrganization.trim();
  if(!name){setMessage(ar?'أدخل اسم المنشأة أولًا.':'Enter the organization name first.');return}
  if(organizations.some(item=>item.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase())){setMessage(ar?'اسم المنشأة موجود بالفعل. اختره من القائمة أو استخدم اسمًا مختلفًا.':'That organization already exists. Choose it from the list or use a different name.');return}
  setSaving(true);setMessage('');
  try{
   const response=await fetch('/api/organizations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||'CREATE_FAILED');
   setOrganizations(current=>[body,...current]);setSelectedId(body.id);setOrganizationDraft(body.name);setNewOrganization('');onChange(body.name);setCenters([]);onCostCentersChange?.([]);
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
   setOrganizations(current=>current.map(item=>item.id===selectedOrganization.id?{...item,name:body.name}:item));onChange(body.name);setMessage(ar?'تم تعديل اسم المنشأة.':'Organization name updated.');
  }catch(error){setMessage(ar?'تعذر تعديل اسم المنشأة.':(error instanceof Error?error.message:'Could not update organization.'))}
  finally{setSaving(false)}
 };
 const addCostCenter=async()=>{
  if(!selectedOrganization){setMessage(ar?'اختر منشأة قبل إضافة مركز تكلفة.':'Select an organization before adding a cost center.');return}
  const code=newCode.trim().toUpperCase(),name=newCenter.trim();
  if(!code||!name){setMessage(ar?'أدخل رمز واسم مركز التكلفة.':'Enter a cost-center code and name.');return}
  setSaving(true);setMessage('');
  try{
   const response=await fetch('/api/organizations/cost-centers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organization_id:selectedOrganization.id,code,name})});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||'CREATE_FAILED');
   const next=[...centers,body];setCenters(next);setCenterDrafts(current=>({...current,[body.id]:body.name}));onCostCentersChange?.(next);setNewCode('');setNewCenter('');setMessage(ar?'تمت إضافة مركز التكلفة وحفظه.':'Cost center added and saved.');
  }catch(error){setMessage(ar?'تعذر إضافة مركز التكلفة. قد يكون الرمز مستخدمًا.':(error instanceof Error?error.message:'Could not add cost center.'))}
  finally{setSaving(false)}
 };
 const renameCostCenter=async(center:CostCenter,name?:string)=>{
  const nextName=(name??centerDrafts[center.id]??center.name).trim();
  if(!nextName)return;
  setSaving(true);setMessage('');
  try{
   const response=await fetch('/api/organizations/cost-centers',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:center.id,name:nextName})});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error||'UPDATE_FAILED');
   const next=centers.map(item=>item.id===center.id?body:item);setCenters(next);setCenterDrafts(current=>({...current,[center.id]:body.name}));onCostCentersChange?.(next);setMessage(ar?'تم تعديل اسم مركز التكلفة وحفظه.':'Cost-center name updated and saved.');
  }catch(error){setMessage(ar?'تعذر تعديل اسم مركز التكلفة.':(error instanceof Error?error.message:'Could not update cost center.'))}
  finally{setSaving(false)}
 };

 const legacyOption=value&&!organizations.some(item=>item.name===value);
 return <>
  <div className="budget-organization-control">
   <select value={selectedId|| (legacyOption?'__legacy__':'')} onChange={event=>chooseOrganization(event.target.value)}>
   <option value="">{ar?'اختر منشأة':'Select organization'}</option>
    {legacyOption&&<option value="__legacy__">{value}</option>}
    {organizations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
   </select>
   <button type="button" className="budget-organization-add" onClick={openManager} aria-label={ar?'إضافة أو إدارة المنشآت':'Add or manage organizations'} title={ar?'إضافة أو إدارة المنشآت':'Add or manage organizations'}>＋</button>
  </div>
  {open&&<div className="budget-org-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false)}}>
   <section className="budget-org-modal" role="dialog" aria-modal="true" aria-labelledby="budget-org-modal-title" dir={ar?'rtl':'ltr'}>
    <div className="budget-org-modal-head"><div><small>{ar?'مرجع نطاق الموازنة':'Budget scope reference'}</small><h2 id="budget-org-modal-title">{ar?'المنشآت ومراكز التكلفة':'Organizations & cost centers'}</h2></div><div className="budget-org-modal-actions"><button type="button" className="btn secondary" onClick={()=>void openManager()} disabled={loading}>{ar?'إعادة تحميل':'Reload'}</button><button type="button" className="budget-org-close" onClick={()=>setOpen(false)} aria-label={ar?'إغلاق':'Close'}>×</button></div></div>
    <div className="budget-org-modal-body">
     <div className="budget-org-section"><h3>{ar?'إضافة منشأة':'Add organization'}</h3><div className="budget-org-add-row"><input value={newOrganization} onChange={event=>setNewOrganization(event.target.value)} placeholder={ar?'اسم المنشأة':'Organization name'}/><button type="button" className="btn" disabled={saving} onClick={createOrganization}>{ar?'إضافة':'Add'}</button></div></div>
     <div className="budget-org-section"><h3>{ar?'اختيار وتعديل المنشأة':'Select and rename organization'}</h3><select value={selectedId} onChange={event=>chooseOrganization(event.target.value)}><option value="">{ar?'اختر منشأة':'Select organization'}</option>{organizations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>{selectedOrganization&&<div className="budget-org-add-row"><input value={organizationDraft} onChange={event=>setOrganizationDraft(event.target.value)}/><button type="button" className="btn secondary" disabled={saving} onClick={renameOrganization}>{ar?'حفظ الاسم':'Save name'}</button></div>}</div>
     <div className="budget-org-section"><div className="budget-org-section-title"><h3>{ar?'مراكز التكلفة التابعة':'Organization cost centers'}</h3><small>{selectedOrganization?selectedOrganization.name:(ar?'اختر منشأة أولًا':'Select an organization first')}</small></div>{selectedOrganization&&<><div className="budget-org-add-row budget-org-center-add"><input value={newCode} onChange={event=>setNewCode(event.target.value)} placeholder={ar?'الرمز':'Code'}/><input value={newCenter} onChange={event=>setNewCenter(event.target.value)} placeholder={ar?'اسم مركز التكلفة':'Cost-center name'}/><button type="button" className="btn" disabled={saving} onClick={addCostCenter}>{ar?'إضافة وحفظ المركز':'Add & save center'}</button></div><div className="budget-org-center-list">{centers.length?centers.map(center=><div className="budget-org-center-row" key={center.id}><code>{center.display_code??center.code}</code><input value={centerDrafts[center.id]??center.name} onChange={event=>setCenterDrafts(current=>({...current,[center.id]:event.target.value}))}/><button type="button" className="btn secondary" disabled={saving} onClick={()=>renameCostCenter(center)}>{ar?'حفظ':'Save'}</button></div>):<p className="budget-org-empty">{ar?'لا توجد مراكز تكلفة مسجلة بعد.':'No cost centers registered yet.'}</p>}</div></>}</div>
     {message&&<div className="budget-org-message" role="status">{message}</div>}
    </div>
   </section>
  </div>}
 </>;
}
