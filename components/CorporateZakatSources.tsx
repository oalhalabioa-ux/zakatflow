'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {manualZakatFields,type ManualZakatInput} from '../lib/manual-zakat-assessment';
import {corporateError,mergeCorporateSource,sourceValues,type CorporateSource} from '../lib/corporate-zakat-assessment';
const warningNames:Record<string,string>={FOREIGN_CASH_REQUIRES_VALUATION:'أرصدة نقدية بعملات أجنبية تحتاج تقييمًا بسعر تاريخ التقييم.',NEGATIVE_CASH_REQUIRES_REVIEW:'رصيد نقدي سالب يحتاج مراجعة مستقلة.',HISTORICAL_REVERSALS_REQUIRE_REVIEW:'توجد قيود معكوسة؛ راجع أثرها على الأرصدة التاريخية.',ASSET_HISTORY_REQUIRES_REVIEW:'توجد حركة أصل بعد تاريخ التقييم؛ لم نستخدم رصيده الحالي بدل الرصيد التاريخي.',FOREIGN_INVESTMENT_REQUIRES_VALUATION:'استثمارات بعملة أجنبية تحتاج تقييمًا مستقلًا.'};
const contextKey=(input:ManualZakatInput|CorporateSource)=>[input.model,input.organization_id,input.assessment_date,input.period_start,input.currency].join(':');
type ScopedSource={value:CorporateSource;epoch:number};
export default function CorporateZakatSources({input,onChange,disabled=false}:{input:ManualZakatInput;onChange:(next:ManualZakatInput)=>void;disabled?:boolean}){
 const [source,setSource]=useState<ScopedSource|null>(null),[proposal,setProposal]=useState<ScopedSource|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const latest=useRef(input),apply=useRef(onChange),unavailable=useRef(disabled);latest.current=input;apply.current=onChange;unavailable.current=disabled;
 const epoch=useRef(0),request=useRef(0),active=useRef(false),pending=useRef<AbortController|null>(null);
 const scopeKey=contextKey(input);
 useLayoutEffect(()=>{
  // Opening or changing the assessment never creates a persisted source snapshot.
  active.current=true;epoch.current++;request.current++;
  setBusy(false);setSource(null);setProposal(null);setError('');
  return()=>{active.current=false;epoch.current++;request.current++;pending.current?.abort();pending.current=null;};
 },[scopeKey,disabled]);
 async function load(){
  const start=latest.current;
  if(!active.current||unavailable.current||!start.organization_id||pending.current)return;
  const controller=new AbortController(),version=epoch.current,requestId=++request.current,key=contextKey(start);
  pending.current=controller;
  const isCurrent=()=>active.current&&!unavailable.current&&!controller.signal.aborted&&epoch.current===version&&request.current===requestId&&contextKey(latest.current)===key;
  setBusy(true);setProposal(null);setError('');
  try{
   const response=await fetch('/api/assessments/corporate/sources',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({organization_id:start.organization_id,model:start.model,assessment_date:start.assessment_date,period_start:start.period_start})});
   const data=await response.json();
   if(!isCurrent())return;
   if(!response.ok)throw Error(data.error);
   if(data.currency!==start.currency)throw Error('CORPORATE_ZAKAT_BASE_CURRENCY_REQUIRED');
   if(contextKey(data)!==key)throw Error('CORPORATE_ZAKAT_SOURCE_MISMATCH');
   setProposal({value:data,epoch:version});
  }catch(e){if(isCurrent())setError(corporateError((e as Error).message,true));}
  finally{if(isCurrent()){pending.current=null;setBusy(false);}}
 }
 const shown=(proposal??source)?.value,values=shown?sourceValues(shown):{};
 function applyProposal(replace:boolean){
  if(!active.current||unavailable.current||busy||!proposal||proposal.epoch!==epoch.current)return;
  try{apply.current(mergeCorporateSource(latest.current,proposal.value,replace));setSource(proposal);setProposal(null);}
  catch(e){setError(corporateError((e as Error).message,true));}
 }
 return <section className="card section corporate-zakat-sources" aria-busy={busy}><div className="page-head"><div><h3>بيانات مقترحة من السجلات</h3><p className="muted">الأرقام للمراجعة الزكوية؛ احتفظنا بمصدرها وتاريخها. البنود غير المتاحة تبقى فارغة حتى مراجعتها.</p></div><button className="btn secondary" type="button" disabled={busy||disabled||!input.organization_id} onClick={()=>void load()}>{busy?'جار تحميل الأرصدة…':'تحديث من السجلات'}</button></div>
 {error&&<p role="alert">{error}</p>}
 {!input.source_snapshot_id&&!shown&&<p className="muted">اختر «تحديث من السجلات» لجلب نسخة محفوظة لأرصدة الشركة والفترة المحددتين، ثم راجع المقترحات قبل تعبئة البنود أو استبدالها.</p>}
 {input.source_snapshot_id&&!shown&&<p className="muted">يرتبط هذا الإدخال بنسخة محفوظة من السجلات. يمكنك جلب تحديث ومراجعة الفروق.</p>}
 {shown&&<><p className="muted">تاريخ الأرصدة: <bdi>{shown.assessment_date}</bdi> · العملة: {shown.currency} · آخر جلب: <bdi>{new Date(shown.created_at).toLocaleString('en-GB')}</bdi></p>
 {proposal&&<><p className="notice">راجع المقارنة قبل تطبيق التحديث؛ التعديلات الحالية محفوظة حتى تختار الإجراء.</p><div className="manual-zakat-history"><table className="table"><thead><tr><th>البند</th><th>القيمة الحالية</th><th>من السجلات</th></tr></thead><tbody>{manualZakatFields[input.model].map(f=><tr key={f.key}><td>{f.ar}</td><td dir="ltr">{input.values[f.key]??'—'}</td><td dir="ltr">{values[f.key]??'يحتاج مراجعة'}</td></tr>)}</tbody></table></div><div className="manual-zakat-actions"><button className="btn" type="button" disabled={busy||disabled} onClick={()=>applyProposal(false)}>تعبئة البنود الفارغة</button><button className="btn secondary" type="button" disabled={busy||disabled} onClick={()=>applyProposal(true)}>تطبيق القيم المعروضة من السجلات</button><button className="btn secondary" type="button" disabled={busy||disabled} onClick={()=>setProposal(null)}>إلغاء التحديث</button></div></>}
 <details><summary>مصادر البنود وتفاصيل الأصول</summary><div className="manual-zakat-history"><table className="table"><thead><tr><th>البند / الأصل</th><th>القيمة</th><th>المصدر</th><th>التاريخ</th></tr></thead><tbody>{shown.entries.map((e,i)=><tr key={e.id+':'+i}><td>{manualZakatFields[input.model].find(f=>f.key===e.field)?.ar} · {e.name}</td><td dir="ltr">{Number(e.value).toLocaleString('en-US',{maximumFractionDigits:2})}</td><td>{({LIQUIDITY:'النقد والبنوك',OBLIGATIONS:'المستحقات',ASSET_BOOK_OR_SAVED_VALUE:'قيمة دفترية / تقييم محفوظ',INVESTMENT_LEDGER:'سجل الاستثمار',FINANCIAL_LEDGER:'السجل المالي'} as Record<string,string>)[e.source]??e.source}</td><td dir="ltr">{e.date}</td></tr>)}</tbody></table></div></details>
 {shown.warnings.length>0&&<ul>{[...new Set(shown.warnings)].map(w=><li key={w}>{warningNames[w]??w}</li>)}</ul>}
 <p className="muted">{input.model==='SAUDI'?'الأصول والاستثمارات مرشحة للحسم فقط. حقوق الملكية من القيود المسجلة قد لا تشمل الأرباح المرحلة؛ راجعها مع القوائم، وحدد الربح المعدل والحدود النظامية.':'راجع خضوع الاستثمارات والمدينين ومعالجة الالتزامات قبل اعتماد القيم.'}</p></>}
 </section>;
}
