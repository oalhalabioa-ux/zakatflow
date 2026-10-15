import {isLiquidityFlowSettled} from './liquidity-forecast';
export const liquidityFlowTypes=[['OPERATING','تشغيلي','Operating'],['PAYROLL','رواتب','Payroll'],['TAX','ضرائب','Tax'],['FINANCING','تمويلي','Financing'],['INVESTMENT','استثماري','Investment'],['OTHER','أخرى','Other']] as const;
export const liquidityFlowTypeLabel=(type:string,ar:boolean)=>{const row=liquidityFlowTypes.find(r=>r[0]===type);return row?row[ar?1:2]:type||'—'};
export type LiquidityFlowFilters={query:string;from:string;to:string;direction:string;flow_type:string;status:string;account_id:string};
export function defaultLiquidityFlowFilters(asOf:string):LiquidityFlowFilters{const [year,month]=asOf.split('-').map(Number);return {query:'',from:asOf.slice(0,7)+'-01',to:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10),direction:'',flow_type:'',status:'',account_id:''}}
type FilterFlow={title:string;counterparty?:string|null;reference?:string|null;due_date:string;direction:string;flow_type:string;status:'ACTUAL'|'CONFIRMED'|'EXPECTED';settlement_status?:string|null;account_id?:string|null};
const normalize=(value:string)=>value.toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670ـ]/g,'').replace(/[أإآ]/g,'ا').trim();
export function filterLiquidityFlows<T extends FilterFlow>(flows:T[],filters:LiquidityFlowFilters,asOf:string):T[]{
 if(filters.from&&filters.to&&filters.from>filters.to)return [];
 const words=normalize(filters.query).split(/\s+/).filter(Boolean);
 return flows.filter(f=>(!filters.from||f.due_date>=filters.from)&&(!filters.to||f.due_date<=filters.to)&&(!filters.direction||f.direction===filters.direction)&&(!filters.flow_type||f.flow_type===filters.flow_type)&&(!filters.account_id||(filters.account_id==='UNASSIGNED'?!f.account_id:f.account_id===filters.account_id))&&(!filters.status||(filters.status==='ACTUAL'?isLiquidityFlowSettled(f):filters.status==='OVERDUE'?!isLiquidityFlowSettled(f)&&f.due_date<asOf:!isLiquidityFlowSettled(f)&&f.status===filters.status))&&words.every(word=>normalize([f.title,f.counterparty,f.reference].filter(Boolean).join(' ')).includes(word))).sort((a,b)=>a.due_date.localeCompare(b.due_date));
}
