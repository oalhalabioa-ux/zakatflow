'use client';
import {useState,type FormEvent} from 'react';
import DetailsDialog from './assets/DetailsDialog';
import ActionButton from './ActionButton';
import {categoryName,categoryOptions} from '../lib/debt-categories';
import type {DebtItem} from '../lib/financial-register';
export default function DebtCategoryDialog({debt,onClose,onChanged}:{debt:DebtItem;onClose:()=>void;onChanged:()=>void}){
 const [category,setCategory]=useState(debt.category==='UNCLASSIFIED'?'':debt.category??''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{const r=await fetch('/api/debt-categories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:debt.categoryOrigin,record_id:debt.id,category})}),d=await r.json();if(!r.ok)throw Error(d.error);onClose();onChanged();}catch(e){setError((e as Error).message==='DEBT_CATEGORY_ACCESS_DENIED'?'لا تملك صلاحية تعديل فئة هذا الرصيد.':'تعذر حفظ الفئة. تحقق من الاختيار والصلاحيات وأعد المحاولة.');}finally{setBusy(false);}}
 return <DetailsDialog label="تصنيف الذمة" onClose={()=>{if(!busy)onClose();}}><form className="card finance-dialog" onSubmit={save} aria-busy={busy}><header><h2>تصنيف الذمة</h2><ActionButton icon="close" label="إغلاق" disabled={busy} onClick={onClose}/></header><p>{debt.partyName} · {debt.description}</p><p className="finance-note">{debt.categoryInferred?'الفئة الحالية مستنتجة من مصدر العملية. ':''}تغيير الفئة ينظم العرض والتقارير دون تغيير المبلغ أو القيد أو مصدر العملية.</p>{error&&<p role="alert" className="finance-error">{error}</p>}<label>الفئة<select required value={category} onChange={e=>setCategory(e.target.value)}><option value="">اختر الفئة</option>{categoryOptions(debt.organizationId?'ORGANIZATION':'PERSONAL',debt.side).map(([code,,,label])=><option value={code} key={code}>{label}</option>)}</select></label><p className="finance-note">المصدر: {debt.source} · الفئة السابقة: {categoryName(debt.category)}</p><footer><ActionButton icon="save" label="حفظ الفئة" showLabel type="submit" disabled={busy||!category||!debt.categoryOrigin}/></footer></form></DetailsDialog>;
}
