'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useSettingsOrganization} from './useSettingsOrganization';
import OrganizationSubnav from './OrganizationSubnav';
import SettingsIcon from './SettingsIcon';
import TopbarOrganizationControls from '../TopbarOrganizationControls';
import WorkspaceOrganizationPicker from '../WorkspaceOrganizationPicker';
type Entity={id:string;name:string;entity_type:string;base_currency:string;registration_no?:string|null;active?:boolean};
const types=[['COMPANY','شركة','Company'],['FAMILY','مكتب عائلي','Family office'],['PERSON','فرد','Individual'],['TRUST','وقف / ائتمان','Trust'],['OTHER','جهة أخرى','Other']] as const;
const empty={id:'',name:'',entity_type:'COMPANY',base_currency:'SAR',registration_no:''};
export default function OrganizationStructureWorkspace({locale,preferredOrg='',inline=false}:{locale:string;preferredOrg?:string;inline?:boolean}){
 const ar=locale==='ar',ctx=useSettingsOrganization(preferredOrg,inline),version=useRef(0);
 const [entities,setEntities]=useState<Entity[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
 const [draft,setDraft]=useState<typeof empty|null>(null);
 useEffect(()=>{
  const controller=new AbortController();version.current++;setEntities([]);setDraft(null);setError('');setLoading(true);
  if(!ctx.organizationId){setLoading(false);return()=>controller.abort();}
  fetch('/api/organizations/entities?organization_id='+encodeURIComponent(ctx.organizationId),{cache:'no-store',signal:controller.signal})
   .then(async r=>{if(!r.ok)throw Error();return r.json();}).then(rows=>{if(!controller.signal.aborted&&Array.isArray(rows))setEntities(rows);})
   .catch(()=>{if(!controller.signal.aborted)setError(ar?'تعذر تحميل الكيانات.':'Unable to load entities.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>{controller.abort();version.current++;};
 },[ctx.organizationId,revision,ar]);
 useEffect(()=>{setNotice('');},[ctx.organizationId]);
 async function save(event:FormEvent){
  event.preventDefault();if(!draft||busy||!ctx.organizationId)return;
  const generation=version.current,target=ctx.organizationId;setBusy(true);setError('');setNotice('');
  try{
   const payload={name:draft.name.trim(),entity_type:draft.entity_type,base_currency:draft.base_currency,registration_no:draft.registration_no.trim()||null};
   const r=await fetch('/api/organizations/entities',{method:draft.id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft.id?{...payload,id:draft.id}:{...payload,organization_id:target})});
   if(!r.ok)throw Error();
   if(generation===version.current){setDraft(null);setRevision(n=>n+1);setNotice(ar?'تم حفظ الكيان.':'Entity saved.');}
  }catch{if(generation===version.current)setError(ar?'تعذر الحفظ. تحقق من البيانات وصلاحياتك.':'Unable to save. Check the details and your permissions.');}finally{setBusy(false);}
 }
 if(ctx.loading&&!ctx.organization)return <p role="status">{ar?'جارٍ التحميل…':'Loading…'}</p>;
 if(ctx.error||!ctx.organization)return <p role="alert">{ar?'المؤسسة غير متاحة لحسابك.':'Organization unavailable.'}</p>;
 const org=ctx.organization,children=ctx.organizations.filter(o=>o.parent_organization_id===org.id),parent=ctx.organizations.find(o=>o.id===org.parent_organization_id);
 return <section className="settings-structure-workspace" data-structure-workspace>
  {!inline&&<><TopbarOrganizationControls><WorkspaceOrganizationPicker ar={ar} label={ar?'المؤسسة':'Organization'} organizations={ctx.organizations} value={org.id} disabled={busy} onChange={ctx.setOrganizationId}/></TopbarOrganizationControls><OrganizationSubnav locale={locale} organization={org.id} active="structure"/></>}
  <div className="settings-structure-layout"><section className="settings-card settings-structure-tree"><h3><SettingsIcon name="structure"/>{ar?'الهيكل التنظيمي':'Organization structure'}</h3>
   {parent&&<div className="settings-tree-node"><small>{ar?'المؤسسة الأم':'Parent organization'}</small><strong>{parent.name}</strong></div>}
   <div className="settings-tree-node current"><SettingsIcon name="organization"/><strong>{org.name}</strong><span className="settings-state complete">{ar?'المؤسسة المختارة':'Selected organization'}</span></div>
   {children.length?<div className="settings-tree-children">{children.map(o=><div key={o.id} className="settings-tree-node"><strong>{o.name}</strong><small>{ar?'مؤسسة تابعة':'Subsidiary'}</small></div>)}</div>:<p className="settings-hint">{ar?'لا توجد مؤسسات تابعة مسجلة.':'No registered subsidiaries.'}</p>}
  </section><section className="settings-card settings-structure-entities"><header className="settings-panel-heading"><div><h3><SettingsIcon name="organization"/>{ar?'الكيانات التابعة للمؤسسة':'Organization entities'}</h3><p>{ar?'الكيانات القانونية المسجلة تحت المؤسسة المختارة.':'Legal entities registered under the selected organization.'}</p></div><button type="button" className="settings-compact-action" disabled={busy||loading} onClick={()=>setDraft({...empty,base_currency:org.base_currency})}><span aria-hidden="true">＋</span>{ar?'إضافة كيان':'Add entity'}</button></header>
   {loading?<p role="status">{ar?'جارٍ تحميل الكيانات…':'Loading entities…'}</p>:<div className="settings-table-scroll"><table className="settings-data-table"><thead><tr><th>{ar?'الكيان':'Entity'}</th><th>{ar?'النوع':'Type'}</th><th>{ar?'رقم التسجيل':'Registration'}</th><th>{ar?'العملة':'Currency'}</th><th>{ar?'الإجراء':'Action'}</th></tr></thead><tbody>{entities.map(e=><tr key={e.id}><td>{e.name}</td><td>{types.find(t=>t[0]===e.entity_type)?.[ar?1:2]??e.entity_type}</td><td><bdi>{e.registration_no||'—'}</bdi></td><td>{e.base_currency}</td><td><button type="button" className="settings-text-action" disabled={busy} onClick={()=>setDraft({id:e.id,name:e.name,entity_type:e.entity_type,base_currency:e.base_currency,registration_no:e.registration_no??''})}>{ar?'تعديل':'Edit'}</button></td></tr>)}{!entities.length&&<tr><td colSpan={5}>{ar?'لا توجد كيانات مضافة. أضف كيانًا عند الحاجة.':'No entities added. Add one when needed.'}</td></tr>}</tbody></table></div>}
   {draft&&<form className="settings-form settings-entity-editor" onSubmit={save}><h3>{draft.id?(ar?'تعديل الكيان':'Edit entity'):(ar?'إضافة كيان':'Add entity')}</h3><label>{ar?'اسم الكيان':'Entity name'}<input autoFocus required maxLength={160} value={draft.name} disabled={busy} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label>{ar?'نوع الكيان':'Entity type'}<select value={draft.entity_type} disabled={busy} onChange={e=>setDraft({...draft,entity_type:e.target.value})}>{types.map(t=><option key={t[0]} value={t[0]}>{t[ar?1:2]}</option>)}</select></label><label>{ar?'رقم التسجيل':'Registration number'}<input maxLength={80} value={draft.registration_no} disabled={busy} onChange={e=>setDraft({...draft,registration_no:e.target.value})}/></label><label>{ar?'العملة':'Currency'}<select value={draft.base_currency} disabled={busy} onChange={e=>setDraft({...draft,base_currency:e.target.value})}>{Array.from(new Set([org.base_currency,draft.base_currency,'SAR','USD','EUR','AED','SYP','LBP'])).map(code=><option key={code}>{code}</option>)}</select></label><footer className="settings-action-footer"><button className="settings-save" disabled={busy}>{busy?(ar?'جارٍ الحفظ…':'Saving…'):(ar?'حفظ الكيان':'Save entity')}</button><button type="button" className="settings-text-action" disabled={busy} onClick={()=>setDraft(null)}>{ar?'إلغاء':'Cancel'}</button></footer></form>}
   {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section></div>
 </section>;
}
