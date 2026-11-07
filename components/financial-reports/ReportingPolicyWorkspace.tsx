'use client';
import TopbarOrganizationControls from '../TopbarOrganizationControls';
import WorkspaceOrganizationPicker from '../WorkspaceOrganizationPicker';
import {rememberedOrganization} from '../../lib/workspace-organization';
import FiscalPeriodControl from './FiscalPeriodControl';
import {useEffect,useRef,useState} from 'react';
import type {PostingRule,RecognitionEvent} from '../../lib/financial-event-ledger';
import type {LedgerAccount} from '../../lib/financial-statement-engine';
import {financialPostingCoverage} from '../../lib/financial-posting-coverage';
import './financial-reports-suite.css';
type Rule=Pick<PostingRule,'eventType'|'sourceModule'|'classificationId'|'cashDirection'|'debitAccountId'|'creditAccountId'|'cashActivity'>;
type Signature=Pick<Rule,'eventType'|'sourceModule'|'classificationId'|'cashDirection'>;
const blankSignature=():Signature=>({eventType:'',sourceModule:'',classificationId:'',cashDirection:'NON_CASH'});
type Data={classifications?:{id:string;name:string;currentFiscalStart?:string|null}[];organizationId:string;fiscalStart:string;chart:(LedgerAccount & {code:string;ar:string;en:string})[];policy:{id:string;version:number;status:string;rules:Rule[];reason:string}|null;events:RecognitionEvent[];canSave:boolean;canApprove:boolean};
const key=(r:Pick<Rule,'eventType'|'sourceModule'|'classificationId'|'cashDirection'>)=>JSON.stringify([r.eventType,r.sourceModule,r.classificationId,r.cashDirection]);
async function json(r:Response){const data=await r.json();if(!r.ok)throw Error(data.error??'REPORTING_UNAVAILABLE');return data}
function readySourceSignatures(data:Data|null):{value:string;label:string}[]{
 if(!data)return [];
 const options=new Map<string,string>();
 for(const e of data.events)for(const line of e.lines)
  options.set(line.classificationId,line.classificationId);
 // Prospective rules are permitted only for a real persisted classification.
 // The BASE suffix is a suggestion for canonical core events, not a guaranteed
 // posting until actual source lines have been verified.
 for(const item of data.classifications??[])
  options.set(item.id+':BASE',item.name+' · BASE');
 return [...options].map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label));
}

