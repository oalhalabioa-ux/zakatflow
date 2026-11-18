'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import './branch-opening-distribution.css';

type Split={centerId?:string|null;branchId:string|null;debit:string;credit:string};
type Original={itemId:string;accountCode:string;debit:string;credit:string};
type Editor={
 distribution:{status:'MISSING'|'DRAFT'|'APPROVED'|'STALE';id?:string;version?:number;
  openingWorkspaceId?:string;openingVersion?:number;entries?:Record<string,Split[]>;journalCoverageComplete?:false};
 opening:{id:string;organizationId:string;fiscalStart:string;currency:string;version:number;approvedOpening:Original[]}|null;
 centers?:{id:string;name:string;branchId:string|null}[];
 branches:{id:string;name:string}[];branchRegistryComplete:false;
};
const money=/^\d{1,20}(\.\d{1,4})?$/;
function minor(v:string){if(!money.test(v))return null;const [a,b='']=v.split('.');return BigInt(a)*BigInt(10000)+BigInt(b.padEnd(4,'0'))}
async function read(response:Response){const body=await response.json().catch(()=>({error:'BRANCH_OPENING_UNAVAILABLE'}));if(!response.ok)throw Error(body.error??'BRANCH_OPENING_UNAVAILABLE');return body}
export default function BranchOpeningDistribution({locale,organization,fiscalStart,dimension=false}:{locale:string;organization:string;fiscalStart:string;dimension?:boolean}){
 const en=locale==='en',t=(ar:string,english:string)=>en?english:ar;
 const [data,setData]=useState<Editor|null>(null),[entries,setEntries]=useState<Record<string,Split[]>>({}),
  [reason,setReason]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),
  [busy,setBusy]=useState(false),[query,setQuery]=useState(''),[count,setCount]=useState(80);
 const serial=useRef(0);
 const endpoint=dimension?'/api/financial-reporting/center-openings':'/api/financial-reporting/branch-openings';
 const back='/' +(en?'en':'ar')+'/opening-balances?'+new URLSearchParams({organization,fiscalStart});
 const reload=useCallback(async(signal?:AbortSignal)=>{
  const request=++serial.current;
  setError('');setBusy(true);
  try{
   const input=await read(await fetch(endpoint+'?'+new URLSearchParams({action:'editor',organization,fiscalStart}),{cache:'no-store',signal}));
   if(signal?.aborted||request!==serial.current)return;
   const current=input as Editor;
   setData(current);
   const same=Boolean(current.opening&&current.distribution.openingWorkspaceId===current.opening.id&&
    current.distribution.openingVersion===current.opening.version);
   setEntries(same&&(current.distribution.status==='DRAFT'||current.distribution.status==='APPROVED')?
    structuredClone(current.distribution.entries??{}):{});
  }catch(e){if(!signal?.aborted&&request===serial.current){setData(null);setEntries({});setError(e instanceof Error?e.message:'BRANCH_OPENING_UNAVAILABLE')}}
  finally{if(!signal?.aborted&&request===serial.current)setBusy(false)}
 },[organization,fiscalStart,endpoint]);
 useEffect(()=>{const controller=new AbortController();void reload(controller.signal);return()=>{serial.current++;controller.abort()}},[reload]);
 const source=data?.opening;
 const status=data?.distribution.status??'MISSING';
 const savedEntries=data?.distribution.entries;
 const hasUnsavedChanges=status==='DRAFT'&&JSON.stringify(entries)!==JSON.stringify(savedEntries??{});
 const rows=source?.approvedOpening??[];
 const visible=useMemo(()=>rows.filter(r=>[r.accountCode,r.itemId].join(' ').toLowerCase().includes(query.toLowerCase())).slice(0,count),[rows,query,count]);
 const completeness=useMemo(()=>{
  let ready=0;
  const segmentTotals=new Map<string,bigint>();
  for(const r of rows){
   const parts=entries[r.itemId];
   if(!parts?.length)continue;
   const ids=new Set(parts.map(p=>JSON.stringify([p.branchId,p.centerId??null])));
   if(ids.size!==parts.length)continue;
   const debit=parts.reduce<bigint|null>((n,p)=>{const v=minor(p.debit);return n===null||v===null?null:n+v},BigInt(0));
   const credit=parts.reduce<bigint|null>((n,p)=>{const v=minor(p.credit);return n===null||v===null?null:n+v},BigInt(0));
   if(debit!==null&&credit!==null&&debit===minor(r.debit)&&credit===minor(r.credit)){
    ready++;
    for(const p of parts){
     const segment=JSON.stringify([p.branchId,p.centerId??null]);
     segmentTotals.set(segment,(segmentTotals.get(segment)??BigInt(0))+minor(p.debit)!-minor(p.credit)!);
    }
   }
  }
  return{ready,remaining:rows.length-ready,unbalanced:[...segmentTotals.values()].filter(value=>value!==BigInt(0)).length};
 },[rows,entries]);
 function add(id:string){setEntries(prev=>({...prev,[id]:[...(prev[id]??[]),{...(dimension?{centerId:null}:{}),branchId:null,debit:'0.0000',credit:'0.0000'}]}))}
 function change(id:string,index:number,patch:Partial<Split>){
  setEntries(prev=>({...prev,[id]:(prev[id]??[]).map((x,i)=>i===index?{...x,...patch}:x)}));
 }
 function remove(id:string,index:number){setEntries(prev=>({...prev,[id]:(prev[id]??[]).filter((_,i)=>i!==index)}))}
 const editable=Boolean(source&&status!=='APPROVED');
 const canApprove=status==='DRAFT'&&!hasUnsavedChanges&&completeness.remaining===0&&(!dimension||completeness.unbalanced===0);
 async function command(action:'save'|'approve'|'correct'){
  if(!source||!data||(action==='approve'&&!canApprove))return;setBusy(true);setError('');setNotice('');
  const stamp=serial.current;
  const current=data.distribution;
  const body=action==='approve'?{action:'approve',id:current.id,expectedVersion:current.version}:{
   action:'save',organization,fiscalStart,expectedVersion:action==='correct'?0:(status==='DRAFT'?current.version??0:0),
   openingWorkspace:source.id,openingVersion:source.version,entries:action==='correct'?current.entries??{}:entries,reason,
  };
  try{
   await read(await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
   if(stamp!==serial.current)return;
   setNotice(action==='approve'?(dimension?t('تم اعتماد توزيع الافتتاحي على المراكز.','Opening center allocation approved.'):t('تم اعتماد توزيع الافتتاحي. لا يعني ذلك اعتماد قوائم الفروع بعد.','Opening allocation approved; branch statements still require complete journal reconciliation.')):
    t('تم حفظ مسودة التوزيع.','Allocation draft saved.'));
   await reload();
  }catch(e){if(stamp===serial.current){setError(e instanceof Error?e.message:'BRANCH_OPENING_UNAVAILABLE');if(/DENIED|UNAUTHORIZED/.test(String(e)))setData(null)}}
  finally{if(stamp===serial.current)setBusy(false)}
 }
 const statusLabel={MISSING:t('غير موزع','Unallocated'),DRAFT:t('مسودة','Draft'),APPROVED:t('معتمد','Approved'),STALE:t('يحتاج تحديثًا','Needs update')}[status];
 return <main className={`fs-root ob-branch-page${dimension?' ob-center-page':''}`} dir={en?'ltr':'rtl'} lang={en?'en':'ar'}>
  <section className="ob-branch-shell">
   <header className="ob-branch-header">
    <div><h1>{dimension?t('توزيع الأرصدة الافتتاحية على المراكز','Allocate opening balances to centers'):t('توزيع الأرصدة الافتتاحية على الفروع','Allocate opening balances to branches')}</h1>
    <p>{dimension?t('توزيع بنود الافتتاحي المعتمدة على مراكز التكلفة.','Assign approved opening items to cost centers.'):t('كل سطر افتتاحي يبقى مرتبطًا بمصدره. لا يتغير القيد أو الرصيد المعتمد للمؤسسة.','Every opening line retains its source identity. Approved legal-entity balances and postings remain unchanged.')}</p></div>
    <a href={back} className="ob-branch-link">{t('العودة إلى الأرصدة الافتتاحية','Back to opening balances')}</a>
   </header>
   <div className="ob-branch-notice">{dimension?t('للتعديل، أنشئ مسودة تصحيحية. تظل التقارير على آخر توزيع معتمد حتى اعتماد المسودة الجديدة.','Create a correction draft to edit. Reports use the last approved allocation until the new draft is approved.'):t('المراجعة هنا تخص توزيع الافتتاحي فقط؛ قوائم الفروع لا تصبح معتمدة حتى اكتمال مطابقة القيود والتسويات الداخلية والصلاحيات.','This approves opening attribution only. Branch statements require complete posted-journal attribution, interbranch reconciliation and permissions.')}</div>
   {dimension&&<p><a href={`/${locale}/settings/structure?organization=${encodeURIComponent(organization)}`}>{t('إدارة ارتباط المراكز بالفروع','Manage center branch assignments')}</a> · {t('اختيار المركز يحدد فرعه بحسب الارتباط المعتمد في بداية السنة.','Selecting a center sets its branch from the approved assignment at fiscal start.')}</p>}
   {error&&<p className="ob-branch-error" role="alert">{error}</p>}
   {notice&&<p className="ob-branch-success" role="status">{notice}</p>}
   {busy&&!data&&<p role="status">{t('جار تحميل بيانات الافتتاحي المعتمدة…','Loading approved opening source…')}</p>}
   {!organization||!fiscalStart?<p role="alert">{t('اختر المؤسسة والسنة المالية من صفحة الأرصدة الافتتاحية.','Choose the organization and fiscal year from Opening Balances.')}</p>:
   data&&!source?<p role="status">{t('لا توجد أرصدة افتتاحية معتمدة للتوزيع. إذا بدأ النشاط دون أرصدة سابقة فلا حاجة إلى توزيع افتتاحي؛ أما إذا كانت هناك أرصدة سابقة، فيجب اعتمادها أولًا. لا يثبت غياب الاعتماد وحده أن الأرصدة صفرية.','There are no approved opening balances to allocate. A genuinely zero-opening startup needs no branch opening allocation; if prior balances exist, they must be approved first. Missing approval alone does not prove a zero opening.')}</p>:
   source&&<>
    <div className="ob-branch-meta">
     {dimension&&<span>{t('بداية السنة المالية','Fiscal year start')}: <bdi>{source.fiscalStart}</bdi></span>}
     <span>{t('العملة','Currency')}: <b>{source.currency}</b></span>
     <span>{t('إصدار الافتتاحي','Opening version')}: <b>{source.version}</b></span>
     <span>{t('حالة التوزيع','Distribution status')}: <b>{dimension?statusLabel:status}</b></span>
     <span>{t('البنود المطابقة','Matched items')}: <b>{completeness.ready}/{rows.length}</b></span>
    </div>
    {status==='STALE'&&<p className="ob-branch-error">{t('تغيّر الافتتاحي المعتمد. التوزيع السابق لم يعد صالحًا ويجب إعداد توزيع جديد.','The approved opening changed. The previous distribution is stale and must be replaced.')}</p>}
    <div className="ob-branch-filters">
     <label>{t('بحث عن حساب أو بند','Find account or item')}<input value={query} onChange={e=>{setQuery(e.target.value);setCount(80)}} placeholder={t('رقم الحساب أو مرجع البند','Account code or source item')}/></label>
     <span>{t('بنود لم تكتمل مطابقتها','Unreconciled items')}: <strong>{completeness.remaining}</strong></span>
     <button disabled={busy} onClick={()=>void reload()}>{t('تحديث','Refresh')}</button>
    </div>
    <div className="ob-branch-table-wrap"><table className="ob-branch-table">
     <thead><tr><th>{t('الحساب / مرجع الافتتاحي','Account / opening item')}</th><th>{t('المعتمد مدين','Approved debit')}</th><th>{t('المعتمد دائن','Approved credit')}</th><th>{dimension&&status==='APPROVED'?t('التوزيع المعتمد','Approved allocation'):t('التوزيع للمراجعة','Allocation under review')}</th></tr></thead>
     <tbody>{visible.map(row=><tr key={row.itemId}>
      <td><b>{row.accountCode}</b><small>{row.itemId}</small></td><td data-mobile-label={t('المعتمد مدين','Approved debit')}><bdi dir="ltr">{row.debit}</bdi></td><td data-mobile-label={t('المعتمد دائن','Approved credit')}><bdi dir="ltr">{row.credit}</bdi></td>
      <td><div className="ob-branch-allocations">
       {(entries[row.itemId]??[]).map((allocation,index)=><div className="ob-branch-allocation" key={index}>
        {dimension&&<select aria-label={t('مركز التكلفة','Cost center')} disabled={!editable||busy} value={allocation.centerId??''} onChange={e=>{const selected=data.centers?.find(c=>c.id===e.target.value);change(row.itemId,index,{centerId:selected?.id??null,branchId:selected?.branchId??null})}}><option value="">{t('غير موزع على مركز','Unallocated')}</option>{allocation.centerId&&!data.centers?.some(c=>c.id===allocation.centerId)&&<option value={allocation.centerId} disabled>{t('مركز محفوظ يحتاج مراجعة ارتباطه','Saved center needs assignment review')} · {allocation.centerId}</option>}{data.centers?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        <select aria-label={t('الإدارة الرئيسية أو الفرع','Headquarters or branch')} disabled={!editable||busy||Boolean(dimension&&allocation.centerId)} value={allocation.branchId??''} onChange={e=>change(row.itemId,index,{branchId:e.target.value||null})}>
         <option value="">{t('الإدارة الرئيسية','Headquarters')}</option>{allocation.branchId&&!data.branches.some(b=>b.id===allocation.branchId)&&<option value={allocation.branchId} disabled>{t('فرع محفوظ غير متاح','Saved branch unavailable')} · {allocation.branchId}</option>}{data.branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <label>{dimension&&<span>{t('مدين','Debit')}</span>}<input aria-label={t('المدين الموزع','Allocated debit')} value={allocation.debit} disabled={!editable||busy} inputMode="decimal" dir="ltr" onChange={e=>change(row.itemId,index,{debit:e.target.value})}/></label>
        <label>{dimension&&<span>{t('دائن','Credit')}</span>}<input aria-label={t('الدائن الموزع','Allocated credit')} value={allocation.credit} disabled={!editable||busy} inputMode="decimal" dir="ltr" onChange={e=>change(row.itemId,index,{credit:e.target.value})}/></label>
        {editable&&<button disabled={busy} onClick={()=>remove(row.itemId,index)} aria-label={t('حذف سطر التوزيع','Remove allocation')}>×</button>}
       </div>)}
       {editable&&<button disabled={busy} className="ob-branch-add" onClick={()=>add(row.itemId)}>+ {t('إضافة توزيع','Add allocation')}</button>}
      </div></td>
     </tr>)}</tbody>
    </table></div>
    {rows.length>visible.length&&<button className="ob-branch-more" onClick={()=>setCount(n=>n+80)}>{t('عرض مزيد من البنود','Show more items')}</button>}
    <div className="ob-branch-actions">
     {editable&&<><label>{t('سبب التوزيع أو التصحيح','Allocation / correction reason')}<input value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label>
      <button disabled={busy} onClick={()=>void command('save')}>{t('حفظ المسودة','Save draft')}</button>
      <button disabled={busy||!canApprove} className="ob-branch-primary" onClick={()=>void command('approve')}>{t('اعتماد توزيع الافتتاحي','Approve opening allocation')}</button>
      {hasUnsavedChanges&&<small role="status">{t('احفظ آخر التعديلات قبل الاعتماد.','Save your latest changes before approving.')}</small>}
      {dimension&&completeness.remaining===0&&completeness.unbalanced>0&&<small role="status">{t('تحقق من تساوي المدين والدائن لكل فرع ومركز قبل الاعتماد.','Balance debits and credits within each branch and center before approving.')}</small>}</>}
     {status==='APPROVED'&&<><label>{t('سبب إعداد مسودة تصحيح','Reason for correction draft')}<input value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label>
      <button disabled={busy||reason.trim().length<8} onClick={()=>void command('correct')}>{t('إنشاء مسودة تصحيحية','Create correction draft')}</button></>}
     {!dimension&&<small>{t('اختيار الفرع والمبالغ يدوي؛ لا يُسند النظام أي رصيد تلقائيًا. تظهر فقط الفروع المتاحة لصلاحياتك.','Branches and amounts are explicit. The system never assigns balances automatically. Only branches visible under your access appear.')}</small>}
    </div>
   </>}
  </section>
 </main>;
}
