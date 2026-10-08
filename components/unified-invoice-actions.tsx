'use client';
import { FormEvent, useEffect, useState } from 'react';
import { VatEInvoiceRegister } from './vat-einvoice-register';
import { VatInvoiceReceipts } from './vat-invoice-receipts';
import { VatContactPicker } from './vat-contact-picker';
import { invoicePrintHtml } from '@/lib/vat-invoice-print';
import { calculateVatDocumentLines, type VatDocumentLineInput } from '@/lib/vat-document-lines';
import { vatNoteMessages } from '@/lib/vat-note-messages';
import type { UnifiedInvoice } from '@/lib/unified-invoice-register';
type Account = { id: string; name: string; currency: string };
type Detail = { document: any; profile: any; organization: {name:string;base_currency:string}; is_admin:boolean };
export function UnifiedInvoiceActions({ row, organizationId, ar, onClose, onChanged }: { row: UnifiedInvoice; organizationId:string; ar:boolean; onClose:()=>void; onChanged:()=>void }) {
  const [detail,setDetail] = useState<Detail|null>(null);
  const [accounts,setAccounts] = useState<Account[]>([]);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState<{error:boolean;text:string}|null>(null);
  const [revision,setRevision] = useState(0);
  const [editing,setEditing] = useState<any|null>(null);
  const [lines,setLines] = useState<VatDocumentLineInput[]>([]);
  const [receipts,setReceipts] = useState(false);
  const [paying,setPaying] = useState(false);
  const [electronicOpen,setElectronicOpen] = useState(Boolean(row.electronicId));
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setDetail(null);
    async function load() {
      const [docResponse,cashResponse] = await Promise.all([
        fetch(`/api/vat/register/document?organization_id=${encodeURIComponent(organizationId)}${row.documentId?'&document_id='+encodeURIComponent(row.documentId):''}`,{signal:controller.signal,cache:'no-store'}),
        fetch(`/api/liquidity?organization_id=${encodeURIComponent(organizationId)}`,{signal:controller.signal,cache:'no-store'}),
      ]);
      if (!docResponse.ok) throw new Error('REGISTER_LOAD_FAILED');
      const body = await docResponse.json();
      const cash = cashResponse.ok ? await cashResponse.json() : {accounts:[]};
      if (!controller.signal.aborted) { setDetail(body);setAccounts(cash.accounts || []); }
    }
    void load().catch(() => {if(!controller.signal.aborted)setMessage({error:true,text:ar?'تعذر تحميل إجراءات المستند.':'Could not load document actions.'});}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[organizationId,row.documentId,ar,revision]);
  const doc = detail?.document;
  const outstanding = row.flow ? Math.max(0,Number(row.flow.amount)-Number(row.flow.settled_amount)) : 0;
  function errorText(code:string) {
    const labels: Record<string,[string,string]> = {...vatNoteMessages,VAT_DOCUMENT_SETTLED_LOCKED:['الفاتورة لها تسويات؛ راجع الإشعار التصحيحي.','Invoice has settlements; use a correction note.'],VAT_FINANCIAL_EVENT_LOCKED:['الأثر المالي معتمد؛ لا يمكن تعديل هذه المسودة.','Financial recognition is approved; this draft cannot be amended.'],VAT_DOCUMENT_ZATCA_LOCKED:['الفاتورة مصدرة؛ استخدم إشعارًا مرتبطًا.','Invoice is issued; use a linked note.']};
    return labels[code]?.[ar?0:1] || `${ar?'تعذر تنفيذ الإجراء':'Action could not be completed'} (${code})`;
  }
  function changed() { onChanged();setRevision(v=>v+1); }
  async function action(url:string,method:string,body?:unknown) {
    if(busy)return;
    setBusy(true);setMessage(null);
    try {
      const response=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error || 'REQUEST_FAILED');
      setMessage({error:false,text:response.status===202?(ar?'الإجراء بانتظار الموافقة المالية؛ راجع حالته قبل إعادة التنفيذ.':'Action awaits financial approval; review its state before retrying.'):(ar?'تم حفظ الإجراء وتحديث السجل.':'Action saved and register refreshed.')});
      setEditing(null);setPaying(false);changed();if(method==='DELETE')onClose();
    } catch(error) {setMessage({error:true,text:errorText(error instanceof Error?error.message:'REQUEST_FAILED')});}
    finally {setBusy(false);}
  }
  function startEdit(kind='INVOICE') {
    if(!doc)return;
    const rate=Number(doc.exchange_rate || 1), note=kind!=='INVOICE';
    setEditing({...doc,document_kind:kind,document_number:note?`${doc.document_number}-${kind==='CREDIT_NOTE'?'CN':'DN'}`:doc.document_number,transaction_date:note?new Date().toISOString().slice(0,10):doc.transaction_date,due_date:note?new Date().toISOString().slice(0,10):(doc.due_date || doc.transaction_date),net_amount:note?'':String(doc.source_net_amount ?? doc.net_amount),currency:doc.source_currency || doc.currency,notes:note?'':doc.notes || '',...(note?{preceding_document_id:doc.id}:{})});
    setLines(note?[]:(doc.line_items || []).map((line:any)=>({description:line.description || '',unit:line.unit || '',quantity:String(line.quantity || 1),unit_price:String(line.source_unit_price ?? Number(line.unit_price || 0)/rate),discount_amount:String(line.source_discount_amount ?? Number(line.discount_amount || 0)/rate),supply_type:line.supply_type || 'STANDARD'})));
  }
  function saveEdit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!editing)return;
    try {
      const calculated=lines.length?calculateVatDocumentLines(lines,detail?.profile?.standard_rate || 15):null;
      void action('/api/vat','POST',{...editing,action:editing.document_kind==='INVOICE'?'update_document':'add_document',document_id:doc.id,organization_id:organizationId,net_amount:Number(calculated?.netAmount ?? editing.net_amount),lines:lines.length?lines:undefined,asset_transaction_id:null});
    } catch(error) {setMessage({error:true,text:errorText(error instanceof Error?error.message:'REQUEST_FAILED')});}
  }
  function print() {
    if(!doc || !detail)return;
    const popup=window.open('','_blank');if(!popup){setMessage({error:true,text:ar?'اسمح بالنوافذ المنبثقة للطباعة.':'Allow pop-ups to print.'});return;}popup.opener=null;
    const fx=Number(doc.exchange_rate || 1), profile=detail.profile || {};
    const own={name:profile.registered_name || detail.organization.name,vat:profile.tax_registration_number,street:profile.seller_street,city:profile.seller_city,building:profile.seller_building_number,district:profile.seller_district,postal:profile.seller_postal_code};
    const party={name:doc.counterparty_name,vat:doc.counterparty_tax_number};
    popup.document.write(invoicePrintHtml({number:doc.document_number,date:doc.transaction_date,due:doc.due_date,currency:doc.source_currency || doc.currency,exchangeRate:fx,baseCurrency:detail.organization.base_currency,title:ar?'نسخة سجل المستند':'Document register copy',draft:doc.zatca_status==='DRAFT',recordCopy:true,seller:row.side==='PURCHASE'?party:own,buyer:row.side==='PURCHASE'?own:party,net:doc.source_net_amount ?? doc.net_amount,tax:doc.source_tax_amount ?? doc.tax_amount,total:doc.source_gross_amount ?? doc.gross_amount,note:doc.notes,lines:(doc.line_items || []).map((line:any)=>({name:line.description || '',quantity:line.quantity,unitPrice:line.source_unit_price ?? Number(line.unit_price || 0)/fx,discount:line.source_discount_amount ?? Number(line.discount_amount || 0)/fx,net:line.source_net_amount ?? Number(line.net_amount || 0)/fx,tax:line.source_tax_amount ?? Number(line.tax_amount || 0)/fx,total:line.source_gross_amount ?? Number(line.gross_amount || 0)/fx}))},ar));popup.document.close();
  }
  function pay(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!row.flow)return;
    const form=new FormData(event.currentTarget),amount=Number(form.get('amount'));
    if(!(amount>0) || amount>outstanding){setMessage({error:true,text:ar?'المبلغ يجب أن يكون أكبر من صفر ولا يتجاوز المتبقي.':'Amount must be positive and within the outstanding balance.'});return;}
    void action(`/api/liquidity/${row.flow.id}`,'PATCH',{status:'ACTUAL',amount,account_id:form.get('account_id'),settlement_date:form.get('date')});
  }
  return <section className="vat-unified-details vat-unified-action-panel" aria-busy={loading||busy}><div className="vat-panel-head"><div><h3>{ar?'إجراءات المستند':'Document actions'} · {row.number}</h3><p>{ar?'تنفذ الإجراءات بنفس صلاحيات واعتمادات الشاشة الأصلية.':'Actions use the same permissions and approvals as the original workspace.'}</p></div><button type="button" className="vat-button secondary" disabled={busy} onClick={onClose}>{ar?'إغلاق':'Close'}</button></div>
    {message && <p role={message.error?'alert':'status'} className={`vat-notice ${message.error?'error':'success'}`}>{message.text}</p>}
    {loading?<p role="status">{ar?'جارٍ التحميل…':'Loading…'}</p>:detail && <>
      {!row.electronicId && doc && <div className="vat-unified-actions">
        <button type="button" className="vat-button secondary" onClick={print}>{ar?'طباعة / PDF':'Print / PDF'}</button>
        {detail.is_admin && row.kind==='INVOICE' && !doc.asset_transaction_id && <button type="button" className="vat-button secondary" disabled={busy} onClick={()=>startEdit()}>{ar?'تعديل الفاتورة':'Edit invoice'}</button>}
        {detail.is_admin && row.accountingStatus!=='ACTUAL' && <button type="button" className="vat-button secondary" disabled={busy} onClick={()=>void action(row.kind==='INVOICE'?'/api/vat/recognition':'/api/vat/notes','POST',{organization_id:organizationId,document_id:doc.id})}>{ar?'اعتماد المحاسبة':'Post accounting'}</button>}
        {row.side==='SALES' && row.kind==='INVOICE' && <button type="button" className="vat-button secondary" onClick={()=>setReceipts(true)}>{ar?'سندات القبض':'Receipts'}</button>}
        {detail.is_admin && row.flow && outstanding>0 && <button type="button" className="vat-button primary" disabled={busy} onClick={()=>setPaying(true)}>{row.flow.direction==='OUTFLOW'?(ar?'سداد / تسوية':'Pay / settle'):(ar?'قبض / تسوية':'Collect / settle')}</button>}
        {detail.is_admin && row.side==='PURCHASE' && row.kind==='INVOICE' && <><button type="button" className="vat-button secondary" onClick={()=>startEdit('CREDIT_NOTE')}>{ar?'إشعار دائن مرتبط':'Linked credit note'}</button><button type="button" className="vat-button secondary" onClick={()=>startEdit('DEBIT_NOTE')}>{ar?'إشعار مدين مرتبط':'Linked debit note'}</button></>}
        {detail.is_admin && <button type="button" className="vat-button vat-action-danger" disabled={busy} onClick={()=>{if(window.confirm(ar?'حذف المسودة؟ المستندات المعتمدة محمية من الحذف.':'Delete draft? Approved documents are protected.'))void action(`/api/vat?organization_id=${encodeURIComponent(organizationId)}&document_id=${encodeURIComponent(doc.id)}`,'DELETE');}}>{ar?'حذف المسودة':'Delete draft'}</button>}
      </div>}
      {row.side==='SALES' && (row.electronicId || row.kind==='INVOICE') && <><button type="button" className="vat-button secondary" aria-expanded={electronicOpen} onClick={()=>setElectronicOpen(v=>!v)}>{ar?'الفاتورة الإلكترونية والإشعارات':'Electronic invoice and notes'}</button>{electronicOpen && <VatEInvoiceRegister organizationId={organizationId} ar={ar} vatNumber={detail.profile?.tax_registration_number || ''} standardTaxRate={Number(detail.profile?.standard_rate || 15)} registered={detail.profile?.registration_status==='REGISTERED'} sellerProfile={{registered_name:detail.profile?.registered_name || detail.organization.name,seller_street:detail.profile?.seller_street || '',seller_building_number:detail.profile?.seller_building_number || '',seller_district:detail.profile?.seller_district || '',seller_additional_number:detail.profile?.seller_additional_number || '',seller_city:detail.profile?.seller_city || '',seller_postal_code:detail.profile?.seller_postal_code || ''}} registerTarget={{electronicId:row.electronicId,documentId:row.documentId}} onInvoiceIssued={changed} />}</>}
      {receipts && doc && <VatInvoiceReceipts organizationId={organizationId} documentId={doc.id} invoiceNumber={doc.document_number} accounts={accounts} canEdit={detail.is_admin} ar={ar} onClose={()=>setReceipts(false)} onPosted={changed} />}
      {paying && row.flow && <form className="vat-form-grid" onSubmit={pay}><h4>{ar?'تأكيد القبض / السداد':'Confirm collection / payment'} · {row.flow.currency}</h4><label>{ar?'المبلغ':'Amount'}<input name="amount" type="number" min="0.01" step="0.01" max={outstanding} defaultValue={outstanding} required /></label><label>{ar?'الحساب':'Account'}<select name="account_id" required><option value="">{ar?'اختر حسابًا':'Choose account'}</option>{accounts.filter(a=>a.currency===row.flow?.currency).map(a=><option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></label><label>{ar?'تاريخ التسوية':'Settlement date'}<input name="date" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label><button type="submit" className="vat-button primary" disabled={busy}>{ar?'تأكيد وحفظ':'Confirm and save'}</button><button type="button" className="vat-button secondary" disabled={busy} onClick={()=>setPaying(false)}>{ar?'إلغاء':'Cancel'}</button></form>}
      {editing && <form className="vat-form-grid" onSubmit={saveEdit}><h4>{editing.document_kind==='INVOICE'?(ar?'تعديل الفاتورة':'Edit invoice'):(ar?'إشعار مرتبط بالفاتورة الأصلية':'Note linked to original invoice')}</h4><label>{ar?'رقم المستند':'Document number'}<input value={editing.document_number} required onChange={e=>setEditing({...editing,document_number:e.target.value})}/></label><label>{ar?'تاريخ المستند':'Document date'}<input type="date" value={editing.transaction_date} required onChange={e=>setEditing({...editing,transaction_date:e.target.value})}/></label><label>{ar?'الاستحقاق':'Due date'}<input type="date" min={editing.transaction_date} value={editing.due_date || editing.transaction_date} required onChange={e=>setEditing({...editing,due_date:e.target.value})}/></label>
        {editing.document_kind==='INVOICE'?<VatContactPicker organizationId={organizationId} role={row.side==='SALES'?'CUSTOMER':'SUPPLIER'} ar={ar} label={ar?'العميل / المورد':'Customer / supplier'} value={editing.counterparty_contact_id || ''} required onChange={contact=>setEditing({...editing,counterparty_contact_id:contact?.id || '',counterparty_name:contact?.name || '',counterparty_tax_number:contact?.vat_number || null})}/>:<p>{editing.counterparty_name} · {editing.currency} · {ar?'الأصل':'Original'}: {doc.document_number}</p>}
        <label>{ar?'العملة':'Currency'}<input value={editing.currency} readOnly /></label><label>{ar?'سعر الصرف':'FX rate'}<input value={editing.exchange_rate || 1} readOnly /></label>
        {lines.length ? <div className="vat-unified-edit-lines"><button type="button" className="vat-button secondary" onClick={()=>setLines(current=>[...current,{description:'',unit:'',quantity:1,unit_price:0,discount_amount:0,supply_type:'STANDARD'}])}>{ar?'إضافة بند':'Add line'}</button>{lines.map((line,index)=><div className="vat-form-grid" key={index}><label>{ar?'البيان':'Description'}<input value={line.description} required onChange={e=>setLines(current=>current.map((l,i)=>i===index?{...l,description:e.target.value}:l))}/></label>{(['quantity','unit_price','discount_amount'] as const).map(key=><label key={key}>{key==='quantity'?(ar?'الكمية':'Quantity'):key==='unit_price'?(ar?'سعر الوحدة':'Unit price'):(ar?'الخصم':'Discount')}<input type="number" min={key==='quantity'?'0.000001':'0'} step="any" value={line[key] || 0} required onChange={e=>setLines(current=>current.map((l,i)=>i===index?{...l,[key]:e.target.value}:l))}/></label>)}<label>{ar?'الوحدة':'Unit'}<input value={line.unit || ''} onChange={e=>setLines(current=>current.map((l,i)=>i===index?{...l,unit:e.target.value}:l))}/></label><label>{ar?'المعاملة الضريبية':'Tax treatment'}<select value={line.supply_type} onChange={e=>setLines(current=>current.map((l,i)=>i===index?{...l,supply_type:e.target.value as VatDocumentLineInput['supply_type']}:l))}>{['STANDARD','ZERO_RATED','EXEMPT','OUT_OF_SCOPE'].map(value=><option key={value} value={value}>{value==='STANDARD'?(ar?'قياسية':'Standard'):value==='ZERO_RATED'?(ar?'صفرية':'Zero rated'):value==='EXEMPT'?(ar?'معفاة':'Exempt'):(ar?'خارج النطاق':'Out of scope')}</option>)}</select></label><button type="button" className="vat-button secondary" disabled={lines.length===1} onClick={()=>setLines(current=>current.filter((_,i)=>i!==index))}>{ar?'حذف البند':'Remove line'}</button></div>)}</div>:<><label>{ar?'الصافي قبل الضريبة':'Net before VAT'}<input type="number" min="0" step="0.01" value={editing.net_amount} required onChange={e=>setEditing({...editing,net_amount:e.target.value})}/></label><label>{ar?'المعاملة الضريبية':'Tax treatment'}<select value={editing.supply_type} onChange={e=>setEditing({...editing,supply_type:e.target.value})}>{['STANDARD','ZERO_RATED','EXEMPT','OUT_OF_SCOPE'].map(value=><option key={value} value={value}>{value==='STANDARD'?(ar?'قياسية':'Standard'):value==='ZERO_RATED'?(ar?'صفرية':'Zero rated'):value==='EXEMPT'?(ar?'معفاة':'Exempt'):(ar?'خارج النطاق':'Out of scope')}</option>)}</select></label></>}
        <label>{ar?'نسبة خصم ضريبة المدخلات':'Input VAT recovery %'}<input type="number" min="0" max="100" value={editing.recoverable_percent ?? 100} readOnly={editing.document_kind!=='INVOICE'||row.side==='SALES'} onChange={e=>setEditing({...editing,recoverable_percent:e.target.value})}/></label><label>{ar?'ملاحظات / سبب الإشعار':'Notes / note reason'}<textarea value={editing.notes || ''} required={editing.document_kind!=='INVOICE'} onChange={e=>setEditing({...editing,notes:e.target.value})}/></label><button type="submit" className="vat-button primary" disabled={busy}>{ar?'حفظ':'Save'}</button><button type="button" className="vat-button secondary" disabled={busy} onClick={()=>setEditing(null)}>{ar?'إلغاء':'Cancel'}</button>
      </form>}
    </>}
  </section>;
}