export default function ReportingPolicyWorkspace({locale,preferredOrg=''}:{locale:string;preferredOrg?:string}){
 const en=locale==='en',t=(ar:string,english:string)=>en?english:ar;
 const[orgs,setOrgs]=useState<{id:string;name:string;currentFiscalStart?:string|null}[]>([]),[org,setOrg]=useState(''),[date,setDate]=useState(''),[data,setData]=useState<Data|null>(null),[rules,setRules]=useState<Rule[]>([]),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const[signature,setSignature]=useState<Signature>(blankSignature());
 const seq=useRef(0),selectedOrganization=useRef('');selectedOrganization.current=org;
 useEffect(()=>{const a=new AbortController();fetch('/api/financial-reporting/openings?action=context',{cache:'no-store',signal:a.signal}).then(json).then(rows=>{if(!a.signal.aborted){setOrgs(rows);const initial=preferredOrg?rows.find((o:{id:string})=>o.id===preferredOrg):rows.find((o:{id:string})=>o.id===rememberedOrganization())??rows[0];setOrg(initial?.id??'');setDate(initial?.currentFiscalStart??'')}}).catch(e=>{if(!a.signal.aborted)setError(e.message)});return()=>a.abort()},[preferredOrg]);
 useEffect(()=>{const a=new AbortController(),generation=++seq.current;setData(null);setRules([]);setSignature(blankSignature());setError('');if(!org||!date)return()=>a.abort();setBusy(true);fetch('/api/financial-reporting/policy?'+new URLSearchParams({organization:org,fiscalStart:date}),{cache:'no-store',signal:a.signal}).then(json).then((d:Data)=>{if(a.signal.aborted)return;const existing=new Map((d.policy?.rules??[]).map(r=>[key(r),r]));for(const e of d.events)for(const l of e.lines){const r={eventType:e.eventType,sourceModule:e.sourceModule,classificationId:l.classificationId,cashDirection:l.cashDirection,debitAccountId:'',creditAccountId:''};if(!existing.has(key(r)))existing.set(key(r),r)}setData(d);setRules([...existing.values()]);setReason(d.policy?.reason??'')}).catch(e=>{if(!a.signal.aborted)setError(e.message)}).finally(()=>{if(!a.signal.aborted&&seq.current===generation)setBusy(false)});return()=>a.abort()},[org,date,reload]);
 const locked=busy||data?.policy?.status==='APPROVED',dirty=JSON.stringify(rules)!==JSON.stringify(data?.policy?.rules??[])||reason!==(data?.policy?.reason??'');
 async function submit(action:'save'|'approve'){if(!data||data.organizationId!==org||data.fiscalStart!==date||busy)return;const generation=seq.current;setBusy(true);setError('');try{const payload=action==='save'?{action,organization:org,fiscalStart:date,expectedVersion:data.policy?.status==='DRAFT'?data.policy.version:0,rules,reason}:{action,id:data.policy?.id,expectedVersion:data.policy?.version};await json(await fetch('/api/financial-reporting/policy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));if(seq.current===generation)setReload(v=>v+1)}catch(e){if(seq.current===generation){setError(e instanceof Error?e.message:'REPORTING_UNAVAILABLE');if(e instanceof Error&&/DENIED|UNAUTHORIZED/.test(e.message))setData(null)}}finally{if(seq.current===generation)setBusy(false)}}
 function change(i:number,field:keyof Rule,value:string){setRules(rows=>rows.map((r,n)=>n===i?{...r,[field]:value||undefined}:r))}
 const activeData=data?.organizationId===org&&data.fiscalStart===date?data:null;
 const authorizedSignatures=readySourceSignatures(activeData);
 const canAddSignature=!!activeData?.canSave&&!locked&&
  signature.eventType.trim().length>0&&signature.sourceModule.trim().length>0&&
  authorizedSignatures.some(c=>c.value===signature.classificationId)&&
  !rules.some(r=>key(r)===key(signature));
 function addManualRule(){
  if(!canAddSignature)return;
  setRules(existing=>[...existing,{...signature,eventType:signature.eventType.trim(),
   sourceModule:signature.sourceModule.trim(),debitAccountId:'',creditAccountId:''}]);
  setSignature(blankSignature());setError('');
 }
 const errors:Record<string,string>={REPORTING_SELF_APPROVAL_DENIED:t('تتطلب سياسة المؤسسة اعتماد مستخدم آخر.','Organization policy requires another approver.'),REPORTING_VERSION_CONFLICT:t('تغيّرت النسخة. أعد التحميل.','The version changed. Reload.'),REPORTING_SOURCE_NORMALIZATION_REQUIRED:t('هناك حركة تحتاج استكمال بياناتها المحاسبية في سجلها الأصلي.','A source movement requires accounting information in its original register.'),REPORTING_POLICY_SOURCE_UNMAPPED:t('لا يمكن اعتماد القواعد: توجد سندات فعلية دون حسابين مدين ودائن محددين. حدّث المصادر وأكمل القواعد.','Cannot approve: actual source vouchers are missing debit/credit account mappings. Refresh and complete the rules.'),REPORTING_POLICY_SOURCE_AMBIGUOUS:t('توجد أكثر من قاعدة ترحيل لنفس المصدر والتصنيف. أزل التعارض قبل الاعتماد.','Multiple posting rules match one source classification. Resolve the conflict before approval.'),REPORTING_POLICY_SOURCE_EMPTY:t('توجد حركة فعلية بلا تفاصيل قيود. راجع مصدرها قبل اعتماد القواعد.','An actual voucher has no accounting lines. Review its source before approving rules.')};
 const ready=data?.organizationId===org&&data.fiscalStart===date?data:null;
 const coverage=ready?financialPostingCoverage(ready.events,rules):null;
 const approvedRuleCount=ready?.policy?.status==='APPROVED'?ready.policy.rules.length:0;
 const duplicateRules=new Set(rules.map(key)).size!==rules.length;
 return <div className="fs-root fs-surface" dir={en?'ltr':'rtl'}><header className="fs-page-header"><h1>{t('قواعد ترحيل القوائم المالية','Financial statement posting rules')}</h1><div className="fs-page-actions"><button disabled={!data?.canSave||locked||duplicateRules||reason.trim().length<3||rules.some(r=>!r.debitAccountId||!r.creditAccountId)} onClick={()=>submit('save')}>{t('حفظ المسودة','Save draft')}</button><button className="fs-gold" disabled={!data?.canApprove||locked||dirty||!data?.policy||data.policy.version<1||Boolean(coverage&&(coverage.missingLines||coverage.ambiguousLines||coverage.emptyEvents))} onClick={()=>submit('approve')}>{t('اعتماد القواعد','Approve rules')}</button></div></header>
 <p>{t('حدد الحسابين ونوع التدفق لكل مصدر وتصنيف. المبالغ تأتي من السندات الفعلية؛ القواعد لا تُدخل مبالغ أو تكررها.','Select the debit, credit and cash activity for each source and classification. Amounts come from live vouchers; rules contain no amounts.')}</p>
 {ready&&<div className="fs-card" role="status">
  <strong>{t('الحالة الفعلية لقواعد الترحيل','Actual posting rules status')}</strong>
  <p>{t('حالة السياسة: ','Policy status: ')}{ready.policy?.status==='APPROVED'?t('معتمدة','Approved'):ready.policy?.status==='DRAFT'?t('مسودة غير معتمدة','Unapproved draft'):t('لم تُنشأ','Not created')} · {t('قواعد محفوظة: ','Saved rules: ')}<bdi>{ready.policy?.rules.length??0}</bdi> · {t('قواعد معتمدة: ','Approved rules: ')}<bdi>{approvedRuleCount}</bdi></p>
  {ready.policy?.status==='APPROVED'&&approvedRuleCount===0&&<p role="alert">{t('تنبيه: تم اعتماد سياسة فارغة دون قواعد مدين ودائن. هذا لا يعني أن خريطة الترحيل المحاسبية جاهزة. اختر إعداد نسخة جديدة، ثم عرّف القواعد واعتمدها.','Warning: An empty policy was approved with no debit/credit rules. This does not mean accounting posting rules are configured. Prepare a new version, then define and approve rules.')}</p>}
  {ready.events.length===0&&<p>{t('لا توجد سندات فعلية في هذه السنة. يمكن تجهيز قواعد استباقية فقط باستخدام تصنيفات المؤسسة الحقيقية؛ لن تُعد مختبرة على حركات حتى تبدأ العمليات.','No actual vouchers exist for this year. Future rules may be prepared using real organization classifications, but they are untested on live transactions until operations begin.')}</p>}
  {duplicateRules&&<p role="alert">{t('هناك قواعد مكررة لنفس نوع الحدث والمصدر والتصنيف واتجاه النقد.','Duplicate rules exist for the same event/source/classification/cash direction.')}</p>}
 </div>}
 {!/DENIED|UNAUTHORIZED/.test(error)&&<FiscalPeriodControl key={org+':'+reload} organization={org} en={en}/>}<div className="fs-filter-strip"><TopbarOrganizationControls><WorkspaceOrganizationPicker ar={!en} label={t('المؤسسة','Organization')} organizations={orgs} value={org} restore={false} disabled={busy} beforeChange={()=>!ready||!dirty||window.confirm(t('تجاهل التغييرات غير المحفوظة؟','Discard unsaved changes?'))} onChange={id=>{setOrg(id);setDate(orgs.find(o=>o.id===id)?.currentFiscalStart??'')}}/></TopbarOrganizationControls><label>{t('بداية السنة','Fiscal start')}<input disabled={busy} type="date" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value)}}/></label><button disabled={busy} onClick={()=>setReload(v=>v+1)}>{t('تحديث','Refresh')}</button></div>
 {error&&<p role="alert">{errors[error]??t('تعذر تنفيذ العملية أو لا توجد الصلاحيات المطلوبة.','The operation is unavailable or the required permission is missing.')}</p>}{busy&&<p role="status">{t('جار المعالجة…','Working…')}</p>}
 {coverage&&<section className="fs-card" aria-label={t('فحص تغطية الترحيل','Posting coverage check')}>
  <strong>{t('تغطية السندات الفعلية بدليل الحسابات','Actual source-voucher mapping coverage')}</strong>
  <p role="status">{t('سطور مرتبطة بقواعد واضحة: ','Lines with exactly one configured mapping: ')}{coverage.mappedLines} / {coverage.lineCount} · {t('السندات: ','Vouchers: ')}{coverage.eventCount}</p>
  {coverage.missingLines===0&&coverage.ambiguousLines===0&&coverage.emptyEvents===0?<p>{t('جميع سطور السندات المتاحة لها قاعدة ترحيل واحدة.','Every available source line has exactly one posting rule.')}</p>:<>
   <p role="alert">{t('سطور بلا ربط: ','Unmapped lines: ')}{coverage.missingLines} · {t('سطور بقواعد متعارضة: ','Ambiguous lines: ')}{coverage.ambiguousLines} · {t('سندات بلا تفاصيل: ','Vouchers without lines: ')}{coverage.emptyEvents}</p>
   {coverage.groups.filter(g=>g.status!=='MAPPED').map(g=><p key={key(g)}>{g.sourceModule} · {g.eventType} · {g.classificationId} · {g.cashDirection} — {g.lineCount} {t('سطور','lines')}</p>)}
  </>}
 </section>}
 {ready&&<><div className="fs-card fs-table-scroll"><table className="fs-table"><thead><tr>{[t('المصدر / الحدث','Source / event'),t('التصنيف / المكوّن','Classification / component'),t('اتجاه النقد','Cash direction'),t('الحساب المدين','Debit account'),t('الحساب الدائن','Credit account'),t('نشاط التدفق','Cash activity'),t('إجراء','Action')].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rules.map((r,i)=><tr key={key(r)}><th>{r.sourceModule}<small>{r.eventType}</small></th><td>{ready.classifications?.find(c=>c.id===r.classificationId.split(':')[0])?.name??r.classificationId.split(':')[0]}<small>{r.classificationId.split(':').slice(1).map(v=>({BASE:t('الأساس','Base'),NET_RECOGNITION:t('القيمة الصافية','Net recognition'),INPUT_VAT_RECOVERABLE:t('ضريبة مدخلات قابلة للاسترداد','Recoverable input VAT'),INPUT_VAT_NONRECOVERABLE:t('ضريبة مدخلات غير قابلة للاسترداد','Nonrecoverable input VAT'),OUTPUT_VAT:t('ضريبة المخرجات','Output VAT'),BOOK:t('القيمة الدفترية','Book value'),CASH:t('نقد','Cash')} as Record<string,string>)[v]??v).join(' · ')}</small></td><td>{r.cashDirection==='NON_CASH'?t('غير نقدي','Noncash'):r.cashDirection==='INFLOW'?t('متحصلات','Receipts'):t('مدفوعات','Payments')}</td>{(['debitAccountId','creditAccountId'] as const).map(field=><td key={field}><select disabled={locked} aria-label={t(field==='debitAccountId'?'الحساب المدين':'الحساب الدائن',field)+' '+(i+1)} value={r[field]} onChange={e=>change(i,field,e.target.value)}><option value="">{t('حدد الحساب','Select account')}</option>{ready.chart.map(a=><option key={a.id} value={a.id}>{a.code} · {en?a.en:a.ar}</option>)}</select></td>)}<td><select disabled={locked} value={r.cashActivity??''} aria-label={t('نشاط التدفق','Cash activity')+' '+(i+1)} onChange={e=>change(i,'cashActivity',e.target.value)}><option value="">{t('غير نقدي / تحويل داخلي','Noncash / internal transfer')}</option>{[['OPERATING','تشغيلي','Operating'],['INVESTING','استثماري','Investing'],['FINANCING','تمويلي','Financing']].map(([v,ar,english])=><option key={v} value={v}>{t(ar,english)}</option>)}</select></td><td><button type="button" disabled={locked} onClick={()=>setRules(items=>items.filter((_,n)=>n!==i))}>{t('إزالة','Remove')}</button></td></tr>)}</tbody></table></div>
 {ready.canSave&&!locked&&<section className="fs-card" aria-label={t('تعريف قاعدة ترحيل جديدة','Define a new posting rule')}>
  <strong>{t('إضافة قاعدة للعمليات القادمة','Add a rule for future transactions')}</strong>
  <p>{t('اختر التصنيف الحقيقي للمؤسسة وأدخل نوع الحدث واسم الموديول كما يصدرهما السند الأصلي. لا يتم اقتراح الحسابات المالية تلقائيًا، ويجب اختيار المدين والدائن قبل الحفظ.','Select a real organization classification and enter the event type and source module exactly as the original voucher emits them. Accounts are never guessed; choose debit and credit before saving.')}</p>
  <div className="fs-filter-strip">
   <label>{t('نوع الحدث','Event type')}<input maxLength={300} value={signature.eventType} onChange={e=>setSignature(v=>({...v,eventType:e.target.value}))} placeholder="EXPENSE" list="fs-known-event-types"/></label>
   <datalist id="fs-known-event-types">{[...new Set(ready.events.map(e=>e.eventType))].map(v=><option key={v} value={v}/>)}</datalist>
   <label>{t('الموديول المصدر','Source module')}<input maxLength={300} value={signature.sourceModule} onChange={e=>setSignature(v=>({...v,sourceModule:e.target.value}))} placeholder="core" list="fs-known-source-modules"/></label>
   <datalist id="fs-known-source-modules">{[...new Set(ready.events.map(e=>e.sourceModule))].map(v=><option key={v} value={v}/>)}</datalist>
   <label>{t('التصنيف / المكوّن','Classification / component')}<select value={signature.classificationId} onChange={e=>setSignature(v=>({...v,classificationId:e.target.value}))}><option value="">{t('اختر تصنيفًا محفوظًا','Select a saved classification')}</option>{authorizedSignatures.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
   <label>{t('اتجاه الحركة','Cash direction')}<select value={signature.cashDirection} onChange={e=>setSignature(v=>({...v,cashDirection:e.target.value as Signature['cashDirection']}))}><option value="NON_CASH">{t('غير نقدي','Noncash')}</option><option value="INFLOW">{t('تحصيل','Inflow')}</option><option value="OUTFLOW">{t('صرف','Outflow')}</option></select></label>
   <button type="button" disabled={!canAddSignature} onClick={addManualRule}>{t('إضافة قاعدة','Add rule')}</button>
  </div>
  {!authorizedSignatures.length&&<p role="alert">{t('لا توجد تصنيفات أصلية محفوظة في هذه المؤسسة. سجّل تصنيف العملية في الموديول الأصلي أولًا، ولا تُنشئ قاعدة برمز وهمي.','No saved original classifications are available in this organization. Create a real source classification first; do not use an invented ID.')}</p>}
 </section>}
 <label>{t('سبب الإعداد أو التغيير','Setup or change reason')}<textarea disabled={locked} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>{ready.policy?.status==='APPROVED'&&<button disabled={busy||!ready.canSave} onClick={()=>{setData({...ready,policy:{...ready.policy!,status:'DRAFT',version:0}})}}>{t('إعداد نسخة جديدة','Prepare a new version')}</button>}</>}
 </div>;
}
