'use client';
import {useState,type FormEvent} from 'react';
import DetailsDialog from './DetailsDialog';
import ActionButton from '../ActionButton';
type PartyType={id:string;code:string;name_ar:string;name_en:string};
export default function AssetEntryQuickAdd({kind,organizationId,organizationName,partyTypes=[],ar,onClose,onSaved}:{kind:'SUPPLIER'|'CENTER';organizationId:string;organizationName:string;partyTypes?:PartyType[];ar:boolean;onClose:()=>void;onSaved:(item:any)=>void}){
 const [name,setName]=useState(''),[code,setCode]=useState(''),[type,setType]=useState('INVESTMENT'),[role,setRole]=useState('SUPPLIER'),[classification,setClassification]=useState(''),[contact,setContact]=useState(''),[phone,setPhone]=useState(''),[email,setEmail]=useState(''),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false),[error,setError]=useState('');
 const supplier=kind==='SUPPLIER',title=supplier?(ar?'إضافة مورد':'Add supplier'):(ar?'إضافة مركز تكلفة':'Add cost center');
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;setSubmitted(true);const invalid=e.currentTarget.querySelector<HTMLInputElement|HTMLSelectElement>('input:invalid,select:invalid,textarea:invalid');if(invalid){const section=invalid.closest('details');if(section)section.open=true;invalid.focus();return;}setBusy(true);setError('');try{
  const r=await fetch(supplier?'/api/liquidity':'/api/organizations/cost-centers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(supplier?{kind:'counterparty',organization_id:organizationId,name,party_type:role,party_type_id:classification||null,contact_name:contact,phone,email,notes}:{organization_id:organizationId,name,code,center_type:type})});
  const item=await r.json();if(!r.ok)throw Error(item.error);onSaved(item);
 }catch{setError(ar?'تعذر الحفظ. تحقق من الصلاحية والاسم، ومن عدم تكرار رمز المركز.':'Could not save. Check permissions, name and whether the center code already exists.');}finally{setBusy(false);}}
 return <DetailsDialog label={title} onClose={()=>{if(!busy)onClose();}}><form dir={ar?'rtl':'ltr'} className={`asset-entry-quick-add ${submitted?'is-submitted':''}`} noValidate onSubmit={save} aria-busy={busy}>
 <header className="asset-entry-quick-header"><span className="asset-entry-quick-icon" aria-hidden="true">{supplier?'♙':'▥'}</span><div><h3>{title}</h3><p>{ar?'احفظ البيانات لاختيارها في السند مباشرة.':'Save to select it in the current voucher.'}</p></div></header>
 {error&&<p role="alert" className="asset-entry-error">{error}</p>}
 <fieldset disabled={busy}><div className="form-grid">
 <label>{supplier?(ar?'اسم المورد *':'Supplier name *'):(ar?'اسم مركز التكلفة *':'Cost center name *')}<input autoFocus required pattern={'.*\\S.*'} maxLength={supplier?160:120} value={name} onChange={e=>setName(e.target.value)}/></label>
 <label>{ar?'الشركة المرتبطة':'Linked organization'}<input readOnly value={organizationName}/></label>
 {supplier?<>
 <label>{ar?'نوع التعامل *':'Trading role *'}<select required value={role} onChange={e=>setRole(e.target.value)}><option value="SUPPLIER">{ar?'مورد':'Supplier'}</option><option value="BOTH">{ar?'عميل ومورد':'Customer & supplier'}</option></select></label>
 <label>{ar?'تصنيف الجهة':'Party classification'}<select value={classification} onChange={e=>setClassification(e.target.value)}><option value="">{ar?'التصنيف الافتراضي للمورد':'Default supplier classification'}</option>{partyTypes.filter(t=>!['CUSTOMER','PERSON','OTHER'].includes(t.code)).map(t=><option key={t.id} value={t.id}>{ar?t.name_ar:t.name_en}</option>)}</select></label>
 </>:<>
 <label>{ar?'رمز المركز *':'Center code *'}<input required pattern="[A-Za-z0-9_-]+" maxLength={30} dir="ltr" value={code} onChange={e=>setCode(e.target.value)}/><small>{ar?'أحرف إنجليزية وأرقام، دون مسافات.':'English letters and numbers, without spaces.'}</small></label>
 <label>{ar?'تصنيف المركز *':'Center classification *'}<select required value={type} onChange={e=>setType(e.target.value)}>{[['ADMIN','إداري','Administrative'],['OPERATING','تشغيلي','Operating'],['PROJECT_OPERATING','مشروع تشغيلي','Operating project'],['INVESTMENT','استثماري / رأسمالي','Investment / capital'],['TREASURY','خزينة','Treasury'],['FINANCING','تمويلي','Financing']].map(([value,a,en])=><option key={value} value={value}>{ar?a:en}</option>)}</select></label>
 </>}
 </div>
 {supplier&&<details className="asset-entry-quick-contact" open><summary>{ar?'بيانات التواصل والملاحظات':'Contact details & notes'}</summary><div className="form-grid"><label>{ar?'اسم مسؤول التواصل':'Contact name'}<input maxLength={120} value={contact} onChange={e=>setContact(e.target.value)}/></label><label>{ar?'رقم الهاتف':'Phone'}<input type="tel" dir="ltr" maxLength={40} value={phone} onChange={e=>setPhone(e.target.value)}/></label><label>{ar?'البريد الإلكتروني':'Email'}<input type="email" dir="ltr" maxLength={160} value={email} onChange={e=>setEmail(e.target.value)}/></label><label>{ar?'ملاحظات':'Notes'}<textarea maxLength={500} rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></label></div></details>}
 </fieldset>
 <footer className="asset-entry-quick-actions"><ActionButton type="submit" icon="save" label={busy?(ar?'جار الحفظ…':'Saving…'):supplier?(ar?'حفظ واختيار المورد':'Save and select supplier'):(ar?'حفظ واختيار المركز':'Save and select center')} showLabel disabled={busy}/><ActionButton icon="close" label={ar?'إلغاء':'Cancel'} showLabel disabled={busy} onClick={onClose}/></footer></form></DetailsDialog>;
}
