'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {supabaseBrowser} from '@/lib/supabase/browser';
type Subscription={id:string;organization_name:string;plan_name:string;status:string};
const transitions:Record<string,{value:string;label:string}[]>={
 trialing:[{value:'active',label:'تفعيل يدوي'},{value:'cancelled',label:'إلغاء'},{value:'expired',label:'إنهاء التجربة'}],
 active:[{value:'past_due',label:'متأخر السداد'},{value:'cancelled',label:'إلغاء'},{value:'expired',label:'إنهاء'}],
 past_due:[{value:'active',label:'إعادة التفعيل'},{value:'cancelled',label:'إلغاء'},{value:'expired',label:'إنهاء'}]
};
export default function SubscriptionStatusEditor({subscriptions}:{subscriptions:Subscription[]}){
 const router=useRouter();const [id,setId]=useState('');const [next,setNext]=useState('');const [confirm,setConfirm]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
 const current=subscriptions.find(x=>x.id===id);const options=current?transitions[current.status]||[]:[];
 async function save(e:React.FormEvent<HTMLFormElement>){e.preventDefault();if(!current||!next||!confirm||busy)return;setBusy(true);setMessage('');try{
 const {error}=await supabaseBrowser().rpc('owner_change_subscription_status',{p_subscription_id:current.id,p_expected_status:current.status,p_new_status:next});
 if(error)throw error;setMessage('تم تغيير الحالة وتسجيل العملية. لا يوجد أثر مالي تلقائي.');setConfirm(false);setNext('');setId('');router.refresh();
 }catch{setMessage('تعذر تغيير الحالة؛ ربما تغير الاشتراك أو لا تملك الصلاحية. حدّث الصفحة ثم أعد المحاولة.');}finally{setBusy(false);}}
 return <form className="owner-plan-form" onSubmit={save} dir="rtl"><h3>إدارة حالة الاشتراك — QA</h3><p>تغيير الحالة إداري فقط ولا يثبت السداد أو يمدد تاريخ الاستحقاق.</p>
 <label>الاشتراك <select required value={id} onChange={e=>{setId(e.target.value);setNext('');setConfirm(false);setMessage('');}}><option value="">اختر اشتراكاً</option>{subscriptions.map(s=><option key={s.id} value={s.id}>{s.organization_name} — {s.plan_name} ({s.status})</option>)}</select></label>
 <label>الحالة الجديدة <select required value={next} onChange={e=>{setNext(e.target.value);setConfirm(false);}}><option value="">اختر الحالة</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
 <label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> أؤكد تغيير الحالة الإدارية دون أي أثر مالي</label>
 <button type="submit" disabled={busy||!current||!next||!confirm}>{busy?'جارٍ الحفظ...':'تأكيد تغيير الحالة'}</button><p role="status" aria-live="polite">{message}</p></form>;
}
