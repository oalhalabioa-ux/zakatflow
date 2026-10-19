'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Money} from './DisplayCurrency';
import {financialSignals,type FinancialSignal} from '../lib/yaqeen-financial-signals';
export default function YaqeenFinancialSignals({scope,organizationId,organizationIds,group,ar,locale}:{scope:string;organizationId?:string;organizationIds:string[];group?:boolean;ar:boolean;locale:string}){
 const [enabled,setEnabled]=useState(false),[rows,setRows]=useState<FinancialSignal[]>([]),[loading,setLoading]=useState(false),[errors,setErrors]=useState<string[]>([]),[updated,setUpdated]=useState(''),[refresh,setRefresh]=useState(0);
 const ids=organizationIds.join(',');
 useEffect(()=>{const shell=document.querySelector('.corp-shell');if(!shell)return;const sync=()=>setEnabled(shell.classList.contains('theme-yaqeen-business'));sync();const observer=new MutationObserver(sync);observer.observe(shell,{attributes:true,attributeFilter:['class']});return()=>observer.disconnect()},[]);
 useEffect(()=>{
  if(!enabled)return;const controller=new AbortController();setRows([]);setErrors([]);setLoading(true);
  const read=async(url:string)=>{const r=await fetch(url,{signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error();return r.json()};
  const loanUrl=scope==='ORGANIZATION'&&organizationId?'/api/debt-contracts?kind=LOAN&organization_id='+encodeURIComponent(organizationId)+(group?'&group=1':''):null;
  Promise.allSettled([read('/api/investments'),loanUrl?read(loanUrl):scope==='PERSONAL'?read('/api/debt-overview?scope=PERSONAL'):Promise.resolve(null)]).then(results=>{
   if(controller.signal.aborted)return;
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   setRows(financialSignals({investments:results[0].status==='fulfilled'?results[0].value:null,loans:scope==='ORGANIZATION'&&results[1].status==='fulfilled'?results[1].value:null,personalDebts:scope==='PERSONAL'&&results[1].status==='fulfilled'?results[1].value?.debts:undefined,scope,organizationIds:ids?ids.split(','):[],today,ar,locale}));
   setErrors(results.flatMap((r,i)=>r.status==='rejected'?[ar?(i?'تعذر تحديث القروض؛ راجع الصلاحيات أو أعد المحاولة.':'تعذر تحديث الودائع؛ أعد المحاولة.'):(i?'Loans unavailable; check access or retry.':'Deposits unavailable; retry.')]:[]));
   setUpdated(new Intl.DateTimeFormat(ar?'ar-SA':'en',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'}).format(new Date()));setLoading(false);
  });return()=>controller.abort();
 },[enabled,scope,organizationId,ids,group,ar,locale,refresh]);
 return <section className="yqd-financial-signals" aria-label={ar?'متابعة الاستثمارات والتمويل':'Investment and financing watch'}><header><div><h2>{ar?'متابعة الاستثمارات والتمويل':'Investment & financing watch'}</h2><p>{ar?'أرصدة فعلية واستحقاقات قريبة؛ العوائد التقديرية مميزة بوضوح.':'Actual balances and upcoming maturities; estimates are labeled.'}</p></div><button type="button" disabled={loading} onClick={()=>setRefresh(v=>v+1)} aria-label={ar?'تحديث مؤشرات التمويل':'Refresh financing indicators'}>{loading?(ar?'جارٍ التحديث…':'Updating…'):(ar?'تحديث':'Refresh')}</button></header>{updated&&<small>{ar?'آخر تحديث: ':'Updated: '}{updated}</small>}{errors.map(e=><p role="status" key={e}>{e}</p>)}<div className="yqd-signal-grid">{rows.map(r=><Link className="yqd-kpi" href={r.href} key={r.id}><div><span>{r.label}</span></div><strong><Money value={r.value} currency={r.currency}/></strong><p>{r.note}</p><small>{ar?'عملة المصدر: ':'Source currency: '}{r.currency}</small></Link>)}</div>{!loading&&!rows.length&&!errors.length&&<p className="yqd-empty">{ar?'لا توجد ودائع أو أرصدة قروض منفذة ضمن النطاق.':'No deposits or executed loan balances in this scope.'}</p>}</section>;
}
