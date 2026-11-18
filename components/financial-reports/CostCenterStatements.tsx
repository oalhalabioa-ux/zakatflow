'use client';
import {useEffect,useRef,useState} from 'react';
import Decimal from 'decimal.js';
import type {liveDimensionalStatements} from '../../services/financial-dimensional-statements';
import {financialSourceRowsCsv} from '../../lib/financial-budget-source';
import {statementAmount} from './SourceStatementTable';
type Result=Awaited<ReturnType<typeof liveDimensionalStatements>>;
type Input={fiscalStart:string;organization:string;from:string;to:string;currency:string;branch:string;center:string;refresh:number};
const Money=Decimal.clone({precision:50});
const labels={position:[['assets','إجمالي الأصول','Total assets'],['liabilities','إجمالي الالتزامات','Total liabilities'],['equity','حقوق الملكية','Equity'],['fiscalProfit','ربح السنة حتى التاريخ (ضمن حقوق الملكية)','Fiscal profit to date (included in equity)']],cash:[['opening','النقد أول الفترة','Opening cash'],['operating','التدفق التشغيلي','Operating cash flow'],['investing','التدفق الاستثماري','Investing cash flow'],['financing','التدفق التمويلي','Financing cash flow'],['movement','صافي التغير في النقد','Net cash movement'],['closing','النقد آخر الفترة','Closing cash']]};
async function read(input:Input,signal?:AbortSignal){
 const r=await fetch('/api/financial-reporting/live-statements?'+new URLSearchParams({action:'cost-center-statements',organization:input.organization,from:input.from,to:input.to}),{cache:'no-store',signal});
 if(!r.ok)throw Error('CENTER_UNAVAILABLE');const data:Result=await r.json();
 if(data.status!=='VERIFIED_DIMENSIONAL_STATEMENTS'||data.organizationId!==input.organization||data.from!==input.from||data.to!==input.to||data.currency!==input.currency||!Array.isArray(data.rows))throw Error('CENTER_UNAVAILABLE');
 const rows=data.rows.filter(r=>r.centerId===(input.center==='UNALLOCATED'?null:input.center)&&(input.branch==='ALL'||r.branchId===(input.branch==='HQ'?null:input.branch)));
 if(!rows.length)throw Error('CENTER_UNAVAILABLE');
 const totals=(section:'position'|'cash')=>Object.fromEntries(labels[section].map(([key])=>[key,rows.reduce((n,r)=>n.plus((r.statements[section] as Record<string,string>)[key]),new Money(0)).toFixed(4)]));
 return{position:totals('position'),cash:totals('cash'),revision:data.revision};
}
/** Uses the banner's existing center selection. Never substitutes company totals. */
export function CostCenterStatements({input,view,en,name,canEditOpening}:{input:Input;view:'position'|'cash';en:boolean;name:string;canEditOpening:boolean}){
 const key=JSON.stringify(input),identity=key+'|'+view+'|'+en;
 const current=useRef(identity);current.current=identity;
 const [loaded,setLoaded]=useState<{key:string;data:Awaited<ReturnType<typeof read>>}|null>(null),[failed,setFailed]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const abort=new AbortController();setLoaded(null);setFailed('');read(input,abort.signal).then(data=>{if(!abort.signal.aborted)setLoaded({key,data})}).catch(()=>{if(!abort.signal.aborted)setFailed(key)});return()=>abort.abort()},[key]);
 useEffect(()=>()=>{current.current=''},[]);
 const data=loaded?.key===key?loaded.data:null;
 async function download(){setBusy(true);try{const fresh=await read(input);if(current.current!==identity)return;setLoaded({key,data:fresh});
 const rows=[['organization',input.organization],['branch',input.branch],['center',input.center],['name',name],['from',input.from],['to',input.to],['currency',input.currency],['registryRevision',fresh.revision],...labels[view].map(([metric,ar,english])=>[en?english:ar,fresh[view][metric]])];
 const url=URL.createObjectURL(new Blob([financialSourceRowsCsv(rows)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`yaqeen-center-${view}-${input.center}-${input.from}-${input.to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch{if(current.current===identity){setLoaded(null);setFailed(key)}}finally{setBusy(false)}}
 return <section className="fs-source-statements" data-center-statement={view}><h2>{name} · {view==='position'?(en?'Financial position':'المركز المالي'):(en?'Cash flows':'التدفقات النقدية')}</h2>{canEditOpening&&<a href={`/${en?'en':'ar'}/opening-balances/centers?${new URLSearchParams({organization:input.organization,fiscalStart:input.fiscalStart})}`}>{en?'Review center opening allocation':'مراجعة توزيع الافتتاحي على المراكز'}</a>}<p>{en?'Approved opening allocations and original transaction lines, reconciled to company statements.':'توزيع افتتاحي معتمد وحركات أصلية موزعة، مع مطابقة مجموع المراكز لقوائم الشركة.'}</p>{!data?<p role={failed===key?'alert':'status'}>{failed===key?(en?'The complete center source could not be verified. Review its dated branch assignment and approved opening allocation.':'تعذر التحقق من المصدر الكامل للمركز. راجع ارتباطه المؤرخ بالفرع وتوزيعه الافتتاحي المعتمد.'):(en?'Verifying center statements…':'جارٍ التحقق من قوائم المركز…')}</p>:<><div className="fs-page-actions"><button className="fs-gold" disabled={busy} onClick={download}>{en?'Export center CSV':'تصدير المركز CSV'}</button></div><div className="fs-table-scroll"><table className="fs-table"><thead><tr><th>{en?'Item':'البند'}</th><th>{input.currency}</th></tr></thead><tbody>{labels[view].map(([metric,ar,english])=><tr key={metric}><th>{en?english:ar}</th><td>{statementAmount(data[view][metric])}</td></tr>)}</tbody></table></div></>}</section>;
}
