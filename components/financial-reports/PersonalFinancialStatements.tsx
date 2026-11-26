'use client';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {riyadhToday} from '../../lib/financial-register';
import type {PersonalReport} from '../../lib/personal-financial-reports';
import {personalFinancialExportRows,personalCashActivityLabel,personalIncomeLabel,type PersonalExportView} from '../../lib/personal-financial-export';
import {financialSourceRowsCsv} from '../../lib/financial-budget-source';
import './financial-reports-suite.css';
import './financial-reporting-source.css';

type Tab='overview'|'position'|'cash'|'accounts'|'income';
const tabs:ReadonlyArray<[Tab,string,string]>=[
 ['overview','الملخص الشخصي','Personal overview'],
 ['position','المركز المالي','Financial position'],
 ['cash','الحركة النقدية','Cash movement'],
 ['accounts','الدليل المبسّط','Simple chart'],
 ['income','الدخل والمصروفات','Income & expenses'],
];
const format=(value:string|null)=>value===null?'—':value.replace(/\B(?=(\d{3})+(?!\d))/g,',');

export default function PersonalFinancialStatements({english=false}:{english?:boolean}){
 const[tab,setTab]=useState<Tab>('overview'),[from,setFrom]=useState(()=>riyadhToday().slice(0,4)+'-01-01'),
  [to,setTo]=useState(()=>riyadhToday()),[snapshot,setReport]=useState<PersonalReport|null>(null),
  [busy,setBusy]=useState(true),[error,setError]=useState(''),[exporting,setExporting]=useState(false),[exportError,setExportError]=useState('');
 const t=(ar:string,en:string)=>english?en:ar;
 const report=snapshot?.from===from&&snapshot.to===to?snapshot:null;
 const exportKey=[from,to,tab,english].join('|'),selection=useRef('');
 useLayoutEffect(()=>{selection.current=exportKey;return()=>{selection.current=''}},[exportKey]);
 useEffect(()=>{
  const abort=new AbortController();setReport(null);setBusy(true);setError('');
  fetch('/api/financial-reporting/personal?'+new URLSearchParams({from,to}),{cache:'no-store',signal:abort.signal})
   .then(async response=>{if(!response.ok)throw Error(response.status===401?'UNAUTHORIZED':response.status===400?'INVALID_PERIOD':'UNAVAILABLE');return response.json() as Promise<PersonalReport>})
   .then(value=>{if(!abort.signal.aborted){if(value.scope!=='PERSONAL'||value.from!==from||value.to!==to)throw Error('UNAVAILABLE');setReport(value)}})
   .catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'UNAVAILABLE')})
   .finally(()=>{if(!abort.signal.aborted)setBusy(false)});
  return()=>abort.abort();
 },[from,to]);
 function save(blob:Blob,name:string){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 async function download(kind:'csv'|'xlsx'|'print'){
  if(busy||!report||tab==='income'&&!report.recognizedIncome?.length||exporting)return;
  const key=selection.current;setExporting(true);setExportError('');
  try{
   // Re-read with the authenticated user at export time. Never trust a cached
   // personal register after the user loses access or changes report scope.
   const response=await fetch('/api/financial-reporting/personal?'+new URLSearchParams({from,to}),{cache:'no-store'});
   if(selection.current!==key)return;
   if(response.status===401){setReport(null);setError('UNAUTHORIZED');return;}
   if(!response.ok)throw Error('PERSONAL_EXPORT_UNAVAILABLE');
   const fresh=await response.json() as PersonalReport;
   if(fresh.scope!=='PERSONAL'||fresh.from!==from||fresh.to!==to||selection.current!==key)return;
   const rows=personalFinancialExportRows(fresh,tab as PersonalExportView,english);
   if(selection.current!==key)return;
   setReport(fresh);
   if(kind==='print'){await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));if(selection.current===key)window.print();return;}
   const filename=`yaqeen-personal-estimate-${tab}-${from}-${to}`;
   if(kind==='csv'){save(new Blob([financialSourceRowsCsv(rows)],{type:'text/csv;charset=utf-8'}),filename+'.csv');return;}
   const {Workbook}=await import('exceljs');if(selection.current!==key)return;
   const book=new Workbook(),sheet=book.addWorksheet('Personal');sheet.views=[{rightToLeft:!english}];
   rows.forEach(row=>sheet.addRow(row));sheet.columns.forEach((col,index)=>col.width=index===0?48:26);
   const bytes=await book.xlsx.writeBuffer();if(selection.current===key)save(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),filename+'.xlsx');
  }catch{if(selection.current===key)setExportError('PERSONAL_EXPORT_FAILED')}finally{setExporting(false)}
 }
 const currencyAmount=(value:string|null,currency:string)=><bdi dir="ltr">{format(value)} {currency}</bdi>;
 const incomplete=report?.positions.some(p=>!p.complete)??false;
 return <main className="fs-root fs-connected fs-personal-reports" dir={english?'ltr':'rtl'} lang={english?'en':'ar'}>
  <header className="fs-personal-head"><div><span className="fs-personal-eyebrow">{t('يقين الأعمال · النطاق الشخصي','Yaqeen Business · Personal')}</span><h1>{t('قوائمي المالية الشخصية','My personal financial reports')}</h1><p>{t('تُستمد هذه المعاينة من حساباتك وأصولك وذممك الشخصية فقط، دون بيانات أي مؤسسة.','This read-only view uses your personal accounts, assets and debts only — never an organization’s books.')}</p></div><div className="fs-personal-actions"><span className="fs-personal-scope">{t('شخصي','Personal')}</span><button type="button" disabled={busy||!report||tab==='income'&&!report.recognizedIncome?.length||exporting} onClick={()=>download('xlsx')}>{exporting?t('جارٍ التجهيز…','Preparing…'):t('Excel','Excel')}</button><button type="button" disabled={busy||!report||tab==='income'&&!report.recognizedIncome?.length||exporting} onClick={()=>download('csv')}>CSV</button><button type="button" disabled={busy||!report||tab==='income'&&!report.recognizedIncome?.length||exporting} onClick={()=>download('print')}>{t('طباعة / PDF','Print / PDF')}</button></div></header>
  <div className="fs-personal-tabs" role="tablist" aria-label={t('أنواع التقارير الشخصية','Personal report views')}>
   {tabs.map(([id,ar,en])=><button key={id} type="button" role="tab" aria-selected={tab===id} onClick={()=>setTab(id)}>{english?en:ar}</button>)}
  </div>
  <div className="fs-personal-period"><label>{t('من تاريخ','From')}<input aria-label={t('بداية الفترة','Period start')} type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)}/></label><label>{t('إلى تاريخ','To')}<input aria-label={t('نهاية الفترة','Period end')} type="date" value={to} min={from} max={riyadhToday()} onChange={e=>setTo(e.target.value)}/></label>{report&&<small>{t('المركز المالي بتاريخ','Financial position as of')} {report.asOf}</small>}</div>
  {report&&<p className="fs-personal-print-context">
   {tabs.find(([id])=>id===tab)?.[english?2:1]} · {t('المركز المالي بتاريخ','Financial position as of')} <bdi>{report.asOf}</bdi>
   {' · '}{t('فترة الحركة النقدية','Cash movement period')} <bdi>{report.from} – {report.to}</bdi>
  </p>}
  <p className="fs-personal-disclaimer">{t('عرض شخصي تقديري من الأرصدة الحالية، وليس قوائم مدققة أو دفتر قيود شركات. لا تُجمع العملات المختلفة تلقائيًا.','Personal current-balance estimate, not audited statements or corporate journals. Different currencies are not silently combined.')}</p>
  {busy&&<p role="status" className="fs-source-loading">{t('جارٍ قراءة سجلاتك الشخصية…','Loading your personal registers…')}</p>}
  {error&&<div className="fs-source-error" role="alert">{error==='UNAUTHORIZED'?t('يرجى تسجيل الدخول للاطلاع على سجلاتك الشخصية.','Sign in to view your personal records.'):error==='INVALID_PERIOD'?t('الفترة المحددة غير صحيحة.','Invalid reporting period.'):t('تعذر التحقق من السجلات الشخصية؛ لن تُعرض أرقام بديلة.','Personal source verification failed; no substitute figures are shown.')}</div>}
  {exportError&&<div className="fs-source-error" role="alert">{t('تعذّر تجهيز التصدير من بيانات شخصية متحقق منها. حاول التحديث، دون حفظ ملف غير مكتمل.','Could not prepare a verified personal export. Refresh and retry; no incomplete file was saved.')}</div>}
  {!busy&&!error&&report&&<>
   {!report.positions.length&&!report.cashAccounts.length&&<div className="fs-personal-empty">{t('لا توجد أرصدة شخصية مسجلة بعد. يمكنك البدء من موديول الأصول أو النقد والبنوك.','No personal balances are recorded yet. Start in Assets or Cash & Banks.')}</div>}
   {(tab==='overview'||tab==='position')&&<div className="fs-personal-cards">{report.positions.map(p=><article key={p.currency} className="fs-personal-card"><div className="fs-personal-card-title"><h2>{t('المركز المالي','Financial position')} · {p.currency}</h2><span>{p.complete?t('قابل للحساب','Calculated'):t('يتطلب تسوية','Reconciliation needed')}</span></div><div className="fs-personal-summary"><span>{t('النقد والبنوك','Cash & banks')}</span><strong>{currencyAmount(p.cash,p.currency)}</strong><span>{t('الذمم المدينة','Receivables')}</span><strong>{currencyAmount(p.receivables,p.currency)}</strong><span>{t('الاستثمارات','Investments')}</span><strong>{currencyAmount(p.investments,p.currency)}</strong><span>{t('الأصول الأخرى','Other assets')}</span><strong>{currencyAmount(p.otherAssets,p.currency)}</strong><span>{t('الالتزامات','Liabilities')}</span><strong>{currencyAmount(p.liabilities,p.currency)}</strong></div><div className="fs-personal-net"><span>{t('صافي الثروة','Net worth')}</span><strong>{currencyAmount(p.netWorth,p.currency)}</strong></div>{!p.complete&&<p>{t('صافي الثروة محجوب حتى تسوية الأرصدة غير المصنّفة أو غير المربوطة.','Net worth is withheld until unclassified or unallocated balances are reconciled.')}</p>}</article>)}</div>}
   {(tab==='overview'||tab==='position')&&report.historicalPosition?.length>0&&<section className="fs-personal-panel">
    <h2>{t('الأرصدة النقدية والذمم بتاريخ القطع','Cash and debts at the cutoff')} · <bdi>{report.to}</bdi></h2>
    <p>{t('تظهر الأرصدة القابلة للمطابقة مع الحركات والافتتاحي. صافي الثروة التاريخي يحتاج تقييمات الأصول في تاريخ القطع.',
     'Balances appear when they reconcile to dated and opening movements. Historical net worth requires asset valuations at the cutoff.')}</p>
    <div className="fs-table-scroll"><table className="fs-table">
     <thead><tr><th>{t('العملة','Currency')}</th><th>{t('النقد','Cash')}</th><th>{t('الذمم المدينة','Receivables')}</th><th>{t('الالتزامات','Liabilities')}</th><th>{t('الدفعات المقدمة','Advances paid')}</th><th>{t('الدفعات المستلمة مقدمًا','Advances received')}</th></tr></thead>
     <tbody>{report.historicalPosition.map(p=><tr key={p.currency}><td>{p.currency}</td><td>{format(p.cash)}</td><td>{format(p.receivables)}</td><td>{format(p.liabilities)}</td><td>{format(p.supplierAdvances)}</td><td>{format(p.customerAdvances)}</td></tr>)}</tbody>
    </table></div>
   </section>}
   {(tab==='overview'||tab==='position')&&Boolean(report.historicalAssetValuations?.length)&&<section className="fs-personal-panel">
    <h2>{t('تقييمات أصول مثبتة بتاريخ القطع','Asset valuations verified at the cutoff')} · <bdi>{report.to}</bdi></h2>
    <p>{t('يتضمن هذا الجدول الأصول التي أمكن مطابقة رصيدها وسعر تقييمها المحفوظ في هذا التاريخ. التغطية جزئية.','This table includes assets with a reconciled holding and recorded valuation for this date. Coverage is partial.')}</p>
    <div className="fs-table-scroll"><table className="fs-table"><thead><tr><th>{t('الأصل','Asset')}</th><th>{t('التكلفة الدفترية','Carrying cost')}</th><th>{t('قيمة التقييم المسجّلة','Recorded valuation')}</th></tr></thead>
     <tbody>{report.historicalAssetValuations?.map(row=><tr key={row.id}><td>{row.name}</td><td>{currencyAmount(row.cost,row.currency)}</td><td>{currencyAmount(row.market,row.currency)}</td></tr>)}</tbody>
    </table></div>
   </section>}
   {(tab==='overview'||tab==='cash')&&<section className="fs-personal-panel"><h2>{t('حركة الحسابات النقدية خلال الفترة','Cash account movement for the period')}</h2><p>{t('تتضمن إجماليات الداخل والخارج التحويلات بين الحسابات الشخصية، لذلك لا تُعد قائمة تدفقات تشغيلية. صافي الحركة لكل حساب يُعرض مستقلًا.','Gross inflows and outflows may include transfers between your accounts. This is not an operating cash-flow statement; each account’s net movement is shown separately.')}</p><div className="fs-table-scroll"><table className="fs-table"><thead><tr><th>{t('الحساب','Account')}</th><th>{t('العملة','Currency')}</th><th>{t('رصيد أول الفترة','Opening')}</th><th>{t('مقبوضات','Inflows')}</th><th>{t('مدفوعات','Outflows')}</th><th>{t('صافي الحركة','Net movement')}</th><th>{t('آخر الفترة','Closing')}</th></tr></thead><tbody>{report.cashAccounts.map(a=><tr key={a.id}><td>{a.name}</td><td>{a.currency}</td><td dir="ltr">{format(a.opening)}</td><td dir="ltr">{format(a.inflows)}</td><td dir="ltr">{format(a.outflows)}</td><td dir="ltr">{format(a.netMovement)}</td><td dir="ltr">{format(a.closing)}</td></tr>)}{!report.cashAccounts.length&&<tr><td colSpan={7}>{t('لا توجد حسابات نقدية شخصية مسجلة.','No personal cash accounts are recorded.')}</td></tr>}</tbody></table></div></section>}
   {(tab==='overview'||tab==='cash')&&report.cashTransferReconciliation?.length>0&&<section className="fs-personal-panel"><h2>{t('تسوية التحويلات الداخلية المثبتة','Verified internal transfer reconciliation')}</h2><p>{t('يُظهر المتبقي إجمالي الحركة بعد فصل التحويلات المثبتة. يعرض جدول التدفقات حسب النشاط تصنيف الحركات المتبقية.','The remainder shows gross movements after verified internal transfers are separated. The cash activity table classifies the remaining movements.')}</p><div className="fs-table-scroll"><table className="fs-table"><thead><tr><th>{t('العملة','Currency')}</th><th>{t('التحويلات الداخلة المثبتة','Verified internal in')}</th><th>{t('التحويلات الخارجة المثبتة','Verified internal out')}</th><th>{t('المقبوضات المتبقية','Remaining inflows')}</th><th>{t('المدفوعات المتبقية','Remaining outflows')}</th><th>{t('التحقق','Evidence')}</th></tr></thead><tbody>{report.cashTransferReconciliation.map(r=><tr key={r.currency}><td>{r.currency}</td><td dir="ltr">{format(r.verifiedInternalInflows)}</td><td dir="ltr">{format(r.verifiedInternalOutflows)}</td><td dir="ltr">{format(r.remainingUnclassifiedInflows)}</td><td dir="ltr">{format(r.remainingUnclassifiedOutflows)}</td><td>{r.transferEvidenceComplete?t('مكتمل للتحويلات المسجلة','Recorded transfers matched'):t(`${r.unverifiedLegs} حركة تحتاج تحقق`,`${r.unverifiedLegs} legs need review`)}</td></tr>)}</tbody></table></div></section>}
   {(tab==='overview'||tab==='cash')&&Boolean(report.purchaseFunding?.length)&&<section className="fs-personal-panel">
    <h2>{t('تمويل شراء الأصول وفرق الصرف','Asset purchase funding and FX difference')}</h2>
    <div className="fs-table-scroll"><table className="fs-table"><thead><tr>
     <th>{t('التاريخ','Date')}</th><th>{t('الحركة','Movement')}</th><th>{t('مبلغ الدفع','Payment')}</th>
     <th>{t('تكلفة الأصل','Asset cost')}</th><th>{t('تكلفة دفعات النقد','Cash lot cost')}</th>
     <th>{t('فرق الصرف المحقق','Realized FX')}</th>
    </tr></thead><tbody>{report.purchaseFunding?.map(row=><tr key={row.id}>
     <td><bdi>{row.date}</bdi></td><td>{row.reversed?t('عكس','Reversal'):t('شراء','Purchase')}</td>
     <td><bdi dir="ltr">{row.payment} {row.currency}</bdi></td><td><bdi dir="ltr">{row.assetBasis} {row.baseCurrency}</bdi></td>
     <td><bdi dir="ltr">{row.cashBasis} {row.baseCurrency}</bdi></td><td><bdi dir="ltr">{row.realizedFx} {row.baseCurrency}</bdi></td>
    </tr>)}</tbody></table></div>
   </section>}
   {tab==='accounts'&&<section className="fs-personal-panel"><h2>{t('تصنيفات الحسابات الشخصية التلقائية','Automatic personal account categories')}</h2><p>{t('هذا دليل عرض وتصنيف من المصدر الحالي، ولا ينشئ حسابات أو قيودًا جديدة.','This is a read-only classification of current sources; it creates no accounts or journal entries.')}</p><div className="fs-table-scroll"><table className="fs-table"><thead><tr><th>{t('رمز التصنيف','Reporting code')}</th><th>{t('الحساب','Category')}</th><th>{t('العملة','Currency')}</th><th>{t('الرصيد','Balance')}</th></tr></thead><tbody>{report.categories.map(c=><tr key={c.code+':'+c.currency}><td dir="ltr">{c.code}</td><td>{english?c.en:c.ar}</td><td>{c.currency}</td><td dir="ltr">{format(c.amount)}</td></tr>)}</tbody></table></div></section>}
   {(tab==='overview'||tab==='cash')&&report.cashByActivity?.length>0&&<section className="fs-personal-panel">
    <h2>{t('التدفقات حسب النشاط','Cash flows by activity')}</h2>
    <p>{t('تظهر الحركات ذات المصدر المثبت حسب نشاطها، ويظل الباقي غير مصنّف.','Verified source movements are grouped by activity. Other movements remain unclassified.')}</p>
    <div className="fs-table-scroll"><table className="fs-table">
     <thead><tr><th>{t('النشاط','Activity')}</th><th>{t('العملة','Currency')}</th><th>{t('المقبوضات','Inflows')}</th><th>{t('المدفوعات','Outflows')}</th><th>{t('الصافي','Net')}</th></tr></thead>
     <tbody>{report.cashByActivity.map(r=><tr key={r.currency+r.activity}><td>{personalCashActivityLabel(r.activity,english)}</td><td>{r.currency}</td><td>{format(r.inflows)}</td><td>{format(r.outflows)}</td><td>{format(r.net)}</td></tr>)}</tbody>
    </table></div>
   </section>}
   {tab==='income'&&<section className="fs-personal-panel">
    <h2>{t('دخل وتكاليف العقود المسجلة','Recognized contract income and costs')}</h2>
    <p>{t('يغطي العرض عوائد التمويل وتكاليفه وحصص المشاركة المثبتة ودخل الاستثمار المقبوض. تحتاج الحركات العامة إلى تصنيف مسجّل.',
     'This view covers verified financing and participation amounts and investment income received. Other movements need a recorded classification.')}</p>
    {report.recognizedIncome?.length>0?<div className="fs-table-scroll"><table className="fs-table">
     <thead><tr><th>{t('التاريخ','Date')}</th><th>{t('التصنيف','Category')}</th><th>{t('المبلغ','Amount')}</th></tr></thead>
     <tbody>{report.recognizedIncome.map(r=><tr key={r.id}><td><bdi>{r.date}</bdi></td><td>{personalIncomeLabel(r.category,english)}</td><td>{currencyAmount(r.amount,r.currency)}</td></tr>)}</tbody>
    </table></div>:<p>{t('لا توجد مبالغ عقود مثبتة لهذه الفترة.','No verified contract amounts for this period.')}</p>}
   </section>}
   {incomplete&&<div className="fs-personal-warning" role="status">{t('توجد أرصدة تستلزم تسوية قبل احتساب صافي الثروة.','Some balances require reconciliation before net worth can be calculated.')}</div>}
  </>}
 </main>;
}
