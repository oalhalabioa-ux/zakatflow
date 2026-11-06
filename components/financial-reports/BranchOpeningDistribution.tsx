'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import './branch-opening-distribution.css';

type Split={branchId:string|null;debit:string;credit:string};
type Original={itemId:string;accountCode:string;debit:string;credit:string};
type Editor={
 distribution:{status:'MISSING'|'DRAFT'|'APPROVED'|'STALE';id?:string;version?:number;
  openingWorkspaceId?:string;openingVersion?:number;entries?:Record<string,Split[]>;journalCoverageComplete?:false};
 opening:{id:string;organizationId:string;fiscalStart:string;currency:string;version:number;approvedOpening:Original[]}|null;
 branches:{id:string;name:string}[];branchRegistryComplete:false;
};
const money=/^\d{1,20}(\.\d{1,4})?$/;
function minor(v:string){if(!money.test(v))return null;const [a,b='']=v.split('.');return BigInt(a)*BigInt(10000)+BigInt(b.padEnd(4,'0'))}
async function read(response:Response){const body=await response.json().catch(()=>({error:'BRANCH_OPENING_UNAVAILABLE'}));if(!response.ok)throw Error(body.error??'BRANCH_OPENING_UNAVAILABLE');return body}
export default function BranchOpeningDistribution({locale,organization,fiscalStart}:{locale:string;organization:string;fiscalStart:string}){
 const en=locale==='en',t=(ar:string,english:string)=>en?english:ar;
 const [data,setData]=useState<Editor|null>(null),[entries,setEntries]=useState<Record<string,Split[]>>({}),
  [reason,setReason]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),
  [busy,setBusy]=useState(false),[query,setQuery]=useState(''),[count,setCount]=useState(80);
 const serial=useRef(0);
 const endpoint='/api/financial-reporting/branch-openings';
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
 },[organization,fiscalStart]);
 useEffect(()=>{const controller=new AbortController();void reload(controller.signal);return()=>{serial.current++;controller.abort()}},[reload]);
 const source=data?.opening;
 const rows=source?.approvedOpening??[];
 const visible=useMemo(()=>rows.filter(r=>[r.accountCode,r.itemId].join(' ').toLowerCase().includes(query.toLowerCase())).slice(0,count),[rows,query,count]);
 const completeness=useMemo(()=>{
  let ready=0;for(const r of rows){
   const parts=entries[r.itemId];
   if(!parts?.length)continue;
   const ids=new Set(parts.map(p=>p.branchId));
   if(ids.size!==parts.length)continue;
   const debit=parts.reduce<bigint|null>((n,p)=>{const v=minor(p.debit);return n===null||v===null?null:n+v},BigInt(0));
   const credit=parts.reduce<bigint|null>((n,p)=>{const v=minor(p.credit);return n===null||v===null?null:n+v},BigInt(0));
   if(debit!==null&&credit!==null&&debit===minor(r.debit)&&credit===minor(r.credit))ready++;
  }
  return{ready,remaining:rows.length-ready};
 },[rows,entries]);
 function add(id:string){setEntries(prev=>({...prev,[id]:[...(prev[id]??[]),{branchId:null,debit:'0.0000',credit:'0.0000'}]}))}
 function change(id:string,index:number,patch:Partial<Split>){
  setEntries(prev=>({...prev,[id]:(prev[id]??[]).map((x,i)=>i===index?{...x,...patch}:x)}));
 }
 function remove(id:string,index:number){setEntries(prev=>({...prev,[id]:(prev[id]??[]).filter((_,i)=>i!==index)}))}
 const status=data?.distribution.status??'MISSING';
 const editable=Boolean(source&&status!=='APPROVED');
 async function command(action:'save'|'approve'|'correct'){
  if(!source||!data)return;setBusy(true);setError('');setNotice('');
  const stamp=serial.current;
  const current=data.distribution;
  const body=action==='approve'?{action:'approve',id:current.id,expectedVersion:current.version}:{
   action:'save',organization,fiscalStart,expectedVersion:action==='correct'?0:(status==='DRAFT'?current.version??0:0),
   openingWorkspace:source.id,openingVersion:source.version,entries:action==='correct'?current.entries??{}:entries,reason,
  };
  try{
   const response=await read(await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
   if(stamp!==serial.current)return;
   setNotice(action==='approve'?t('تم اعتماد توزيع الافتتاحي. لا يعني ذلك اعتماد قوائم الفروع بعد.','Opening allocation approved; branch statements still require complete journal reconciliation.'):
    t('تم حفظ مسودة توزيع الفروع.','Branch allocation draft saved.'));
   await reload();
  }catch(e){if(stamp===serial.current){setError(e instanceof Error?e.message:'BRANCH_OPENING_UNAVAILABLE');if(/DENIED|UNAUTHORIZED/.test(String(e)))setData(null)}}
  finally{if(stamp===serial.current)setBusy(false)}
 }
 return <main className="fs-root ob-branch-page" dir={en?'ltr':'rtl'} lang={en?'en':'ar'}>
  <section className="ob-branch-shell">
   <header className="ob-branch-header">
    <div><h1>{t('توزيع الأرصدة الافتتاحية على الفروع','Allocate opening balances to branches')}</h1>
    <p>{t('كل سطر افتتاحي يبقى مرتبطًا بمصدره. لا يتغير القيد أو الرصيد المعتمد للمؤسسة.','Every opening line retains its source identity. Approved legal-entity balances and postings remain unchanged.')}</p></div>
    <a href={back} className="ob-branch-link">{t('العودة إلى الأرصدة الافتتاحية','Back to opening balances')}</a>
   </header>
   <div className="ob-branch-notice">{t('المراجعة هنا تخص توزيع الافتتاحي فقط؛ قوائم الفروع لا تصبح معتمدة حتى اكتمال مطابقة القيود والتسويات الداخلية والصلاحيات.','This approves opening attribution only. Branch statements require complete posted-journal attribution, interbranch reconciliation and permissions.')}</div>
   {error&&<p className="ob-branch-error" role="alert">{error}</p>}
   {notice&&<p className="ob-branch-success" role="status">{notice}</p>}
   {busy&&!data&&<p role="status">{t('جار تحميل بيانات الافتتاحي المعتمدة…','Loading approved opening source…')}</p>}
   {!organization||!fiscalStart?<p role="alert">{t('اختر المؤسسة والسنة المالية من صفحة الأرصدة الافتتاحية.','Choose the organization and fiscal year from Opening Balances.')}</p>:
   data&&!source?<p role="status">{t('لا يوجد افتتاحي مؤسسي معتمد لهذه السنة. يجب اعتماد الافتتاحي أولًا.','No approved legal-company opening exists for this fiscal year. Approve it before allocating branches.')}</p>:
   source&&<>
    <div className="ob-branch-meta">
     <span>{t('العملة','Currency')}: <b>{source.currency}</b></span>
     <span>{t('إصدار الافتتاحي','Opening version')}: <b>{source.version}</b></span>
     <span>{t('حالة التوزيع','Distribution status')}: <b>{status}</b></span>
     <span>{t('تمت مطابقة البنود المدخلة','Locally matched items')}: <b>{completeness.ready}/{rows.length}</b></span>
    </div>
    {status==='STALE'&&<p className="ob-branch-error">{t('تغيّر الافتتاحي المعتمد. التوزيع السابق لم يعد صالحًا ويجب إعداد توزيع جديد.','The approved opening changed. The previous distribution is stale and must be replaced.')}</p>}
    <div className="ob-branch-filters">
     <label>{t('بحث عن حساب أو بند','Find account or item')}<input value={query} onChange={e=>{setQuery(e.target.value);setCount(80)}} placeholder={t('رقم الحساب أو مرجع البند','Account code or source item')}/></label>
     <span>{t('بنود لم تكتمل مطابقتها','Unreconciled items')}: <strong>{completeness.remaining}</strong></span>
     <button disabled={busy} onClick={()=>void reload()}>{t('تحديث','Refresh')}</button>
    </div>
    <div className="ob-branch-table-wrap"><table className="ob-branch-table">
     <thead><tr><th>{t('الحساب / مرجع الافتتاحي','Account / opening item')}</th><th>{t('المعتمد مدين','Approved debit')}</th><th>{t('المعتمد دائن','Approved credit')}</th><th>{t('التوزيع المعتمد للمراجعة','Allocation under review')}</th></tr></thead>
     <tbody>{visible.map(row=><tr key={row.itemId}>
      <td><b>{row.accountCode}</b><small>{row.itemId}</small></td><td><bdi dir="ltr">{row.debit}</bdi></td><td><bdi dir="ltr">{row.credit}</bdi></td>
      <td><div className="ob-branch-allocations">
       {(entries[row.itemId]??[]).map((allocation,index)=><div className="ob-branch-allocation" key={index}>
        <select aria-label={t('الإدارة الرئيسية أو الفرع','Headquarters or branch')} disabled={!editable||busy} value={allocation.branchId??''} onChange={e=>change(row.itemId,index,{branchId:e.target.value||null})}>
         <option value="">{t('الإدارة الرئيسية','Headquarters')}</option>{data.branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <input aria-label={t('المدين الموزع','Allocated debit')} value={allocation.debit} disabled={!editable||busy} inputMode="decimal" onChange={e=>change(row.itemId,index,{debit:e.target.value})}/>
        <input aria-label={t('الدائن الموزع','Allocated credit')} value={allocation.credit} disabled={!editable||busy} inputMode="decimal" onChange={e=>change(row.itemId,index,{credit:e.target.value})}/>
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
      <button disabled={busy||status!=='DRAFT'||completeness.remaining!==0} className="ob-branch-primary" onClick={()=>void command('approve')}>{t('اعتماد توزيع الافتتاحي','Approve opening allocation')}</button></>}
     {status==='APPROVED'&&<><label>{t('سبب إعداد مسودة تصحيح','Reason for correction draft')}<input value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)}/></label>
      <button disabled={busy||reason.trim().length<8} onClick={()=>void command('correct')}>{t('إنشاء مسودة تصحيحية','Create correction draft')}</button></>}
     <small>{t('اختيار الفرع والمبالغ يدوي؛ لا يُسند النظام أي رصيد تلقائيًا. تظهر فقط الفروع المتاحة لصلاحياتك.','Branches and amounts are explicit. The system never assigns balances automatically. Only branches visible under your access appear.')}</small>
    </div>
   </>}
  </section>
 </main>;
}
