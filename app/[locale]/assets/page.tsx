'use client';

import { use, useEffect, useMemo, useState } from 'react';

type AssetType = 'CASH'|'BANK'|'GOLD'|'SILVER'|'STOCK'|'INVENTORY'|'RECEIVABLE'|'REAL_ESTATE'|'OTHER';

type FormState = {
  asset_type: AssetType;
  name: string;
  currency: string;
  amount: string;
  quantity: string;
  unit_price: string;
  karat: string;
  purpose: string;
  is_zakatable: boolean;
};

const TYPES: Array<[AssetType,string,string]> = [
  ['CASH','نقد','Cash'],['BANK','حساب بنكي','Bank account'],['GOLD','ذهب','Gold'],['SILVER','فضة','Silver'],
  ['STOCK','أسهم / محفظة','Stocks / portfolio'],['INVENTORY','مخزون تجاري','Inventory'],['RECEIVABLE','ذمم مدينة','Receivable'],
  ['REAL_ESTATE','عقار','Real estate'],['OTHER','أصل آخر','Other'],
];
const CURRENCIES = ['SAR','USD','EUR','AED','GBP','KWD','QAR','BHD','OMR','TRY','EGP','SYP','LBP'];

export default function Assets({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const ar = locale === 'ar';
  const [rows,setRows] = useState<any[]>([]);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [msg,setMsg] = useState('');
  const [form,setForm] = useState<FormState>({asset_type:'CASH',name:'',currency:'SAR',amount:'',quantity:'',unit_price:'',karat:'24',purpose:'',is_zakatable:true});

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/assets');
    const data = r.ok ? await r.json() : [];
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const metal = form.asset_type === 'GOLD' || form.asset_type === 'SILVER';
  const valuedQuantity = metal || form.asset_type === 'STOCK' || form.asset_type === 'INVENTORY';
  const estimatedValue = useMemo(() => {
    if (valuedQuantity) return (Number(form.quantity)||0) * (Number(form.unit_price)||0);
    return Number(form.amount)||0;
  },[form.amount,form.quantity,form.unit_price,valuedQuantity]);

  function changeType(asset_type: AssetType) {
    setForm(f => ({...f,asset_type,name:'',amount:'',quantity:'',unit_price:'',karat:asset_type==='SILVER'?'999':'24',purpose:''}));
    setMsg('');
  }

  async function save() {
    if (!form.name.trim()) { setMsg(ar?'أدخل اسم الأصل.':'Enter an asset name.'); return; }
    setSaving(true); setMsg('');
    const metadata:any = {};
    if (form.amount) metadata.opening_value = Number(form.amount);
    if (form.quantity) metadata.quantity = Number(form.quantity);
    if (form.unit_price) metadata.unit_price = Number(form.unit_price);
    if (metal && form.karat) metadata.karat = Number(form.karat);
    if (form.purpose) metadata.purpose = form.purpose;
    metadata.estimated_value = estimatedValue;

    const r = await fetch('/api/assets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      asset_type:form.asset_type,name:form.name.trim(),currency:form.currency,
      unit: metal ? 'g' : form.asset_type==='STOCK' ? 'share' : 'unit',is_zakatable:form.is_zakatable,metadata
    })});
    const data = await r.json().catch(()=>({}));
    if (r.ok) {
      setMsg(ar?'تم حفظ الأصل بنجاح.':'Asset saved successfully.');
      setForm(f=>({...f,name:'',amount:'',quantity:'',unit_price:'',purpose:''}));
      await load();
    } else setMsg(data.error || (ar?'تعذر حفظ الأصل.':'Could not save asset.'));
    setSaving(false);
  }

  const label = (type:string) => TYPES.find(x=>x[0]===type)?.[ar?1:2] || type;
  const valueOf = (r:any) => Number(r?.metadata?.estimated_value ?? r?.metadata?.opening_value ?? 0);

  return <main className="container">
    <div className="page-head"><div><h1>{ar?'الأصول':'Assets'}</h1><p className="muted">{ar?'عرّف أموالك وممتلكاتك الخاضعة للزكاة. ستستخدم القيم لاحقاً في المعاملات والحول والاحتساب.':'Define zakatable accounts and holdings for transactions, hawl tracking and assessment.'}</p></div></div>

    <section className="card section">
      <h3>{ar?'إضافة أصل':'Add asset'}</h3>
      <div className="form-grid">
        <label>{ar?'نوع الأصل':'Asset type'}<select value={form.asset_type} onChange={e=>changeType(e.target.value as AssetType)}>{TYPES.map(([v,a,e])=><option key={v} value={v}>{ar?a:e}</option>)}</select></label>
        <label>{ar?'اسم الأصل':'Asset name'}<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder={ar?(form.asset_type==='BANK'?'مثال: حساب الإنماء':metal?'مثال: سبائك ذهب':'مثال: المحفظة الرئيسية'):'e.g. Main account'} /></label>
        <label>{ar?'العملة':'Currency'}<select value={form.currency} onChange={e=>setForm({...form,currency:e.target.value})}>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label>

        {valuedQuantity ? <>
          <label>{metal?(ar?'الوزن بالغرام':'Weight (g)'):(ar?'الكمية':'Quantity')}<input type="number" min="0" step="any" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/></label>
          <label>{metal?(ar?'سعر الغرام':'Price per gram'):(ar?'سعر الوحدة':'Unit price')}<input type="number" min="0" step="any" value={form.unit_price} onChange={e=>setForm({...form,unit_price:e.target.value})}/></label>
          {metal && <label>{form.asset_type==='GOLD'?(ar?'العيار':'Karat'):(ar?'النقاوة':'Purity')}<input type="number" min="0" step="any" value={form.karat} onChange={e=>setForm({...form,karat:e.target.value})}/></label>}
        </> : <label>{ar?'القيمة / الرصيد':'Value / balance'}<input type="number" min="0" step="any" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></label>}

        {form.asset_type==='REAL_ESTATE' && <label>{ar?'الغرض من العقار':'Property purpose'}<select value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value})}><option value="">—</option><option value="TRADE">{ar?'للتجارة / البيع':'For trade / sale'}</option><option value="RENT">{ar?'للتأجير':'Rental'}</option><option value="PERSONAL">{ar?'استخدام شخصي':'Personal use'}</option></select></label>}
        <label>{ar?'المعاملة الزكوية':'Zakat treatment'}<select value={form.is_zakatable?'yes':'no'} onChange={e=>setForm({...form,is_zakatable:e.target.value==='yes'})}><option value="yes">{ar?'خاضع للزكاة':'Zakatable'}</option><option value="no">{ar?'غير خاضع حالياً':'Not zakatable'}</option></select></label>
      </div>
      {estimatedValue>0 && <p className="muted">{ar?'القيمة التقديرية':'Estimated value'}: <strong>{estimatedValue.toLocaleString()} {form.currency}</strong></p>}
      <button className="btn" onClick={save} disabled={saving}>{saving?(ar?'جارٍ الحفظ…':'Saving…'):(ar?'حفظ الأصل':'Save asset')}</button>
      {msg && <p className="muted">{msg}</p>}
    </section>

    <section className="card section">
      <h3>{ar?'قائمة الأصول':'Asset list'}</h3>
      {loading ? <p className="muted">{ar?'جارٍ التحميل…':'Loading…'}</p> : rows.length===0 ? <p className="muted">{ar?'لا توجد أصول بعد.':'No assets yet.'}</p> : <table className="table"><thead><tr><th>{ar?'الاسم':'Name'}</th><th>{ar?'النوع':'Type'}</th><th>{ar?'العملة':'Currency'}</th><th>{ar?'القيمة التقديرية':'Estimated value'}</th><th>{ar?'زكوي؟':'Zakatable?'}</th><th>{ar?'الحالة':'Status'}</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.name}</td><td>{label(r.asset_type)}</td><td>{r.currency}</td><td>{valueOf(r)?valueOf(r).toLocaleString():'—'}</td><td>{r.is_zakatable?(ar?'نعم':'Yes'):(ar?'لا':'No')}</td><td><span className="pill">{r.status}</span></td></tr>)}</tbody></table>}
    </section>
  </main>;
}
