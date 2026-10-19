'use client';
import {dashboardFinancialSources} from '../lib/dashboard-financial-sources';
import {useEffect,useState,type ReactNode} from 'react';
import Link from 'next/link';
import {Money} from './DisplayCurrency';
import {financialSignals,type FinancialSignal} from '../lib/yaqeen-financial-signals';
export type DashboardMaturity={id:string;date:string;label:string;source:string;amount:number;currency:string;direction:'IN'|'OUT';href:string};
export type FinancialWatchState={rows:FinancialSignal[];loading:boolean;errors:string[];updated:string;upcoming:DashboardMaturity[];refresh:()=>void;sources:ReturnType<typeof dashboardFinancialSources>|null};
export default function YaqeenFinancialSignals({scope,organizationId,organizationIds,group,ar,locale,children}:{children?:(state:FinancialWatchState)=>ReactNode;scope:string;organizationId?:string;organizationIds:string[];group?:boolean;ar:boolean;locale:string}){
 const [enabled,setEnabled]=useState(false),[rows,setRows]=useState<FinancialSignal[]>([]),[loading,setLoading]=useState(false),[errors,setErrors]=useState<string[]>([]),[updated,setUpdated]=useState(''),[refresh,setRefresh]=useState(0);
 const [sources,setSources]=useState<ReturnType<typeof dashboardFinancialSources>|null>(null);
 const [upcoming,setUpcoming]=useState<DashboardMaturity[]>([]);
 const ids=organizationIds.join(',');
 useEffect(()=>{const shell=document.querySelector('.corp-shell');if(!shell)return;const sync=()=>setEnabled(shell.classList.contains('theme-yaqeen-business'));sync();const observer=new MutationObserver(sync);observer.observe(shell,{attributes:true,attributeFilter:['class']});return()=>observer.disconnect()},[]);
 useEffect(()=>{
  if(!enabled)return;const controller=new AbortController();setRows([]);setUpcoming([]);setSources(null);setErrors([]);setLoading(true);
  const read=async(url:string)=>{const r=await fetch(url,{signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error();return r.json()};
  const loanUrl=scope==='ORGANIZATION'&&organizationId?'/api/debt-contracts?kind=LOAN&organization_id='+encodeURIComponent(organizationId)+(group?'&group=1':''):null;
  Promise.allSettled([read('/api/investments'),loanUrl?read(loanUrl):Promise.resolve(null),read('/api/debt-overview?view=dashboard&scope='+scope+(scope==='ORGANIZATION'?'&organization_id='+encodeURIComponent(organizationId??'')+(group?'&group=1':''):''))]).then(results=>{
   if(controller.signal.aborted)return;
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   setRows(financialSignals({investments:results[0].status==='fulfilled'?results[0].value:null,loans:scope==='ORGANIZATION'&&results[1].status==='fulfilled'?results[1].value:null,personalDebts:scope==='PERSONAL'&&results[2].status==='fulfilled'?results[2].value?.debts:undefined,scope,organizationIds:ids?ids.split(','):[],today,ar,locale}));
   const snapshot=dashboardFinancialSources({overview:results[2]?.status==='fulfilled'?results[2].value:null,investments:results[0].status==='fulfilled'?results[0].value:null,scope,organizationIds:ids?ids.split(','):[],today,ar,locale});
   setSources(snapshot);
   setUpcoming([...snapshot.upcoming.filter(r=>r.date<today).slice(-8),...snapshot.upcoming.filter(r=>r.date>=today).slice(0,24)]);
   setErrors(results.flatMap((r,i)=>r.status==='rejected'?[ar?(i===2?'تعذر تحديث السيولة والذمم والاستحقاقات.':i?'تعذر تحديث القروض؛ راجع الصلاحيات أو أعد المحاولة.':'تعذر تحديث الودائع؛ أعد المحاولة.'):(i===2?'Cash, balances and maturities unavailable.':i?'Loans unavailable; check access or retry.':'Deposits unavailable; retry.')]:[]));
   setUpdated(new Intl.DateTimeFormat(ar?'ar-SA':'en',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'}).format(new Date()));setLoading(false);
  });return()=>controller.abort();
 },[enabled,scope,organizationId,ids,group,ar,locale,refresh]);
 if(children)return <>{children({rows,loading,errors,updated,upcoming,sources,refresh:()=>setRefresh(v=>v+1)})}</>;
 return <section className="yqd-financial-signals" aria-label={ar?'متابعة الاستثمارات والتمويل':'Investment and financing watch'}><header><div><h2>{ar?'متابعة الاستثمارات والتمويل':'Investment & financing watch'}</h2><p>{ar?'أرصدة فعلية واستحقاقات قريبة؛ العوائد التقديرية مميزة بوضوح.':'Actual balances and upcoming maturities; estimates are labeled.'}</p></div><button type="button" disabled={loading} onClick={()=>setRefresh(v=>v+1)} aria-label={ar?'تحديث مؤشرات التمويل':'Refresh financing indicators'}>{loading?(ar?'جارٍ التحديث…':'Updating…'):(ar?'تحديث':'Refresh')}</button></header>{group&&<p className="yqd-source">{ar?'تجميع الشركة وفروعها قبل استبعاد الأرصدة المتبادلة؛ لا يمثل قائمة مالية موحدة.':'Company and subsidiaries before intercompany elimination; not consolidated financial statements.'}</p>}{updated&&<small>{ar?'آخر تحديث: ':'Updated: '}{updated}</small>}{errors.map(e=><p role="status" key={e}>{e}</p>)}<div className="yqd-signal-grid">{rows.map(r=><Link className="yqd-kpi" href={r.href} key={r.id}><div><span>{r.label}</span></div><strong><Money value={r.value} currency={r.currency}/></strong><p>{r.note}</p><small>{ar?'عملة المصدر: ':'Source currency: '}{r.currency}</small></Link>)}</div>{!loading&&!rows.length&&!errors.length&&<p className="yqd-empty">{ar?'لا توجد ودائع أو أرصدة قروض منفذة ضمن النطاق.':'No deposits or executed loan balances in this scope.'}</p>}</section>;
}
