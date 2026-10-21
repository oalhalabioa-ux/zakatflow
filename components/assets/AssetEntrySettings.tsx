'use client';
import {assetTaxCategories} from '@/lib/asset-entry-tax';
export default function AssetEntrySettings({form,onChange,ar,edit,locked}:{form:any;onChange:(value:any)=>void;ar:boolean;edit:boolean;locked:boolean}){
 const purchase=!edit&&form.acquisition_mode==='PURCHASE'&&form.ownership_scope==='ORGANIZATION',category=form.tax_category||'S';
 const taxLabel=assetTaxCategories.find(([code])=>code===category)?.[ar?1:2];
 return <details className="asset-entry-settings" data-testid="asset-entry-settings"><summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 3-1 3-3 1v4l2 1-2 2v4l3 1 1 3h5l1-3 3-1v-4l-2-2 2-1V7l-3-1-1-3H9Z"/><circle cx="11.5" cy="12.5" r="3"/></svg><span>{ar?'إعدادات العملة والضريبة':'Currency & tax settings'}</span><small>{form.currency}{purchase?` · ${taxLabel}${category==='S'&&form.vat_input_mode==='PERCENT'?` ${form.vat_rate}%`:''}`:''}</small></summary>
 <fieldset disabled={locked}><div className="form-grid">
 <label>{ar?'عملة الأصل *':'Asset currency *'}<select data-testid="asset-entry-currency" value={form.currency} onChange={e=>onChange({...form,currency:e.target.value,funding_account_id:''})}>{['SAR','USD','AED','EUR','GBP','KWD','BHD','QAR','OMR','JOD','EGP'].map(c=><option key={c}>{c}</option>)}</select></label>
 {purchase&&<>
 <label>{ar?'التصنيف الضريبي *':'Tax category *'}<select data-testid="asset-entry-tax-category" value={category} onChange={e=>onChange({...form,tax_category:e.target.value,vat_input_mode:'PERCENT',vat_rate:e.target.value==='S'?'15':'0',vat_amount:'0',recoverable_percent:e.target.value==='S'?'100':'0',tax_exemption_reason_code:'',tax_exemption_reason:''})}>{assetTaxCategories.map(([code,a,en])=><option key={code} value={code}>{ar?a:en}</option>)}</select></label>
 {category==='S'&&<>
 <label>{ar?'إدخال الضريبة':'VAT entry'}<select value={form.vat_input_mode} onChange={e=>onChange({...form,vat_input_mode:e.target.value})}><option value="PERCENT">{ar?'نسبة %':'Percentage %'}</option><option value="AMOUNT">{ar?'مبلغ':'Amount'}</option></select></label>
 <label>{form.vat_input_mode==='PERCENT'?(ar?'نسبة الضريبة %':'VAT rate %'):(ar?'مبلغ الضريبة':'VAT amount')}<input data-testid="asset-entry-tax-value" type="number" required min={form.vat_input_mode==='PERCENT'?'0.00000001':'0.01'} max={form.vat_input_mode==='PERCENT'?'100':undefined} step="any" value={form.vat_input_mode==='PERCENT'?form.vat_rate:form.vat_amount} onChange={e=>onChange({...form,[form.vat_input_mode==='PERCENT'?'vat_rate':'vat_amount']:e.target.value})}/></label>
 <label>{ar?'نسبة الضريبة القابلة للاسترداد %':'Recoverable VAT %'}<input type="number" required min="0" max="100" step="any" value={form.recoverable_percent} onChange={e=>onChange({...form,recoverable_percent:e.target.value})}/></label>
 </>}
 {['Z','E'].includes(category)&&<>
 <label>{ar?'رمز سبب المعاملة الضريبية *':'Tax treatment reason code *'}<input data-testid="asset-entry-tax-reason-code" required pattern={'.*\\S.*'} maxLength={20} dir="ltr" value={form.tax_exemption_reason_code||''} onChange={e=>onChange({...form,tax_exemption_reason_code:e.target.value})}/></label>
 <label>{ar?'وصف سبب المعاملة الضريبية *':'Tax treatment reason *'}<input data-testid="asset-entry-tax-reason" required pattern={'.*\\S.*'} maxLength={500} value={form.tax_exemption_reason||''} onChange={e=>onChange({...form,tax_exemption_reason:e.target.value})}/></label>
 </>}
 </>}
 </div></fieldset></details>;
}
