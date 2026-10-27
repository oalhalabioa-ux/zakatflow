'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {supabaseBrowser} from '../../../lib/supabase/client';
type Plan={id:string;code:string;name_ar:string;price_amount:number;currency:string;billing_interval:string;is_active:boolean};
export default function PlanEditor({plans}:{plans:Plan[]}){
 const router=useRouter();
 const [selected,setSelected]=useState('');
 const [code,setCode]=useState('');
 const [name,setName]=useState('');
 const [price,setPrice]=useState('0');
 const [currency,setCurrency]=useState('SAR');
 const [interval,setInterval]=useState('monthly');
 const [active,setActive]=useState(true);
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState('');
 function select(id:string){setSelected(id);const p=plans.find(x=>x.id===id);setCode(p?.code||'');setName(p?.name_ar||'');setPrice(String(p?.price_amount??0));setCurrency(p?.currency||'SAR');setInterval(p?.billing_interval||'monthly');setActive(p?.is_active??true);setMessage('');}
 async function save(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(saving)return;setSaving(true);setMessage('');try{
  const db=supabaseBrowser();
  const {error}=await db.rpc('owner_upsert_plan',{p_id:selected||null,p_code:code.trim(),p_name_ar:name.trim(),p_price:Number(price),p_currency:currency,p_interval:interval,p_active:active});
  if(error)throw error;setMessage('تم حفظ الباقة وتسجيل العملية في سجل التدقيق.');router.refresh();
 }catch{setMessage('تعذر الحفظ. تحقق من البيانات والصلاحيات ثم أعد المحاولة.');}finally{setSaving(false);}}
 return <form onSubmit={save} className="owner-plan-form" dir="rtl"><h3>إضافة أو تعديل باقة</h3><label>الباقة الحالية <select value={selected} onChange={e=>select(e.target.value)}><option value="">باقة جديدة</option>{plans.map(p=><option value={p.id} key={p.id}>{p.name_ar} ({p.code})</option>)}</select></label>
 <label>رمز الباقة <input required minLength={2} maxLength={40} pattern="[a-z0-9_-]+" value={code} onChange={e=>setCode(e.target.value)}/></label>
 <label>الاسم العربي <input required minLength={2} maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
 <label>السعر <input required type="number" min="0" max="100000000" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/></label>
 <label>العملة <select value={currency} onChange={e=>setCurrency(e.target.value)}>{['SAR','USD','AED','QAR','BHD','KWD','OMR','EUR'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label>دورة الفوترة <select value={interval} onChange={e=>setInterval(e.target.value)}><option value="monthly">شهري</option><option value="yearly">سنوي</option></select></label>
 <label><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> مفعلة</label>
 <button type="submit" disabled={saving}>{saving?'جارٍ الحفظ...':'حفظ الباقة'}</button><p role="status" aria-live="polite">{message}</p></form>;
}
