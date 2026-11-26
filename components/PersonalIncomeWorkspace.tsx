'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import PersonalIncomeEvidence from './PersonalIncomeEvidence';
import {calculateVatDocumentLines} from '@/lib/vat-document-lines';

type Profile={seller_name:string;vat_number:string|null;effective_from:string|null};
type RecordRow={invoice_number:number|null;issued_at:string|null;seller_address:string|null;seller_vat_number:string|null;receivable_id:string|null;personal_income_evidence:Array<{request_id:string;reference:string;filename:string}>;id:string;serial:number;kind:'SIMPLIFIED_INVOICE'|'FEE_INVOICE'|'TAX_DRAFT'|'EXTERNAL_EVIDENCE';document_date:string;seller_name:string;customer:string;description:string;source_reference:string|null;net_amount:number;tax_amount:number;gross_amount:number};
type Register={issuer:{vat_number:string;valid_from:string;valid_until:string}|null;profile:Profile|null;documents:RecordRow[]};
export default function PersonalIncomeWorkspace({ar}:{ar:boolean}){
  const t=(arabic:string,english:string)=>ar?arabic:english;
  const [register,setRegister]=useState<Register|null>(null),[mode,setMode]=useState<'PROFILE'|'INVOICE'|'EVIDENCE'>('INVOICE');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const [date,setDate]=useState(''),[net,setNet]=useState(''),[taxable,setTaxable]=useState(true);
  const [simplified,setSimplified]=useState(false);
  const [linked,setLinked]=useState('');
  const target=register?.documents.find(d=>d.id===linked);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Riyadh'}).format(new Date());
  const issuer=register?.issuer;
  const canIssue=Boolean(issuer&&issuer.vat_number===register?.profile?.vat_number&&today>=issuer.valid_from&&today<=issuer.valid_until);
  const [referenceTax,setReferenceTax]=useState('0');
  const request=useRef<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/personal-income',{signal:controller.signal,cache:'no-store'}).then(async response=>{
      if(!response.ok)throw Error();
      const data:Register=await response.json();
      if(!controller.signal.aborted){setRegister(data);if(!data.profile)setMode('PROFILE')}
    }).catch(()=>{if(!controller.signal.aborted)setError('LOAD')});
    return ()=>controller.abort();
  },[reload]);
  const registered=Boolean(register?.profile?.effective_from && date>=register.profile.effective_from);
  const validNet=/^\d{1,12}(\.\d{1,2})?$/.test(net);
  const totals=calculateVatDocumentLines([{description:'',quantity:1,unit_price:validNet?net:'0',supply_type:registered&&taxable?'STANDARD':'OUT_OF_SCOPE'}],15);
  const kind=(k:RecordRow['kind'])=>k==='SIMPLIFIED_INVOICE'?t('فاتورة ضريبية مبسطة','Simplified tax invoice'):k==='FEE_INVOICE'?t('فاتورة أتعاب','Fee invoice'):k==='TAX_DRAFT'?t('مسودة فاتورة ضريبية','Tax invoice draft'):t('سند إثبات إيراد','Income evidence');
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;
    const form=event.currentTarget,fd=new FormData(form),field=(key:string)=>String(fd.get(key)||'').trim();
    request.current??=crypto.randomUUID();setBusy(true);setError('');
    const body=mode==='PROFILE'?{action:mode,seller_name:field('seller'),vat_number:field('vat')||null,effective_from:field('effective')||null}:
      {action:mode==='INVOICE'&&registered&&canIssue&&simplified&&taxable?'SIMPLIFIED':mode,request:request.current,date,customer:field('customer'),description:field('description'),reference:mode==='EVIDENCE'?field('reference'):null,net,tax:mode==='EVIDENCE'?referenceTax:totals.taxAmount};
    try{
      const response=await fetch('/api/personal-income',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok){setError(data.error);return}
      setSimplified(false);form.reset();request.current=null;setNet('');setReferenceTax('0');setDate('');setMode('INVOICE');setRegister(null);setReload(n=>n+1);
    }catch{setError('RETRY')}finally{setBusy(false)}
  }
  const input=(name:string,label:string,props:React.InputHTMLAttributes<HTMLInputElement>={})=><label>{label}<input name={name} required {...props}/></label>;
  return <main className="container vat-page" dir={ar?'rtl':'ltr'}>
    <style>{`@media print {body:has(.printing-personal-income) * {visibility:hidden} .printing-personal-income,.printing-personal-income * {visibility:visible!important} .printing-personal-income {position:absolute;inset:0;background:white} .printing-personal-income .income-document-actions {display:none}}`}</style>
    <header className="vat-header"><h1>{t('الإيرادات والفوترة الشخصية','Personal income and invoicing')}</h1></header>
    {error&&<p role="alert">{error==='REFERENCE_EXISTS'?t('سُجّل هذا المرجع للعميل سابقًا.','This customer reference already exists.'):error==='LOAD'?t('تعذّر تحميل السجل.','Unable to load the register.'):error==='RETRY'?t('تعذر تأكيد الحفظ. أعد المحاولة بالبيانات نفسها.','Save could not be confirmed. Retry with the same details.'):t('تعذّر الحفظ. راجع البيانات والتسجيل الضريبي.','Unable to save. Check the fields and tax registration.')}
      {error==='LOAD'&&<button onClick={()=>{setError('');setReload(n=>n+1)}}>{t('إعادة المحاولة','Retry')}</button>}</p>}
    {register&&<>
    <nav className="vat-form-actions">{(['INVOICE','EVIDENCE','PROFILE'] as const).map((m,i)=><button key={m} disabled={busy||(!register.profile&&m!=='PROFILE')} aria-pressed={mode===m} onClick={()=>{setMode(m);setError('');request.current=null}}>{[t('إصدار فاتورة','Issue invoice'),t('إثبات إيراد','Record income evidence'),t('ملفي الضريبي','My tax profile')][i]}</button>)}</nav>
    {mode==='EVIDENCE'&&<label>{t('مصدر إثبات الإيراد','Evidence source')}<select value={linked} onChange={e=>setLinked(e.target.value)}>
      <option value="">{t('مستند خارجي جديد','New external document')}</option>
      {register.documents.filter(row=>row.receivable_id).map(row=><option key={row.id} value={row.id}>{t('إرفاق فقط','Attach only')} · {row.serial} · {row.customer}</option>)}
    </select></label>}
    {mode==='EVIDENCE'&&target?<PersonalIncomeEvidence documentId={target.id} ar={ar} attachments={target.personal_income_evidence} onSaved={()=>setReload(n=>n+1)}/>:<form key={mode} className="vat-panel" onSubmit={save}><fieldset disabled={busy} className="vat-form-grid">
      {mode==='PROFILE'?<>
        {input('seller',t('الاسم المهني للبائع','Seller legal name'),{defaultValue:register.profile?.seller_name,maxLength:200})}
        {input('vat',t('الرقم الضريبي للمسجّل','VAT number if registered'),{required:false,pattern:'3[0-9]{13}3',defaultValue:register.profile?.vat_number||''})}
        {input('effective',t('تاريخ سريان التسجيل','Registration effective date'),{type:'date',required:false,defaultValue:register.profile?.effective_from||''})}
      </>:<>
        {input('customer',t('العميل أو الجهة','Customer or payer'),{maxLength:200})}
        {input('date',t('تاريخ المستند','Document date'),{type:'date',value:date,onChange:e=>setDate(e.target.value)})}
        {input('description',t('بيان الخدمة أو الإيراد','Service or income description'),{maxLength:500})}
        {input('net',t('المبلغ قبل الضريبة بالريال','Net amount in SAR'),{type:'number',min:'0.01',step:'0.01',value:net,onChange:e=>setNet(e.target.value)})}
        {mode==='EVIDENCE'?<>
          {input('reference',t('مرجع المستند الأصلي','Original document reference'),{maxLength:200})}
          {input('tax',t('الضريبة في المستند الأصلي (ريال)','VAT on original document (SAR)'),{type:'number',min:0,step:'0.01',value:referenceTax,onChange:e=>setReferenceTax(e.target.value)})}
          <p>{t('استخدم هذا المسار لمستند سابق أو لإيراد لا يتطلب إصدار فاتورة ضريبية.','Use this for an existing document or income that requires no tax invoice.')}</p>
        </>:<>
          {registered&&<label><input type="checkbox" checked={taxable} onChange={e=>setTaxable(e.target.checked)}/>{t('الخدمة خاضعة للنسبة الأساسية','Service subject to the standard VAT rate')}</label>}
          <p>{t('الضريبة','VAT')} {totals.taxAmount} · {t('الإجمالي','Total')} {totals.grossAmount} SAR</p>
          {registered&&canIssue&&taxable&&<label><input type="checkbox" checked={simplified} onChange={e=>setSimplified(e.target.checked)}/>{t('إصدار مبسّط لمستهلك نهائي · المرحلة الأولى','Issue a Phase 1 simplified invoice for an end consumer')}</label>}
          {registered&&!(canIssue&&simplified&&taxable)&&<p>{t('تُحفظ مسودة للمراجعة. الإصدار الضريبي الإلكتروني قيد التكامل.','Saved for review. Electronic tax issuance is pending integration.')}</p>}
        </>}
      </>}
      <button className="vat-button primary">{mode==='PROFILE'?t('حفظ الملف','Save profile'):mode==='EVIDENCE'?t('حفظ سند الإثبات','Save evidence'):registered&&canIssue&&simplified&&taxable?t('إصدار الفاتورة المبسطة','Issue simplified invoice'):registered?t('حفظ مسودة ضريبية','Save tax draft'):t('إصدار فاتورة أتعاب','Issue fee invoice')}</button>
    </fieldset></form>}
    <section className="vat-panel"><h2>{t('آخر 100 مستند','Latest 100 documents')}</h2>
      {register.documents.map(row=><details key={row.id}><summary>{kind(row.kind)} #{row.invoice_number??row.serial} · {row.customer} · {row.gross_amount} SAR</summary>
      <p>{row.seller_name} · {row.document_date} · {row.description}</p><p>{t('صافي','Net')} {row.net_amount} · {t('ضريبة','VAT')} {row.tax_amount}</p>{row.source_reference&&<p>{row.source_reference}</p>}
      {row.issued_at&&<section lang="ar"><strong>فاتورة ضريبية مبسطة</strong><p>البائع {row.seller_name} · الرقم الضريبي {row.seller_vat_number} · {row.seller_address}</p><p>رقم الفاتورة {row.invoice_number} · تاريخ الإصدار {new Date(row.issued_at).toLocaleString('ar-SA-u-ca-gregory',{timeZone:'Asia/Riyadh'})} · تاريخ التوريد {row.document_date}</p><p>الخدمة {row.description} · الكمية 1 · سعر الوحدة {row.net_amount} ريال · نسبة الضريبة 15% · الضريبة {row.tax_amount} ريال · الإجمالي {row.gross_amount} ريال</p><img alt="QR" width="150" height="150" src={`/api/personal-income/qr?id=${row.id}`}/></section>}
      <div className="income-document-actions">
        {row.receivable_id&&<a href={`/${ar?'ar':'en'}/receivables?scope=PERSONAL&collect=${row.receivable_id}`}>{t('التحصيل من الذمم الشخصية','Collect in personal receivables')}</a>}
        {(row.kind==='FEE_INVOICE'||row.kind==='SIMPLIFIED_INVOICE')&&<button onClick={event=>{
          const doc=event.currentTarget.closest('details');if(!doc)return;
          doc.classList.add('printing-personal-income');
          const cleanup=()=>doc.classList.remove('printing-personal-income');
          window.addEventListener('afterprint',cleanup,{once:true});window.print();
        }}>{t('طباعة الفاتورة','Print invoice')}</button>}
        <PersonalIncomeEvidence documentId={row.id} ar={ar} attachments={row.personal_income_evidence} onSaved={()=>setReload(n=>n+1)}/>
      </div></details>)}
    </section></>}
  </main>
}
