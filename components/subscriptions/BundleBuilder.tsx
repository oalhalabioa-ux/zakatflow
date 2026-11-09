'use client';
import {useEffect,useState} from 'react';
import SettingsIcon from '@/components/settings/SettingsIcon';
import {money} from '@/lib/subscriptions/catalog';
import {bundleSelection,bundleStatus,bundleError,type BundleModule,type BundleRequest} from '@/lib/subscriptions/bundles';
import './bundle-builder.css';
type Data={modules:BundleModule[];rows:BundleRequest[];can_request:boolean;max_users:number};
export default function BundleBuilder({locale,organization}:{locale:string;organization:string}){
 const ar=locale==='ar';const [data,setData]=useState<Data|null>(null),[keys,setKeys]=useState<string[]>(['assets','liquidity']),[interval,setInterval]=useState<'monthly'|'yearly'>('monthly');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0),[token,setToken]=useState(''),[confirmed,setConfirmed]=useState(false);
 useEffect(()=>{const abort=new AbortController();setData(null);setError('');setConfirmed(false);setKeys(['assets','liquidity']);setToken(crypto.randomUUID());
 if(organization)fetch('/api/subscriptions/bundles?organization_id='+encodeURIComponent(organization),{cache:'no-store',signal:abort.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d;}).then(d=>{if(!abort.signal.aborted)setData(d);}).catch(e=>{if(!abort.signal.aborted)setError(bundleError(e.message,ar));});
 return()=>abort.abort();},[organization,revision,ar]);
 const selection=bundleSelection(data?.modules??[],keys,interval),open=data?.rows.find(r=>['pending','offered','accepted'].includes(r.status));
 async function act(payload:Record<string,unknown>){if(busy)return;setBusy(true);setError('');setMessage('');try{
 const r=await fetch('/api/subscriptions/bundles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,organization_id:organization})});const d=await r.json();if(!r.ok)throw Error(d.error);
 setMessage(ar?'تم حفظ الطلب وتحديث حالته.':'Request saved and status updated.');setRevision(v=>v+1);
 }catch(e){setError(bundleError(e instanceof Error?e.message:'',ar));}finally{setBusy(false);}}
 if(!organization)return <p>{ar?'اختر المؤسسة لإعداد باقتها.':'Select an organization to build its bundle.'}</p>;
 return <section className="bundle-builder" aria-label={ar?'صمّم باقتك':'Build your bundle'}>
 <header><p>{ar?'اختر الموديولات المناسبة لمؤسستك، ثم أرسل طلبك.':'Choose the modules your organization needs, then submit your request.'}</p></header>
 {error&&<p role="alert">{error} <button onClick={()=>setRevision(v=>v+1)} disabled={busy}>{ar?'تحديث':'Refresh'}</button></p>}{message&&<p role="status">{message}</p>}
 {!data&&!error&&<p role="status">{ar?'جارٍ تحميل الموديولات…':'Loading modules…'}</p>}
 {data&&<><div className="bundle-layout"><div className="bundle-modules">
 {data.modules.map(m=>{const selected=selection.items.some(item=>item.key===m.key),required=['assets','liquidity'].includes(m.key)||selection.items.some(item=>item.key!==m.key&&item.requires.includes(m.key));return <article key={m.key} className="bundle-card" data-selected={selected} data-module={m.key}>
 <SettingsIcon name={m.icon}/>{selected&&<span className="bundle-check" aria-label={ar?'مختار':'Selected'}>✓</span>}<h3>{ar?m.name_ar:m.name_en}</h3><p>{ar?m.description_ar:m.description_en}</p>
 <p className="bundle-price">{m.pricing==='quote'?(ar?'يتطلب عرض سعر':'Quote required'):money(m[interval]!,m.currency,locale)}{m.pricing==='fixed'&&<small> {interval==='monthly'?(ar?'/ شهر':'/ month'):(ar?'/ سنة':'/ year')}</small>}</p>
 {required&&<small>{ar?'متطلب أساسي':'Required foundation'}</small>}
 <button type="button" aria-pressed={selected} disabled={busy||!!open||required} onClick={()=>{setConfirmed(false);setKeys(selected?selection.items.filter(item=>item.key!==m.key).map(item=>item.key):[...keys,m.key]);}}>{selected?<><span className="bundle-check-inline">✓</span> {ar?'تمت الإضافة':'Added'}</>:<><svg className="bundle-plus" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M10 3v14M3 10h14"/></svg> {ar?'إضافة':'Add'}</>}</button></article>;})}
 </div><aside className="bundle-summary"><h3><SettingsIcon name="chart"/>{ar?'ملخص باقتك':'Your bundle'}</h3>
 <ul>{selection.items.map(m=><li key={m.key}><span>{ar?m.name_ar:m.name_en}</span><button type="button" aria-label={(ar?'إزالة ':'Remove ')+(ar?m.name_ar:m.name_en)} disabled={busy||!!open||['assets','liquidity'].includes(m.key)||selection.items.some(item=>item.requires.includes(m.key))} onClick={()=>{setConfirmed(false);setKeys(selection.items.filter(item=>item.key!==m.key).map(item=>item.key));}}>×</button></li>)}</ul>
 <fieldset disabled={busy||!!open}><legend>{ar?'دورة الفوترة':'Billing cycle'}</legend><div className="bundle-interval">{(['monthly','yearly'] as const).map(v=><button type="button" key={v} aria-pressed={interval===v} onClick={()=>{setInterval(v);setConfirmed(false);}}>{v==='monthly'?(ar?'شهري':'Monthly'):(ar?'سنوي':'Yearly')}</button>)}</div></fieldset>
 <p className="bundle-note"><SettingsIcon name="info"/>{ar?'الأصول والسيولة أساس الربط المالي. التقارير والقراءة والتصدير متاحة وفق صلاحيات العضو.':'Assets and cash are the financial foundation. Reports, reading and export remain available within member permissions.'}</p>
 {selection.unavailable||selection.mixedCurrency?<p role="alert">{bundleError(selection.mixedCurrency?'CURRENCY':'UNAVAILABLE',ar)}</p>:<><p>{selection.total===null?(ar?'تتضمن اختياراتك موديولًا يتطلب عرض سعر.':'Your selection includes a module that requires a quote.'):(ar?'الإجمالي غير شامل الضرائب واجبة التطبيق':'Total excludes applicable taxes')}</p><strong className="bundle-total">{selection.total===null?(ar?'الإجمالي النهائي بعد المراجعة':'Final total after review'):money(selection.total,selection.currency,locale)}</strong></>}
 <p>{ar?'حد المستخدمين الحالي للطلب':'Current request seat limit'}: {data.max_users}</p>
 <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void act({action:'submit',token,modules:selection.items.map(m=>({key:m.key,revision:m.revision})),interval,phone:f.get('phone'),notes:f.get('notes')});}}>
 <label>{ar?'رقم التواصل (اختياري)':'Contact phone (optional)'}<input name="phone" type="tel" maxLength={50} disabled={busy||!!open}/></label>
 <label>{ar?'ملاحظات واحتياجات إضافية':'Notes and additional requirements'}<textarea name="notes" maxLength={2000} rows={2} disabled={busy||!!open}/></label>
 <label className="bundle-consent"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy||!!open}/>{ar?'راجعت الموديولات ودورة الاشتراك والسعر المعروض إن وجد. التفعيل بعد مراجعة الإدارة.':'I reviewed the modules, billing cycle and any displayed price. Activation follows administrative review.'}</label>
 <button className="bundle-primary" disabled={busy||!!open||!data.can_request||!confirmed||selection.unavailable||selection.mixedCurrency}>{busy?(ar?'جارٍ الحفظ…':'Saving…'):selection.total===null?(ar?'إرسال طلب عرض سعر':'Request a quote'):(ar?'طلب التفعيل':'Request activation')}</button>
 </form><small><SettingsIcon name="security"/>{ar?'لا يتطلب إرسال الطلب بطاقة دفع.':'No payment card is required.'}</small>
 {!data.can_request&&<p>{ar?'إرسال الطلب متاح لمالك المؤسسة أو مديرها.':'Only organization owners and administrators can submit.'}</p>}
 </aside></div>
 {!!data.rows.length&&<section className="bundle-history"><h3>{ar?'طلبات باقتك':'Your bundle requests'}</h3>{data.rows.map(r=><article key={r.id}><header><strong>#{r.request_number} · {bundleStatus(r.status,ar)}</strong><span>{r.total==null?(ar?'بانتظار التسعير':'Awaiting pricing'):money(r.total,r.currency,locale)} · {r.billing_interval==='monthly'?(ar?'شهري':'Monthly'):(ar?'سنوي':'Yearly')}</span></header><p>{r.items.map(m=>ar?m.name_ar:m.name_en).join(' · ')}</p><p>{ar?'حد المستخدمين':'User limit'}: {r.max_users}</p>{r.reason&&<p>{r.reason}</p>}{r.status==='offered'&&<button className="bundle-primary" disabled={busy} onClick={()=>void act({action:'accept',id:r.id,revision:r.revision})}>{ar?'قبول العرض وطلب التفعيل':'Accept quote and request activation'}</button>}{['pending','offered','accepted'].includes(r.status)&&<button disabled={busy} onClick={()=>void act({action:'cancel',id:r.id,revision:r.revision})}>{ar?'إلغاء الطلب':'Cancel request'}</button>}</article>)}</section>}
 </>}
 </section>;
}
