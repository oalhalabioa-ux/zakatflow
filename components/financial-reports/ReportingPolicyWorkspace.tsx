'use client';
import TopbarOrganizationControls from '../TopbarOrganizationControls';
import WorkspaceOrganizationPicker from '../WorkspaceOrganizationPicker';
import {rememberedOrganization} from '../../lib/workspace-organization';
import FiscalPeriodControl from './FiscalPeriodControl';
import {useEffect,useRef,useState} from 'react';
import type {RecognitionEvent} from '../../lib/financial-event-ledger';
import type {LedgerAccount} from '../../lib/financial-statement-engine';
import {financialPostingCoverage} from '../../lib/financial-posting-coverage';
import './financial-reports-suite.css';
import {postingRuleKey,type DefaultPostingRule} from '../../lib/financial-default-posting-rules';
import PostingRulesTable,{postingLabel,type EditablePostingRule as Rule} from './PostingRulesTable';
import {detailedPostingDraft,validateDetailedPostingRule,type DetailedPostingChartAccount} from '../../lib/financial-posting-rule-validation';
type Signature=Pick<Rule,'eventType'|'sourceModule'|'classificationId'|'cashDirection'>;
const blankSignature=():Signature=>({eventType:'',sourceModule:'',classificationId:'',cashDirection:'NON_CASH'});
type Data={accountLinkCoverage?:{accountCode:string;status:string}[];defaults?:{version:number;rules:DefaultPostingRule[];unresolved:{classificationId:string;reason:string}[];testedRuleCount:number};classifications?:{id:string;name:string;currentFiscalStart?:string|null}[];organizationId:string;fiscalStart:string;chart:(LedgerAccount & DetailedPostingChartAccount & {code:string;ar:string;en:string})[];policy:{id:string;version:number;status:string;rules:Rule[];reason:string}|null;approvedPolicy?:{status:string;version:number;rules:Rule[]}|null;events:RecognitionEvent[];canSave:boolean;canApprove:boolean};
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

