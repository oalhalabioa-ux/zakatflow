'use client';

import {ASSET_LIFECYCLE_POSTING_TEMPLATES} from '../../lib/financial-asset-posting-templates';
import {useEffect,useState} from 'react';
import type {RecognitionEvent} from '../../lib/financial-event-ledger';
import {
 detailedPostingDraft,isPostingLeaf,validateDetailedPostingRule,voucherCashSide,
 type DetailedPostingChartAccount,type PostingRuleForValidation,
} from '../../lib/financial-posting-rule-validation';
import './posting-rules.css';

export type EditablePostingRule=PostingRuleForValidation&{
 debitAccountId:string;creditAccountId:string;
 cashActivity?:'OPERATING'|'INVESTING'|'FINANCING';detailed?:true;
};
type Account=DetailedPostingChartAccount&{code:string;ar:string;en:string};
type Voucher=RecognitionEvent&{voucherCashAccount?:string|null};
const labels:Record<string,[string,string]>={
 ...Object.fromEntries(ASSET_LIFECYCLE_POSTING_TEMPLATES.map(t=>[t.role,[t.ar,t.en] as [string,string]])),
 FINANCE_PRINCIPAL_PAYMENT:['سداد / تحصيل أصل التمويل','Financing principal settlement'],FINANCE_CHARGE_PAYMENT:['سداد / تحصيل تكلفة أو عائد التمويل','Financing charge or return settlement'],
 DEBT_CONTRACTS:['القروض والذمم','Loans and obligations'],DEBT_FUNDED_O_AR_LOAN:['صرف قرض ممنوح','Fund a loan receivable'],DEBT_FUNDED_O_AP_LOAN:['قبض تمويل قرض','Receive loan funding'],DEBT_FUNDED_O_AR_EMPLOYEE:['صرف سلفة موظف','Fund an employee advance'],
 ADVANCE_WORKSPACE:['الدفعات المقدمة','Advances'],FINANCE_CONTRACTS:['تكاليف وعوائد التمويل','Financing charges and returns'],
 ASSETS_INTEGRATION:['اقتناء الأصول','Asset acquisition'],
 ASSET_LIFECYCLE:['دورة الأصول','Asset lifecycle'],ADJUSTMENT:['تسوية محاسبية','Accounting adjustment'],ASSET_PURCHASE:['شراء أصل','Asset purchase'],
 OPERATIONAL_CONSOLE:['العمليات','Operations'],VAT_INTEGRATION:['الضريبة','Tax'],
 LEGACY_CASH:['السيولة','Liquidity'],LEGACY_ASSET:['الأصول','Assets'],
 REVENUE:['إثبات إيراد','Recognize revenue'],EXPENSE:['إثبات مصروف','Recognize expense'],
 SETTLEMENT:['تسوية','Settlement'],TRANSFER:['تحويل','Transfer'],
 INFLOW:['تحصيل','Receipt'],OUTFLOW:['دفع','Payment'],NON_CASH:['غير نقدي','Noncash'],
 OPERATING:['تشغيلي','Operating'],INVESTING:['استثماري','Investing'],FINANCING:['تمويلي','Financing'],
 PPE:['الأصول الثابتة','Property and equipment'],METALS:['المعادن الثمينة','Precious metals'],OPENING_BALANCE:['رصيد افتتاحي','Opening balance'],
 BASE:['الأساس','Base'],NET_RECOGNITION:['القيمة الصافية','Net recognition'],
 INPUT_VAT_RECOVERABLE:['مدخلات قابلة للاسترداد','Recoverable input VAT'],
 INPUT_VAT_NONRECOVERABLE:['مدخلات غير قابلة للاسترداد','Nonrecoverable input VAT'],
 OUTPUT_VAT:['ضريبة المخرجات','Output VAT'],BOOK:['القيمة الدفترية','Book value'],CASH:['نقد','Cash'],
};

export const postingLabel=(value:string,en:boolean)=>labels[value]?.[en?1:0]??value;

