'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {CenterBranchRegistry} from '../../lib/financial-center-branch-registry';
type Named={id:string;name:string;active?:boolean};
type Data={registry:CenterBranchRegistry;centers:Named[];branches:Named[]};
/** Mounted with organization as key: a scope change discards pending editor state. */
export default function CenterBranchAssignments({organization,ar}:{organization:string;ar:boolean}){
 const [data,setData]=useState<Data|null>(null),[hidden,setHidden]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const [center,setCenter]=useState(''),[branch,setBranch]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[reason,setReason]=useState('');
 const alive=useRef(true),saveController=useRef<AbortController|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;saveController.current?.abort()}},[]);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setData(null);setError('');
  async function load(){
   const response=await fetch('/api/financial-reporting/center-branches?organization='+encodeURIComponent(organization),{cache:'no-store',signal:controller.signal});
   if(response.status===404){if(!controller.signal.aborted)setHidden(true);return}
   if(!response.ok)throw Error();
   const registry:CenterBranchRegistry=await response.json();
   if(registry.organizationId!==organization||registry.complete!==true||!Array.isArray(registry.assignments))throw Error();
   const responses=await Promise.all(['cost-centers','entities'].map(path=>fetch('/api/organizations/'+path+'?organization_id='+encodeURIComponent(organization),{cache:'no-store',signal:controller.signal})));
   if(responses.some(r=>!r.ok))throw Error();
   const [centers,entities]=await Promise.all(responses.map(r=>r.json()));
   if(!Array.isArray(centers)||!Array.isArray(entities)||[...centers,...entities].some(r=>r.organization_id!==organization))throw Error();
   if(!controller.signal.aborted){setData({registry,centers,branches:entities.filter(e=>e.entity_type==='BRANCH')});setHidden(false)}
  }
  load().catch(()=>{if(!controller.signal.aborted)setError(ar?'تعذر تحميل ارتباطات المراكز. أعد المحاولة.':'Unable to load center assignments. Retry.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});
  return()=>controller.abort();
 },[organization,ar,reload]);
 const open=data?.registry.assignments.find(a=>a.centerId===center&&a.status==='APPROVED'&&a.to===null);
 const branchName=(id:string|null)=>id===null?(ar?'المركز الرئيسي':'Headquarters'):data?.branches.find(b=>b.id===id)?.name??id;
 async function save(event:FormEvent){
  event.preventDefault();if(!data||busy||!center||!from||!reason.trim())return;
  const revision=Number(data.registry.revision);if(!Number.isSafeInteger(revision)){setError(ar?'تعذر التحقق من إصدار السجل. أعد التحميل.':'Registry revision unavailable. Reload.');return}
  const controller=new AbortController();saveController.current=controller;setBusy(true);setError('');setNotice('');
  try{
   const payload={organization,center,branch:branch||null,from,expectedRevision:revision,reason:reason.trim(),...(open?{action:'transfer'}:{to:to||null})};
   const r=await fetch('/api/financial-reporting/center-branches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
   if(!r.ok){if(r.status===409){if(alive.current){setReload(n=>n+1);setNotice(ar?'تغيّر السجل أو تتداخل الفترة. راجع البيانات المحدثة قبل الحفظ.':'Registry changed or periods overlap. Review the refreshed data.');}return}throw Error(r.status===403?'denied':'invalid')}
   if(alive.current){setCenter('');setBranch('');setFrom('');setTo('');setReason('');setReload(n=>n+1);setNotice(ar?'تم حفظ الارتباط وتسجيله في السجل.':'Assignment saved in the history.')}
  }catch(e){if(alive.current&&!controller.signal.aborted)setError(e instanceof Error&&e.message==='denied'?(ar?'ليست لديك صلاحية اعتماد ارتباط المراكز.':'You cannot approve center assignments.'):(ar?'تعذر الحفظ. تحقق من الفترة والفرع؛ النقل يتطلب تاريخًا مستقبليًا.':'Unable to save. Check dates and branch; transfers require a future date.'))}
  finally{if(alive.current)setBusy(false)}
 }
 if(hidden)return null;
 return <section className="settings-card settings-center-assignments" aria-label={ar?'ارتباط المراكز بالفروع':'Center branch assignments'}>
  <h3>{ar?'ارتباط المراكز بالفروع':'Center branch assignments'}</h3>
  <p className="settings-hint">{ar?'حدد الفرع الذي يتبعه كل مركز وتاريخ سريان الارتباط. يحتفظ السجل بالارتباط السابق عند النقل.':'Assign each center to a branch with an effective date. Transfers preserve prior history.'}</p>
  {loading?<p role="status">{ar?'جارٍ التحميل…':'Loading…'}</p>:data&&<>
   <div className="settings-table-scroll"><table className="settings-data-table"><thead><tr>{(ar?['المركز','الفرع','من','إلى']:['Center','Branch','From','To']).map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>
    {data.registry.assignments.map(a=><tr key={a.id}><td>{data.centers.find(c=>c.id===a.centerId)?.name??a.centerId}</td><td>{branchName(a.branchId)}</td><td><bdi>{a.from}</bdi></td><td><bdi>{a.to??(ar?'مستمر':'Ongoing')}</bdi></td></tr>)}
    {!data.registry.assignments.length&&<tr><td colSpan={4}>{ar?'لم تُسجّل ارتباطات بعد.':'No assignments recorded yet.'}</td></tr>}
   </tbody></table></div>
   <form className="settings-form" onSubmit={save}><fieldset disabled={busy} style={{minWidth:0,border:0,padding:0,gridColumn:"1 / -1",display:"grid",gap:16}}><legend>{open?(ar?'نقل المركز بتاريخ مستقبلي':'Transfer center on a future date'):(ar?'إضافة ارتباط':'Add assignment')}</legend>
    <label>{ar?'المركز':'Center'}<select aria-label={ar?'المركز':'Center'} required value={center} onChange={e=>{setCenter(e.target.value);setBranch('');setFrom('');setTo('')}}><option value="">{ar?'اختر المركز':'Select center'}</option>{data.centers.filter(c=>c.active!==false).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>{ar?'الفرع':'Branch'}<select aria-label={ar?'الفرع':'Branch'} value={branch} onChange={e=>setBranch(e.target.value)}><option value="">{ar?'المركز الرئيسي':'Headquarters'}</option>{data.branches.filter(b=>b.active!==false).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
    {open&&<p>{ar?'الارتباط الحالي: ':'Current assignment: '}{branchName(open.branchId)}</p>}
    <label>{ar?'تاريخ السريان':'Effective date'}<input required type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
    {!open&&<label>{ar?'تاريخ الانتهاء (اختياري)':'End date (optional)'}<input type="date" min={from||undefined} value={to} onChange={e=>setTo(e.target.value)}/></label>}
    <label>{ar?'سبب الربط أو النقل':'Assignment or transfer reason'}<input required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button className="settings-save" disabled={!center||!from||!reason.trim()||Boolean(open&&open.branchId===(branch||null))}>{busy?(ar?'جارٍ الحفظ…':'Saving…'):(ar?'حفظ الارتباط':'Save assignment')}</button>
   </fieldset></form>
  </>}
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!loading&&error&&<button type="button" className="settings-text-action" onClick={()=>setReload(n=>n+1)}>{ar?'إعادة المحاولة':'Retry'}</button>}
 </section>;
}