export default function ReportingPolicyWorkspace({locale,preferredOrg='',setupEmbedded=false,onSaved,onEditState}:{locale:string;preferredOrg?:string;setupEmbedded?:boolean;onSaved?:()=>void;onEditState?:(dirty:boolean,busy:boolean)=>void}){
 const en=locale==='en',t=(ar:string,english:string)=>en?english:ar;
 const[orgs,setOrgs]=useState<{id:string;name:string;currentFiscalStart?:string|null}[]>([]),[org,setOrg]=useState(''),[date,setDate]=useState(''),[data,setData]=useState<Data|null>(null),[rules,setRules]=useState<Rule[]>([]),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const [expenseCode,setExpenseCode]=useState(''),[expenseName,setExpenseName]=useState('');
 const[signature,setSignature]=useState<Signature>(blankSignature());
 const[selection,setSelection]=useState<number|null>(null);
 const[guidedKey,setGuidedKey]=useState('');
 const[notice,setNotice]=useState('');
 useEffect(()=>{setGuidedKey('');setNotice('');},[org,date]);
 const seq=useRef(0),selectedOrganization=useRef('');selectedOrganization.current=org;
 useEffect(()=>{const a=new AbortController();fetch('/api/financial-reporting/openings?action=context',{cache:'no-store',signal:a.signal}).then(json).then(rows=>{if(!a.signal.aborted){setOrgs(rows);const initial=preferredOrg?rows.find((o:{id:string})=>o.id===preferredOrg):rows.find((o:{id:string})=>o.id===rememberedOrganization())??rows[0];setOrg(initial?.id??'');setDate(initial?.currentFiscalStart??'')}}).catch(e=>{if(!a.signal.aborted)setError(e.message)});return()=>a.abort()},[preferredOrg]);
 useEffect(()=>{const a=new AbortController(),generation=++seq.current;setData(null);setRules([]);setExpenseCode('');setExpenseName('');setSelection(null);setSignature(blankSignature());setError('');if(!org||!date)return()=>a.abort();setBusy(true);fetch('/api/financial-reporting/policy?'+new URLSearchParams({organization:org,fiscalStart:date}),{cache:'no-store',signal:a.signal}).then(json).then(async(d:Data)=>{if(a.signal.aborted)return;if((!d.policy||(d.policy.status==='APPROVED'&&d.policy.rules.length===0))&&d.canSave&&d.canApprove&&d.defaults){try{d=await json(await fetch('/api/financial-reporting/policy',{method:'POST',headers:{'Content-Type':'application/json'},signal:a.signal,body:JSON.stringify({action:'activate-defaults',organization:org,fiscalStart:date})}));if(!a.signal.aborted)onSaved?.();}catch(e){if(!a.signal.aborted)setError(e instanceof Error?e.message:'REPORTING_UNAVAILABLE');}}if(a.signal.aborted)return;const existing=new Map((d.policy?.rules??[]).map(r=>[key(r),r]));for(const e of d.events)for(const l of e.lines){const r={eventType:e.eventType,sourceModule:e.sourceModule,classificationId:l.classificationId,cashDirection:l.cashDirection,debitAccountId:'',creditAccountId:''};if(!existing.has(key(r)))existing.set(key(r),r)}setData(d);setRules([...existing.values()]);setReason(d.policy?.reason??'')}).catch(e=>{if(!a.signal.aborted)setError(e.message)}).finally(()=>{if(!a.signal.aborted&&seq.current===generation)setBusy(false)});return()=>a.abort()},[org,date,reload]);
 const locked=busy||data?.policy?.status==='APPROVED',dirty=JSON.stringify(rules)!==JSON.stringify(data?.policy?.rules??[])||reason!==(data?.policy?.reason??'');
 useEffect(()=>{onEditState?.(dirty,busy);return()=>onEditState?.(false,false);},[dirty,busy,onEditState]);
 async function submit(action:'save'|'approve'){if(!data||data.organizationId!==org||data.fiscalStart!==date||busy)return;const generation=seq.current;setBusy(true);setError('');try{const payload=action==='save'?{action,organization:org,fiscalStart:date,expectedVersion:data.policy?.status==='DRAFT'?data.policy.version:0,rules:rules.map(rule=>detailedPostingDraft(rule,data.chart)),reason}:{action,id:data.policy?.id,expectedVersion:data.policy?.version};await json(await fetch('/api/financial-reporting/policy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));if(seq.current===generation){setReload(v=>v+1);onSaved?.();}}catch(e){if(seq.current===generation){setError(e instanceof Error?e.message:'REPORTING_UNAVAILABLE');if(e instanceof Error&&/DENIED|UNAUTHORIZED/.test(e.message))setData(null)}}finally{if(seq.current===generation)setBusy(false)}}
 async function createExpenseClassification(){
  if(!data?.canSave||busy||dirty||data.organizationId!==org||data.fiscalStart!==date)return;
  const generation=seq.current;
  setBusy(true);setError('');
  try{
   await json(await fetch('/api/financial-reporting/policy',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'create-expense-classification',organization:org,fiscalStart:date,
      code:expenseCode.trim().toUpperCase(),name:expenseName.trim()}),
   }));
   if(seq.current===generation)setReload(v=>v+1);
  }catch(e){if(seq.current===generation)setError(e instanceof Error?e.message:'REPORTING_UNAVAILABLE');}
  finally{if(seq.current===generation)setBusy(false);}
 }
 async function prepareDefaults(action:'prepare-defaults'|'activate-defaults'='activate-defaults'){
  if(!data?.canSave||busy||data.organizationId!==org||data.fiscalStart!==date)return;
  const generation=seq.current;setBusy(true);setError('');
  try{await json(await fetch('/api/financial-reporting/policy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,organization:org,fiscalStart:date})}));if(seq.current===generation){setNotice(action==='prepare-defaults'?t('تم حفظ القواعد الافتراضية وروابطها. تظهر الحسابات التي تحتاج اختيارًا ضمن يحتاج استكمالًا؛ الاعتماد خطوة مستقلة.','Default rules and mappings were saved. Accounts requiring a choice appear under Needs mapping; approval is separate.'):t('تم تفعيل القواعد.','Rules activated.'));setReload(v=>v+1);onSaved?.();}}
  catch(e){if(seq.current===generation){setError(e instanceof Error?e.message:'REPORTING_UNAVAILABLE');
   // Preparation may have saved a draft before an approval gate rejected it.
   // Reload persisted state without hiding the reason approval was blocked.
   try{const fresh:Data=await json(await fetch('/api/financial-reporting/policy?'+new URLSearchParams({organization:org,fiscalStart:date}),{cache:'no-store'}));if(seq.current===generation){setData(fresh);setRules(fresh.policy?.rules??[]);setReason(fresh.policy?.reason??'');}}catch{/* Keep the original failure visible. */}
  }}
  finally{if(seq.current===generation)setBusy(false);}
 }
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
  setSelection(rules.length);setSignature(blankSignature());setError('');
 }
 const errors:Record<string,string>={REPORTING_DEFAULT_ROLE_INVALID:t('أحد الحسابات الافتراضية معطّل أو غير قابل للترحيل. راجع حسابات المؤسسة.','A default account is disabled or not postable.'),REPORTING_DEFAULT_ROLE_AMBIGUOUS:t('يوجد أكثر من حساب لنفس الوظيفة. يلزم تحديد الحساب الافتراضي قبل التفعيل.','Multiple accounts match one role. Resolve the default before activation.'),REPORTING_APPROVE_DENIED:t('يلزم صلاحية إنشاء واعتماد وترحيل لتفعيل القواعد دفعة واحدة.','Create, approve and post permissions are required for batch activation.'),REPORTING_CLASSIFICATION_DUPLICATE:t('رمز التصنيف مستخدم في هذه المؤسسة.','This classification code already exists in this organization.'),REPORTING_ACCESS_DENIED:t('صلاحيتك لا تسمح بهذا الإجراء.','Your permissions do not allow this action.'),REPORTING_DETAIL_ACCOUNT_REQUIRED:t('تحتاج القاعدة إلى حساب فرعي نشط وقابل للترحيل.','A rule needs an active postable detail account.'),REPORTING_DETAILED_POLICY_REQUIRED:t('احفظ واعتمد نسخة تفصيلية كاملة.','Save and approve a complete detailed version.'),REPORTING_VOUCHER_CASH_LINK_REQUIRED:t('حدد ربط الحساب الفرعي للبنك أو الصندوق في دليل الحسابات.','Link the voucher bank or cashbox to a chart detail account.'),REPORTING_CLASSIFICATIONS_REQUIRED:t('يلزم إنشاء تصنيفات المؤسسة بصلاحية إدارة المؤسسة قبل تجهيز القواعد.','Organization classifications must be created by an authorized organization administrator.'),REPORTING_DEFAULT_ACCOUNTS_REQUIRED:t('لم تكتمل الحسابات اللازمة للقواعد الافتراضية. أكمل دليل الحسابات ثم أعد المحاولة.','Required default accounts are unavailable. Complete the chart and try again.'),REPORTING_SELF_APPROVAL_DENIED:t('تتطلب سياسة المؤسسة اعتماد مستخدم آخر.','Organization policy requires another approver.'),REPORTING_VERSION_CONFLICT:t('تغيّرت النسخة. أعد التحميل.','The version changed. Reload.'),REPORTING_SOURCE_NORMALIZATION_REQUIRED:t('هناك حركة تحتاج استكمال بياناتها المحاسبية في سجلها الأصلي.','A source movement requires accounting information in its original register.'),REPORTING_POLICY_SOURCE_UNMAPPED:t('لا يمكن اعتماد القواعد: توجد سندات فعلية دون حسابين مدين ودائن محددين. حدّث المصادر وأكمل القواعد.','Cannot approve: actual source vouchers are missing debit/credit account mappings. Refresh and complete the rules.'),REPORTING_POLICY_SOURCE_AMBIGUOUS:t('توجد أكثر من قاعدة ترحيل لنفس المصدر والتصنيف. أزل التعارض قبل الاعتماد.','Multiple posting rules match one source classification. Resolve the conflict before approval.'),REPORTING_POLICY_SOURCE_EMPTY:t('توجد حركة فعلية بلا تفاصيل قيود. راجع مصدرها قبل اعتماد القواعد.','An actual voucher has no accounting lines. Review its source before approving rules.')};
 const ready=data?.organizationId===org&&data.fiscalStart===date?data:null;
 const coverage=ready?financialPostingCoverage(ready.events,rules):null;
 const approvedRuleCount=ready?.approvedPolicy?.rules.length??(ready?.policy?.status==='APPROVED'?ready.policy.rules.length:0);
 const guidedRules=[...rules,...(ready?.defaults?.rules??[]).filter(r=>!rules.some(x=>postingRuleKey(x)===postingRuleKey(r)))];
 function openGuidedRule(){const rule=guidedRules.find(r=>postingRuleKey(r)===guidedKey);if(!rule)return;const index=rules.findIndex(r=>postingRuleKey(r)===guidedKey);if(index>=0)setSelection(index);else{setRules(items=>[...items,detailedPostingDraft(rule,ready!.chart)]);setSelection(rules.length);if(!reason.trim())setReason(t('إعداد ربط من قالب محفوظ','Configure mapping from a saved template'));}}
 const duplicateRules=new Set(rules.map(key)).size!==rules.length;
 const detailedReady=Boolean(ready&&rules.length&&rules.every(rule=>rule.detailed&&validateDetailedPostingRule(rule,ready.chart)===null));
 return <div className="fs-root fs-surface" dir={en?'ltr':'rtl'}><header className="fs-page-header"><h1>{t('قواعد الترحيل وربط الحسابات','Posting rules and account mapping')}</h1><div className="fs-page-actions"><button disabled={!data?.canSave||locked||duplicateRules||reason.trim().length<3||rules.some(r=>!r.debitAccountId||!r.creditAccountId)} onClick={()=>submit('save')}>{t('حفظ المسودة','Save draft')}</button><button className="fs-gold" disabled={!data?.canApprove||locked||dirty||!detailedReady||!data?.policy||data.policy.version<1||Boolean(coverage&&(coverage.missingLines||coverage.ambiguousLines||coverage.emptyEvents))} onClick={()=>submit('approve')}>{t('اعتماد القواعد','Approve rules')}</button></div></header>
 <p>{t('حدد الحسابين ونوع التدفق لكل مصدر وتصنيف. المبالغ تأتي من السندات الفعلية؛ القواعد لا تُدخل مبالغ أو تكررها.','Select the debit, credit and cash activity for each source and classification. Amounts come from live vouchers; rules contain no amounts.')}</p>
 {ready?.defaults&&<section className="fs-card" aria-label={t('القواعد الافتراضية','Default posting rules')}><strong>{t('قواعد المؤسسة الافتراضية','Organization default rules')}</strong><p>{t('تُجهّز الحسابات والقواعد الافتراضية وتُعتمد دفعة واحدة بعد التحقق من اكتمال الربط والصلاحيات. تُحفظ تعديلات الحسابات التفصيلية، وتبقى تفاصيل العملاء والموردين في موديولاتها. لا ينشئ التجهيز أي مبالغ أو سندات.','Default accounts and rules are prepared and activated together after mapping and permission checks. Explicit detail-account edits are preserved; customer and supplier details stay in their subledgers. Setup creates no amounts or vouchers.')}</p>{ready.canSave&&ready.canApprove&&<div className="fs-page-actions"><button className="fs-default-activate" type="button" disabled={busy||dirty} onClick={()=>void prepareDefaults('prepare-defaults')}>{t('إضافة وحفظ القواعد الافتراضية الناقصة','Add and save missing defaults')}</button><button type="button" disabled={busy||dirty} onClick={()=>void prepareDefaults()}>{t('استكمال وتفعيل القواعد دفعة واحدة','Complete and activate all defaults')}</button></div>}{notice&&<p role="status">{notice}</p>}{ready.defaults.unresolved.length>0&&<p role="alert">{t('ربط يحتاج استكمال حساباته: ','Mappings requiring accounts: ')}{ready.defaults.unresolved.length}</p>}{dirty&&<p role="status">{t('لديك تعديلات غير محفوظة. احفظ المسودة أولًا ثم استكمل التفعيل؛ القواعد المعروضة لا تصبح معتمدة بمجرد تعديلها.','You have unsaved edits. Save the draft before activation; displayed changes are not approved yet.')}</p>}</section>}
 {ready?.accountLinkCoverage?.some(a=>a.status==='NO_TEMPLATE')&&<section className="fs-card" role="status">
  <strong>{t('حسابات تحتاج قالب عملية مناسبًا','Accounts requiring a source template')}</strong>
  <p>{t('هذه الحسابات محفوظة في الدليل ولا تملك قالب عملية تلقائيًا بعد. لا يمنع ذلك تفعيل القواعد المكتملة، ولا يعني جاهزية هذه الحسابات للترحيل. الأرصدة الافتتاحية تُدار من قسمها؛ أما الحركات الجديدة فتحتاج مصدرًا وربطًا مناسبين.','These accounts have no automatic transaction template yet. They do not block activation of complete rules and are not ready for automatic posting. Opening balances use their own workspace; new movements require a suitable source mapping.')}</p>
  <ul>{ready.accountLinkCoverage.filter(a=>a.status==='NO_TEMPLATE').map(a=>{const account=ready.chart.find(c=>c.code===a.accountCode);const root=account?.reportingCode;return <li key={a.accountCode}><bdi>{a.accountCode}</bdi> — {account?(en?account.en:account.ar):''}: {root==='3100'?t('رصيد رأس المال يُدخل في الأرصدة الافتتاحية؛ المساهمة الجديدة تحتاج مصدر حركة رأس مال.','Record existing capital through opening balances; new contributions require a capital transaction source.'):root==='3200'?t('رصيد الاحتياطي يُدخل في الأرصدة الافتتاحية؛ التحويل الجديد يحتاج تسوية حقوق ملكية.','Record existing reserves through opening balances; new transfers require an equity adjustment.'):root==='7100'?t('يحتاج ربط مصدر تكاليف التمويل بالحساب التفصيلي.','Link the financing-cost source to this detail account.'):t('يحتاج مزامنة مع قالب مصدر العملية المناسب لهذا الحساب.','Synchronize this account with its appropriate transaction-source template.')}</li>})}</ul>
 </section>}
 {ready?.accountLinkCoverage?.some(a=>a.status==='NEEDS_COMPLETION')&&<section className="fs-card" role="status">
  <strong>{t('قواعد تحتاج استكمال الربط التفصيلي','Rules requiring complete detail mapping')}</strong>
  <p>{t('يوجد ربط لهذه الحسابات، لكن أحد أطراف القاعدة لا يزال حسابًا رئيسيًا أو غير صالح للترحيل. لا يُعد الربط مكتملًا حتى تصحيح الطرفين.','These accounts have rules, but at least one leg is still a control account or is not eligible for posting. Both legs must be valid before mapping is complete.')}</p>
  <p>{ready.accountLinkCoverage.filter(a=>a.status==='NEEDS_COMPLETION').map(a=>{const account=ready.chart.find(c=>c.code===a.accountCode);return account?a.accountCode+' — '+(en?account.en:account.ar):a.accountCode}).join(' · ')}</p>
 </section>}
 {ready&&<div className="fs-card" role="status">
  <strong>{t('الحالة الفعلية لقواعد الترحيل','Actual posting rules status')}</strong>
  <p>{t('حالة السياسة: ','Policy status: ')}{ready.policy?.status==='APPROVED'?t('معتمدة','Approved'):ready.policy?.status==='DRAFT'?t('مسودة غير معتمدة','Unapproved draft'):t('لم تُنشأ','Not created')} · {t('قواعد محفوظة: ','Saved rules: ')}<bdi>{ready.policy?.rules.length??0}</bdi> · {t('قواعد معروضة: ','Displayed rules: ')}<bdi>{rules.length}</bdi> · {t('قواعد معتمدة: ','Approved rules: ')}<bdi>{approvedRuleCount}</bdi></p>
  {ready.approvedPolicy?.status==='APPROVED'&&ready.policy?.status==='DRAFT'&&<p>{t('توجد مسودة أحدث قيد الإعداد؛ السياسة المعتمدة السابقة باقية سارية حتى اعتماد بديلها.','A newer draft is being prepared; the prior approved policy remains active until its replacement is approved.')}</p>}
  {(ready.approvedPolicy?.status==='APPROVED'||ready.policy?.status==='APPROVED')&&approvedRuleCount===0&&<p role="alert">{t('تنبيه: تم اعتماد سياسة فارغة دون قواعد مدين ودائن. هذا لا يعني أن خريطة الترحيل المحاسبية جاهزة. جهّز القواعد الافتراضية في مسودة جديدة، ثم راجعها واعتمدها.','Warning: An empty policy was approved with no debit/credit rules. This does not mean accounting posting rules are configured. Prepare default rules in a new draft, then review and approve them.')}</p>}
  {ready.events.length===0&&<p>{t('لا توجد سندات فعلية في هذه السنة. يمكن تجهيز قواعد استباقية فقط باستخدام تصنيفات المؤسسة الحقيقية؛ لن تُعد مختبرة على حركات حتى تبدأ العمليات.','No actual vouchers exist for this year. Future rules may be prepared using real organization classifications, but they are untested on live transactions until operations begin.')}</p>}
  {duplicateRules&&<p role="alert">{t('هناك قواعد مكررة لنفس نوع الحدث والمصدر والتصنيف واتجاه النقد.','Duplicate rules exist for the same event/source/classification/cash direction.')}</p>}
 </div>}
 {ready&&<section className="fs-card fiscal-source-assignment"><strong>{t('إضافة أو تعديل ربط حساب','Add or edit account mapping')}</strong><p>{t('اختر العملية والتصنيف، ثم اختر الحساب الفرعي من القوائم. يظهر الحساب المقابل المقترح ومعاينة القيد قبل الحفظ.','Choose an operation and classification, then select detail accounts. Review the suggested counterpart and journal preview before saving.')}</p><div className="fs-filter-strip"><label>{t('العملية والتصنيف','Operation and classification')}<select value={guidedKey} onChange={e=>setGuidedKey(e.target.value)}><option value="">{t('اختر العملية','Choose operation')}</option>{guidedRules.map(r=><option key={postingRuleKey(r)} value={postingRuleKey(r)}>{postingLabel(r.sourceModule,en)} · {postingLabel(r.eventType,en)} · {ready.classifications?.find(c=>c.id===r.classificationId.split(':')[0])?.name??postingLabel(r.classificationId.split(':')[0],en)} · {r.classificationId.split(':').slice(1).map(p=>postingLabel(p,en)).join(' / ')} · {postingLabel(r.cashDirection,en)}</option>)}</select></label><button className="fs-outline" type="button" disabled={!guidedKey||locked||!ready.canSave} onClick={openGuidedRule}>{t('اختيار الحسابات ومعاينة الربط','Choose accounts and preview')}</button></div><small>{t('إذا لم تجد العملية، أضف واحفظ القواعد الافتراضية أولًا. العمليات غير المدعومة تحتاج قالب مصدر؛ لا ننشئ قيدًا افتراضيًا لها.','If the operation is missing, add and save defaults first. Unsupported operations require a source template.')}</small></section>}
 {ready&&<>
 <PostingRulesTable en={en} rules={rules} chart={ready.chart} classifications={ready.classifications??[]}
  events={ready.events} version={ready.policy?.version??0} editable={ready.canSave&&!locked}
  selection={selection} onSelect={setSelection}
  onChange={(index,rule)=>setRules(items=>items.map((item,i)=>i===index?rule:item))}
  onRemove={index=>{setRules(items=>items.filter((_,i)=>i!==index));setSelection(null);}}/>
 </>}
 {!/DENIED|UNAUTHORIZED/.test(error)&&<FiscalPeriodControl key={org+':'+reload} organization={org} en={en}/>}<div className="fs-filter-strip">{!setupEmbedded&&<TopbarOrganizationControls><WorkspaceOrganizationPicker ar={!en} label={t('المؤسسة','Organization')} organizations={orgs} value={org} restore={false} disabled={busy||setupEmbedded} beforeChange={()=>!ready||!dirty||window.confirm(t('تجاهل التغييرات غير المحفوظة؟','Discard unsaved changes?'))} onChange={id=>{setOrg(id);setDate(orgs.find(o=>o.id===id)?.currentFiscalStart??'')}}/></TopbarOrganizationControls>}<label>{t('بداية السنة','Fiscal start')}<input disabled={busy} type="date" value={date} onChange={e=>{if(e.target.value&&(!dirty||window.confirm(t('تجاهل التغييرات غير المحفوظة؟','Discard unsaved changes?'))))setDate(e.target.value)}}/></label><button disabled={busy} onClick={()=>{if(!dirty||window.confirm(t('تجاهل التغييرات غير المحفوظة؟','Discard unsaved changes?')))setReload(v=>v+1);}}>{t('تحديث','Refresh')}</button></div>
 {error&&<p role="alert">{errors[error]??t('تعذر تنفيذ العملية أو لا توجد الصلاحيات المطلوبة.','The operation is unavailable or the required permission is missing.')}</p>}{busy&&<p role="status">{t('جار المعالجة…','Working…')}</p>}
 {coverage&&<section className="fs-card" aria-label={t('فحص تغطية الترحيل','Posting coverage check')}>
  <strong>{t('تغطية السندات الفعلية بدليل الحسابات','Actual source-voucher mapping coverage')}</strong>
  <p role="status">{t('سطور مرتبطة بقواعد واضحة: ','Lines with exactly one configured mapping: ')}{coverage.mappedLines} / {coverage.lineCount} · {t('السندات: ','Vouchers: ')}{coverage.eventCount}</p>
  {coverage.eventCount===0?<p>{t('لا توجد عمليات لاختبار القواعد عليها بعد. تجهيز القواعد لا يعني التحقق من تطبيقها على عمليات فعلية.','No operations are available to test these rules yet. Configuring rules does not verify their application to actual operations.')}</p>:coverage.missingLines===0&&coverage.ambiguousLines===0&&coverage.emptyEvents===0?<p>{t('جميع سطور السندات المتاحة لها قاعدة ترحيل واحدة.','Every available source line has exactly one posting rule.')}</p>:<>
   <p role="alert">{t('سطور بلا ربط: ','Unmapped lines: ')}{coverage.missingLines} · {t('سطور بقواعد متعارضة: ','Ambiguous lines: ')}{coverage.ambiguousLines} · {t('سندات بلا تفاصيل: ','Vouchers without lines: ')}{coverage.emptyEvents}</p>
   {coverage.groups.filter(g=>g.status!=='MAPPED').map(g=><p key={key(g)}>{g.sourceModule} · {g.eventType} · {g.classificationId} · {g.cashDirection} — {g.lineCount} {t('سطور','lines')}</p>)}
  </>}
 </section>}
 {ready&&<>
 {ready.canSave&&<details className="fs-card">
  <summary>{t('إضافة تصنيف مصروف تشغيلي','Add an operating expense classification')}</summary>
  <p>{t('أضف تصنيفًا مثل إيجار المكتب أو الصيانة، ثم اربطه بقاعدة ترحيل وفئة تدفق في السيولة.','Create a classification such as office rent or maintenance, then use it in a posting rule and a liquidity category.')}</p>
  <form className="fs-filter-strip" onSubmit={e=>{e.preventDefault();void createExpenseClassification();}}>
   <label>{t('الاسم','Name')}<input required maxLength={160} value={expenseName} onChange={e=>setExpenseName(e.target.value)}/></label>
   <label>{t('الرمز','Code')}<input required dir="ltr" pattern="OPEX_[A-Z0-9_]{1,45}" placeholder="OPEX_RENT" value={expenseCode} onChange={e=>setExpenseCode(e.target.value.toUpperCase())}/></label>
   <button disabled={busy||dirty}>{t('إضافة التصنيف','Add classification')}</button>
  </form>
  {dirty&&<p>{t('احفظ تعديلات القواعد أولًا.','Save rule edits first.')}</p>}
 </details>}
 {ready.canSave&&!locked&&<details className="fs-card" aria-label={t('تعريف قاعدة ترحيل جديدة','Define a new posting rule')}>
  <summary>{t('إعدادات متقدمة: إضافة قاعدة للعمليات القادمة','Advanced: add a rule for future transactions')}</summary>
  <p>{t('اختر تصنيف العملية ومصدرها كما يظهران في السند.','Select the transaction classification and source as they appear in the voucher.')}</p>
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
 </details>}
 {!locked&&<p>{t('أكمل الحسابات الفرعية واحفظ المسودة لتفعيل الاعتماد. بعد الاعتماد تسري النسخة على عمليات الترحيل الجديدة.','Complete the detail mappings and save the draft to enable approval. The approved version applies to subsequent postings.')}</p>}
 <label>{t('سبب الإعداد أو التغيير','Setup or change reason')}<textarea aria-label={t('سبب الإعداد أو التغيير','Setup or change reason')} disabled={locked} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>{ready.policy?.status==='APPROVED'&&<button disabled={busy||!ready.canSave} onClick={()=>{setData({...ready,policy:{...ready.policy!,status:'DRAFT',version:0}})}}>{t('إعداد نسخة جديدة','Prepare a new version')}</button>}</>}
 </div>;
}
