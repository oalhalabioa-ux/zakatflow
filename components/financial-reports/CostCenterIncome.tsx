'use client';
import {useEffect,useRef,useState} from 'react';
import type {costCenterIncome} from '../../lib/financial-cost-center-income';
import {financialSourceRowsCsv} from '../../lib/financial-budget-source';
import {statementAmount} from './SourceStatementTable';
type Result=ReturnType<typeof costCenterIncome>;
type Input={enabled:boolean;organization:string;from:string;to:string;currency:string;refresh:number};
const labels=[['revenue','الإيرادات','Revenue'],['costOfSales','تكلفة المبيعات','Cost of sales'],['grossProfit','مجمل الربح','Gross profit'],['operatingExpenses','المصروفات التشغيلية','Operating expenses'],['operatingProfit','الربح التشغيلي','Operating profit'],['finance','تكاليف التمويل','Finance costs'],['tax','الزكاة والضرائب','Tax'],['netProfit','صافي الربح','Net profit']];
async function read(input:Input,signal?:AbortSignal):Promise<Result>{
 const r=await fetch('/api/financial-reporting/live-statements?'+new URLSearchParams({action:'cost-center-income',organization:input.organization,from:input.from,to:input.to}),{cache:'no-store',signal});
 if(!r.ok)throw Error('CENTER_UNAVAILABLE');const data:Result=await r.json();
 if(data.scope!=='COST_CENTER_INCOME_ONLY'||data.organizationId!==input.organization||data.from!==input.from||data.to!==input.to||data.currency!==input.currency||!Array.isArray(data.rows))throw Error('CENTER_UNAVAILABLE');
 return data;
}
export function useCostCenterIncome(input:Input){
 const key=[input.organization,input.from,input.to,input.currency,input.refresh,input.enabled].join('|');
 const [loaded,setLoaded]=useState<{key:string;data:Result}|null>(null),[choice,setChoice]=useState({organization:'',value:'ALL'}),[failed,setFailed]=useState('');
 useEffect(()=>{setLoaded(null);setFailed('');if(!input.enabled||!input.organization||!input.from||!input.to)return;const abort=new AbortController();read(input,abort.signal).then(data=>{if(!abort.signal.aborted)setLoaded({key,data})}).catch(()=>{if(!abort.signal.aborted)setFailed(key)});return()=>abort.abort()},[key]);
 const data=loaded?.key===key?loaded.data:null;
 // Hide obsolete results synchronously, before effects run on scope changes.
 const value=input.enabled&&choice.organization===input.organization?choice.value:'ALL';
 return{input,key,data,value,failed:failed===key,invalidate:()=>{setLoaded(null);setFailed(key)},accept:(data:Result)=>setLoaded({key,data}),setValue:(value:string)=>setChoice({organization:input.organization,value})};
}
export function CostCenterPicker({state,en}:{state:ReturnType<typeof useCostCenterIncome>;en:boolean}){
 return <label title={en?'Income by original transaction line; available for the whole company':'قائمة الدخل بحسب سطر العملية الأصلي؛ متاحة على مستوى الشركة'}><span>{en?'Cost center':'مركز التكلفة'}</span><select aria-label={en?'Cost center':'مركز التكلفة'} value={state.value} disabled={!state.input.enabled||(!state.data&&state.value==='ALL')} onChange={e=>state.setValue(e.target.value)}><option value="ALL">{en?'All cost centers':'جميع المراكز'}</option>{!state.data&&state.value!=='ALL'&&state.value!=='UNALLOCATED'&&<option value={state.value}>{en?'Selected center · verifying':'المركز المختار · جارٍ التحقق'}</option>}<option value="UNALLOCATED">{en?'Unallocated':'غير موزع على مركز'}</option>{state.data?.rows.filter(r=>r.centerId!==null).map(r=><option key={r.centerId} value={r.centerId!}>{r.name}</option>)}</select></label>;
}
export function CostCenterReport({state,en,onUnavailable}:{state:ReturnType<typeof useCostCenterIncome>;en:boolean;onUnavailable:()=>void}){
 const [busy,setBusy]=useState(false),[exportError,setExportError]=useState('');
 const identity=state.key+'|'+state.value+'|'+en,latest=useRef(identity);latest.current=identity;
 useEffect(()=>()=>{latest.current=''},[]);
 const centerId=state.value==='UNALLOCATED'?null:state.value;
 const row=state.data?.rows.find(r=>r.centerId===centerId);
 async function download(){setBusy(true);setExportError('');try{
  const fresh=await read(state.input);if(latest.current!==identity)return;const selected=fresh.rows.find(r=>r.centerId===centerId);if(!selected)throw Error('CENTER_UNAVAILABLE');state.accept(fresh);
  const rows=[['scope',fresh.scope],['organization',fresh.organizationId],['center',centerId??'UNALLOCATED'],['name',selected.name??(en?'Unallocated':'غير موزع')],['from',fresh.from],['to',fresh.to],['currency',fresh.currency],...labels.map(([key,ar,eng])=>[en?eng:ar,selected.income[key]])];
  const url=URL.createObjectURL(new Blob([financialSourceRowsCsv(rows)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`yaqeen-center-income-${fresh.organizationId}-${centerId??'unallocated'}-${fresh.from}-${fresh.to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch{if(latest.current===identity){state.invalidate();onUnavailable();setExportError(identity)}}finally{setBusy(false)}}
 return <section className="fs-source-statements" data-cost-center={state.value}><h2>{en?'Cost center income':'قائمة دخل مركز التكلفة'} · {row?.name??(centerId===null?(en?'Unallocated':'غير موزع'):'')}</h2><p>{en?'Only income and expenses attributed to original transaction lines. Unallocated activity is separate; all centers reconcile to company income.':'الإيرادات والمصروفات مرتبطة بسطور العمليات الأصلية. تظهر الحركات غير الموزعة مستقلة، ويطابق مجموع المراكز نتيجة الشركة.'}</p>{!row?<p role="status">{state.failed?(en?'Center attribution could not be verified. Company totals are not substituted.':'تعذر التحقق من ربط المركز. لا تُعرض أرقام الشركة بدلًا منه.'):(en?'Validating center source…':'جارٍ التحقق من مصدر المركز…')}</p>:<><button className="fs-gold" disabled={busy} onClick={download}>{en?'Export center CSV':'تصدير المركز CSV'}</button><div className="fs-table-scroll"><table className="fs-table"><thead><tr><th>{en?'Item':'البند'}</th><th>{state.data?.currency}</th></tr></thead><tbody>{labels.map(([key,ar,eng])=><tr key={key}><th>{en?eng:ar}</th><td>{statementAmount(row.income[key])}</td></tr>)}</tbody></table></div></>}{exportError===identity&&<p role="alert">{en?'Export failed verification; no file was downloaded.':'تعذر التحقق عند التصدير؛ لم يتم تنزيل الملف.'}</p>}</section>;
}