export default function PostingRulesTable({en,rules,chart,classifications,events,version,editable,onChange,onRemove,selection,onSelect}:{
 en:boolean;rules:EditablePostingRule[];chart:Account[];classifications:{id:string;name:string}[];
 events:Voucher[];version:number;editable:boolean;selection:number|null;onSelect:(index:number|null)=>void;
 onChange:(index:number,rule:EditablePostingRule)=>void;onRemove:(index:number)=>void;
}){
 const t=(ar:string,english:string)=>en?english:ar;
 const label=(value:string)=>labels[value]?.[en?1:0]??value;
 const [search,setSearch]=useState(''),[module,setModule]=useState(''),[status,setStatus]=useState('');
 const [voucher,setVoucher]=useState('');
 useEffect(()=>{setVoucher('');if(selection!==null)document.querySelector('.posting-editor')?.scrollIntoView({block:'nearest',behavior:'smooth'});},[selection]);
 const byAccount=new Map(chart.map(a=>[a.id,a]));
 const byClassification=new Map(classifications.map(c=>[c.id,c.name]));
 const accountName=(id:string)=>{
  const account=byAccount.get(id);
  return account?account.code+' · '+(en?account.en:account.ar):id||t('اختر حسابًا','Select an account');
 };
 const sourceCash=t('من البنك أو الصندوق في السند','Bank or cashbox from voucher');
 const rows=rules.map((stored,index)=>{
  const rule=editable?detailedPostingDraft(stored,chart):stored;
  const [classification,...parts]=rule.classificationId.split(':');
  const name=byClassification.get(classification)??classification;
  const component=parts.map(label).join(' · ');
  const direction=voucherCashSide(rule.cashDirection);
  const display=(field:'debitAccountId'|'creditAccountId')=>
   rule.detailed&&direction===field&&rule[field]==='1000'?sourceCash:accountName(rule[field]);
  const issue=!rule.detailed?'REPORTING_DETAILED_POLICY_REQUIRED':validateDetailedPostingRule(rule,chart);
  return {index,rule,name,component,issue,debit:display('debitAccountId'),credit:display('creditAccountId')};
 });
 const count=rows.filter(row=>!row.issue).length;
 const modules=[...new Set(rules.map(rule=>rule.sourceModule))];
 const visible=rows.filter(row=>{
  const {rule}=row;
  return (!module||rule.sourceModule===module)&&(!status||(status==='ready')===!row.issue)&&
   [row.name,row.component,row.debit,row.credit,rule.sourceModule,label(rule.sourceModule),rule.eventType,label(rule.eventType),label(rule.cashDirection)].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
 });
 const current=selection===null?undefined:rows[selection];
 const samples=current?events.filter(e=>e.sourceModule===current.rule.sourceModule&&e.eventType===current.rule.eventType&&
  e.lines.some(l=>l.classificationId===current.rule.classificationId&&l.cashDirection===current.rule.cashDirection)): [];
 const sample=samples.find(e=>e.id===voucher);
 const selectedLine=sample?.lines.find(l=>l.classificationId===current?.rule.classificationId&&l.cashDirection===current?.rule.cashDirection);
 const selectedSide=current?voucherCashSide(current.rule.cashDirection):null;
 const actualCash=sample?.voucherCashAccount;
 const preview=(field:'debitAccountId'|'creditAccountId')=>{
  if(!current)return '';
  const sourceField=selectedLine?.recognitionSign===-1?(field==='debitAccountId'?'creditAccountId':'debitAccountId'):field;
  if(current.rule.detailed&&sourceField===selectedSide&&current.rule[sourceField]==='1000'){
   return actualCash?accountName(actualCash):sample?t('السند بلا ربط نقدي صالح','Voucher has no valid cash link'):sourceCash;
  }
  return accountName(current.rule[sourceField]);
 };
 const issues:Record<string,string>={
  REPORTING_DETAILED_POLICY_REQUIRED:t('هذه قاعدة من إصدار سابق. جهّز نسخة تفصيلية لاستخدام الحسابات الفرعية.','This is a legacy rule. Prepare a detailed version to use detail accounts.'),
  REPORTING_DETAIL_ACCOUNT_REQUIRED:t('اختر حسابًا فرعيًا صالحًا للترحيل لكل طرف ثابت.','Select a postable detail account for every fixed leg.'),
  REPORTING_POLICY_CASH_ACTIVITY_REQUIRED:t('حدد نشاط التدفق النقدي.','Select a cash-flow activity.'),
  REPORTING_VOUCHER_CASH_SELECTOR_REQUIRED:t('اربط طرف النقد بالبنك أو الصندوق في السند.','Use the bank or cashbox from the voucher for the cash leg.'),
 };
 return <section className="posting-rules" aria-label={t('جدول قواعد الترحيل','Posting rules table')}>
  <div className="posting-summary">
   <div data-tone="ready"><span>{t('الربط مكتمل','Mapping complete')}</span><strong>{count}</strong></div>
   <div data-tone="incomplete"><span>{t('تحتاج استكمالًا','Needs mapping')}</span><strong>{rows.length-count}</strong></div>
   <div><span>{t('إصدار القواعد','Rule version')}</span><strong>{version||'—'}</strong></div>
  </div>
  <div className="posting-filters">
   <label>{t('بحث','Search')}<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('ابحث عن عملية أو حساب','Search operations or accounts')}/></label>
   <label>{t('الوحدة','Module')}<select value={module} onChange={e=>setModule(e.target.value)}><option value="">{t('كل الوحدات','All modules')}</option>{modules.map(m=><option key={m} value={m}>{label(m)}</option>)}</select></label>
   <label>{t('حالة الربط','Mapping status')}<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">{t('جميع الحالات','All statuses')}</option><option value="ready">{t('مكتمل','Complete')}</option><option value="incomplete">{t('يحتاج استكمالًا','Needs mapping')}</option></select></label>
  </div>
  <div className={current?'posting-split is-editing':'posting-split'}>
   <div className="fs-card fs-table-scroll"><table className="fs-table">
    <thead><tr>{[t('الوحدة والعملية','Module and operation'),t('التصنيف','Classification'),t('المدين','Debit'),t('الدائن','Credit'),t('حالة الربط','Mapping status'),t('الإجراء','Action')].map(value=><th key={value}>{value}</th>)}</tr></thead>
    <tbody>{visible.map(row=><tr key={row.index} data-selected={selection===row.index||undefined}>
     <th>{label(row.rule.eventType)} · {label(row.rule.cashDirection)}<small>{label(row.rule.sourceModule)}</small></th>
     <td>{row.name}<small>{row.component}</small></td><td>{row.debit}</td><td>{row.credit}</td>
     <td><span className="posting-pill" data-tone={row.issue?'incomplete':'ready'}>{row.issue?t('يحتاج استكمالًا','Needs mapping'):t('مكتمل','Complete')}</span></td>
     <td><button type="button" className="btn secondary" onClick={()=>onSelect(row.index)} aria-label={t('فتح القاعدة','Open rule')+' '+(row.index+1)}>{editable?t('تعديل','Edit'):t('عرض','View')}</button></td>
    </tr>)}
    {!visible.length&&<tr><td colSpan={6}>{t('لا توجد قواعد تطابق البحث','No matching rules')}</td></tr>}</tbody>
   </table></div>
   {current&&<aside className="fs-card posting-editor" aria-label={t('تعديل الربط','Edit mapping')}>
    <header><strong>{t('تفاصيل الربط','Mapping details')}</strong><button type="button" className="btn secondary" onClick={()=>onSelect(null)}>{t('إغلاق','Close')}</button></header>
    <div><b>{current.name}</b> · {label(current.rule.eventType)}<small>{label(current.rule.sourceModule)} · {label(current.rule.cashDirection)}</small></div>
    {(['debitAccountId','creditAccountId'] as const).map(field=>{
     const title=field==='debitAccountId'?t('الحساب المدين','Debit account'):t('الحساب الدائن','Credit account');
     const value=current.rule[field],side=voucherCashSide(current.rule.cashDirection);
     const options=field===side?chart.filter(a=>a.id==='1000'):chart.filter(a=>isPostingLeaf(a)&&!a.cash);
     return <label key={field}>{title}<select disabled={!editable} aria-label={title+' '+(current.index+1)} value={value} onChange={e=>onChange(current.index,{...current.rule,[field]:e.target.value})}>
      <option value="">{t('حدد الحساب','Select account')}</option>
      {value&&!options.some(a=>a.id===value)&&<option value={value} disabled>{accountName(value)} · {t('يحتاج استبدالًا','Needs replacement')}</option>}
      {options.map(a=><option key={a.id} value={a.id}>{field===side?sourceCash:accountName(a.id)}</option>)}
     </select></label>;
    })}
    <label>{t('نشاط التدفق','Cash activity')}<select disabled={!editable} value={current.rule.cashActivity??''} onChange={e=>onChange(current.index,{...current.rule,cashActivity:e.target.value as EditablePostingRule['cashActivity']||undefined})}>
     <option value="">{t('غير نقدي','Noncash')}</option>
     {(['OPERATING','INVESTING','FINANCING'] as const).map(value=><option key={value} value={value}>{label(value)}</option>)}
    </select></label>
    <div className="posting-preview">
     <strong>{t('معاينة القيد','Journal preview')}</strong>
     {samples.length>0&&<label>{t('اختيار سند للمعاينة','Choose a voucher to preview')}<select value={voucher} onChange={e=>setVoucher(e.target.value)}><option value="">{t('ربط القاعدة فقط','Rule mapping only')}</option>{samples.map(e=><option key={e.id} value={e.id}>{e.date} · {e.sourceKey}</option>)}</select></label>}
     <dl><div><dt>{t('مدين','Debit')}</dt><dd>{preview('debitAccountId')}</dd></div><div><dt>{t('دائن','Credit')}</dt><dd>{preview('creditAccountId')}</dd></div></dl>
     {selectedLine&&<p>{t('مبلغ السطر','Source line amount')} <bdi>{selectedLine.baseAmount} {sample?.currency}</bdi></p>}
     {current.issue&&<p role="status">{issues[current.issue]??t('أكمل الربط وحدد اتجاه النقد المناسب.','Complete the mapping and select the correct cash direction.')}</p>}
    </div>
    {editable&&<button type="button" className="btn secondary" onClick={()=>onRemove(current.index)}>{t('إزالة القاعدة','Remove rule')}</button>}
   </aside>}
  </div>
 </section>;
}
