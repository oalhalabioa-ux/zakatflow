'use client';
import {useEffect,useState,useRef} from 'react';
import AssetFinancialReview from './AssetFinancialReview';
import {assetPurchaseAmounts,assetPurchasePrint,assetPurchaseStatus} from '@/lib/asset-purchase-workspace';
type Props={assetId:string;ar:boolean;onChanged:()=>void;onClose:()=>void};
export default function AssetPurchasePanel({assetId,ar,onChanged,onClose}:Props){
 const [data,setData]=useState<any>(null),[draft,setDraft]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[editing,setEditing]=useState(false),[paying,setPaying]=useState(false),[bank,setBank]=useState(''),[amount,setAmount]=useState(''),[date,setDate]=useState(()=>new Date().toISOString().slice(0,10));
 const paymentRequest=useRef<string|null>(null);
 const t=(a:string,e:string)=>ar?a:e;
 function accept(x:any){setData(x);const m=x.asset.metadata??{};setDraft({...m,quantity:Number(m.quantity??1),purchase_value:Number(m.purchase_value??0),fx_rate:Number(m.fx_rate??1),vat_input_mode:m.vat_input_mode??'AMOUNT',vat_rate:Number(m.vat_rate??15),vat_amount:Number(m.vat_amount??0),recoverable_percent:Number(m.recoverable_percent??100),due_date:m.due_date||m.purchase_date});setAmount(String(Math.max(0,Number(x.flow?.amount??0)-Number(x.flow?.settled_amount??0))));}
 useEffect(()=>{let active=true;const controller=new AbortController();fetch(`/api/assets/purchase?asset_id=${assetId}`,{signal:controller.signal}).then(async r=>{const x=await r.json();if(!r.ok)throw Error(x.error);if(active)accept(x)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false;controller.abort()}},[assetId]);
 async function request(action:'SAVE'|'ARCHIVE'|'APPROVE_AND_POST'|'PAY'){
  setBusy(true);setError('');setMessage('');
  try{
   let url='/api/assets/purchase',method='POST',body:any={asset_id:assetId,action};
   if(action==='SAVE'){method='PATCH';body={asset_id:assetId,expected_updated_at:data.asset.updated_at,changes:Object.fromEntries(['purchase_value','quantity','fx_rate','vat_input_mode','vat_rate','vat_amount','recoverable_percent','purchase_date','due_date','counterparty_id','invoice_reference'].map(k=>[k,draft[k]]))};}
   if(action==='PAY'){const a=Number(amount);if(!bank||!Number.isFinite(a)||a<=0||a>Number(data.flow.amount)-Number(data.flow.settled_amount))throw Error(t('تحقق من حساب السداد والمبلغ المتبقي','Check bank account and outstanding amount'));url=`/api/liquidity/${data.flow.id}`;method='PATCH';body={request_id:paymentRequest.current??(paymentRequest.current=crypto.randomUUID()),status:'ACTUAL',account_id:bank,settlement_date:date,amount:a,base_amount:a*Number(data.flow.base_amount)/Number(data.flow.amount)};}
   const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),x=await r.json();if(!r.ok||r.status===202||x.error)throw Error(x.error||t('السداد لم يكتمل؛ راجع حالة الاعتماد','Settlement pending approval'));
   if(action==='ARCHIVE'){onChanged();onClose();return;}
   if(action==='PAY'){const reload=await fetch(`/api/assets/purchase?asset_id=${assetId}`);const updated=await reload.json();if(!reload.ok)throw Error(updated.error);accept(updated);}else accept(x);
   if(action==='PAY')paymentRequest.current=null;setEditing(false);setPaying(false);setMessage(t(action==='APPROVE_AND_POST'?'تم الاعتماد والترحيل المالي. يمكنك السداد الآن.':action==='PAY'?'تم تسجيل السداد':'تم حفظ تعديل المسودة',action==='APPROVE_AND_POST'?'Approved and posted. Settlement is now available.':action==='PAY'?'Settlement recorded':'Draft saved'));onChanged();
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 function print(){const win=window.open('','_blank');if(!win){setError(t('اسمح بفتح نافذة الطباعة','Allow the print window'));return;}win.document.write(assetPurchasePrint(data.asset,data.event.status,data.suppliers.find((p:any)=>p.id===data.asset.metadata.counterparty_id)?.name??'',ar));win.document.close();win.focus();win.print();}
 function csv(){const m=data.asset.metadata,values=assetPurchaseAmounts(m.purchase_value,m.vat_amount);const rows=[['Asset','Status','Currency','Net','VAT','Gross','Invoice','Purchase date'],[data.asset.name,assetPurchaseStatus(data.event.status,ar),data.asset.currency,values.net,values.tax,values.gross,m.invoice_reference,m.purchase_date]];const content='\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='asset-purchase.csv';a.click();URL.revokeObjectURL(url);}
 const field=(key:string,label:string,type='number')=><label key={key}>{label}<input required type={type} min={type==='number'?0:undefined} step={type==='number'?'any':undefined} value={draft[key]??''} onChange={e=>setDraft({...draft,[key]:type==='number'?Number(e.target.value):e.target.value})}/></label>;
 let preview=null;try{if(draft)preview=assetPurchaseAmounts(draft.purchase_value,draft.vat_input_mode==='PERCENT'?draft.vat_rate:draft.vat_amount,draft.vat_input_mode);}catch{}
 return <section className="card section" aria-label={t('تفاصيل شراء الأصل','Asset purchase details')}>
 <div className="page-head"><h3>{data?.asset.name??t('تفاصيل شراء الأصل','Asset purchase details')}</h3><button type="button" className="btn secondary" disabled={busy} onClick={onClose}>{t('إغلاق','Close')}</button></div>
 {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
 {!data?<p>{t('تحميل…','Loading…')}</p>:<>
 <p><span className="pill">{assetPurchaseStatus(data.event.status,ar)}</span> {data.approved&&data.event.status!=='ACTUAL'?t('تم الاعتماد، بانتظار الترحيل','Approved, awaiting posting'):''}</p>
 <p>{t('قيمة الشراء','Purchase value')}: {Number(data.asset.metadata.purchase_value).toLocaleString()} {data.asset.currency} · {t('الضريبة','VAT')}: {Number(data.asset.metadata.vat_amount??0).toLocaleString()} {data.asset.currency}{data.asset.metadata.vat_input_mode==='PERCENT'?` (${data.asset.metadata.vat_rate}%)`:t(' (مبلغ مسجل)',' (recorded amount)')}</p>
 {data.event.status!=='ACTUAL'&&<small>{t('قيمة المسودة تظهر هنا؛ تدخل أرصدة الأصول بعد الاعتماد والترحيل المالي.','Draft value is shown here and enters asset balances after approval and posting.')}</small>}
 {!data.allowedActions.includes('APPROVE_AND_POST')&&['DRAFT','PLANNED','COMMITTED'].includes(data.event.status)&&<AssetFinancialReview eventId={data.event.id} ar={ar} initialOpen onChanged={()=>{void fetch(`/api/assets/purchase?asset_id=${assetId}`).then(async r=>{const x=await r.json();if(!r.ok)throw Error(x.error);accept(x);onChanged()}).catch(e=>setError(e.message))}}/>}
 <div className="actions" style={{display:'flex',gap:8,flexWrap:'wrap',marginBlock:16}}>
 {data.allowedActions.includes('APPROVE_AND_POST')&&<button type="button" className="btn" disabled={busy} onClick={()=>void request('APPROVE_AND_POST')}>{t('اعتماد وترحيل الأصل','Approve and post asset')}</button>}
 {data.can_edit&&<button type="button" className="btn secondary" disabled={busy} onClick={()=>setEditing(!editing)}>{t('تعديل بيانات الشراء','Edit purchase')}</button>}
 {data.can_archive&&<button type="button" className="btn secondary" disabled={busy} onClick={()=>{if(window.confirm(t('إلغاء مسودة الشراء وإخفاء الأصل؟ يُحفظ سجل التدقيق.','Cancel purchase draft and archive asset? Audit history is retained.')))void request('ARCHIVE')}}>{t('حذف المسودة','Delete draft')}</button>}
 {data.event.status==='ACTUAL'&&data.flow&&Number(data.flow.amount)>Number(data.flow.settled_amount)&&<button type="button" className="btn" disabled={busy} onClick={()=>setPaying(!paying)}>{t('تسجيل سداد','Record payment')}</button>}
 <details><summary className="btn secondary">⎙ {t('طباعة / تصدير','Print / export')}</summary><button type="button" className="btn secondary" onClick={print}>PDF</button><button type="button" className="btn secondary" onClick={csv}>CSV</button></details>
 </div>
 {editing&&<form onSubmit={e=>{e.preventDefault();void request('SAVE')}}><div className="form-grid">
 {field('purchase_value',t('صافي قيمة الشراء','Net purchase value'))}{field('quantity',t('الكمية','Quantity'))}{field('fx_rate',t('سعر الصرف','Exchange rate'))}
 <label>{t('طريقة إدخال الضريبة','VAT entry')}<select value={draft.vat_input_mode} onChange={e=>setDraft({...draft,vat_input_mode:e.target.value})}><option value="PERCENT">{t('نسبة مئوية %','Percentage %')}</option><option value="AMOUNT">{t('مبلغ','Amount')}</option></select></label>
 {draft.vat_input_mode==='PERCENT'?field('vat_rate',t('نسبة الضريبة %','VAT rate %')):field('vat_amount',t('مبلغ الضريبة','VAT amount'))}
 {field('recoverable_percent',t('نسبة الضريبة القابلة للاسترداد %','Recoverable VAT %'))}{field('purchase_date',t('تاريخ الشراء','Purchase date'),'date')}{field('due_date',t('تاريخ الاستحقاق','Due date'),'date')}
 <label>{t('المورد','Supplier')}<select required value={draft.counterparty_id??''} onChange={e=>setDraft({...draft,counterparty_id:e.target.value})}><option value="">—</option>{data.suppliers.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{field('invoice_reference',t('رقم فاتورة المورد','Supplier invoice reference'),'text')}
 </div>{preview&&<p>{t('الضريبة','VAT')}: {preview.tax.toLocaleString()} · {t('الإجمالي','Gross')}: {preview.gross.toLocaleString()} {data.asset.currency}</p>}<button className="btn" disabled={busy||!preview}>{t('حفظ المسودة','Save draft')}</button></form>}
 {paying&&<form onSubmit={e=>{e.preventDefault();void request('PAY')}}><div className="form-grid"><label>{t('حساب السداد','Payment account')}<select required value={bank} onChange={e=>setBank(e.target.value)}><option value="">—</option>{data.banks.filter((b:any)=>b.currency===data.flow.currency).map((b:any)=><option key={b.id} value={b.id}>{b.name} · {b.currency}</option>)}</select></label><label>{t('مبلغ السداد','Payment amount')}<input type="number" required min="0.01" step="0.01" max={Number(data.flow.amount)-Number(data.flow.settled_amount)} value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>{t('تاريخ السداد','Payment date')}<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label></div><button className="btn" disabled={busy}>{t('تأكيد السداد','Confirm payment')}</button></form>}
 {data.flow&&<p>{t('المسدد','Paid')}: {Number(data.flow.settled_amount??0).toLocaleString()} · {t('المتبقي','Outstanding')}: {Math.max(0,Number(data.flow.amount)-Number(data.flow.settled_amount)).toLocaleString()} {data.flow.currency}</p>}
 </>}
 </section>;
}
