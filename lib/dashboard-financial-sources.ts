import {payableReference} from './payable-presentation';
import {buildLiquidityForecast,isLiquidityFlowSettled,remainingLiquidityFlowBase} from './liquidity-forecast';
export type DashboardDue={id:string;date:string;label:string;reference?:string;source:string;amount:number;currency:string;direction:'IN'|'OUT';href:string};
/** Read-only projection. Obligations replace their linked expected flows, never add to them. */
export function dashboardFinancialSources({overview,investments,scope,organizationIds,today,ar,locale}:{overview:any;investments:any;scope:string;organizationIds:string[];today:string;ar:boolean;locale:string}){
 const debts=(overview?.debts??[]).filter((d:any)=>['RECEIVABLE','PAYABLE'].includes(d.side));
 const flows=(overview?.flows??[]).filter((f:any)=>!f.transfer_id&&!isLiquidityFlowSettled(f));
 const debtIds=new Set(debts.map((d:any)=>d.id)),eventIds=new Set(debts.map((d:any)=>d.eventId).filter(Boolean));
 const due:DashboardDue[]=[],add=(r:DashboardDue)=>{if(/^\d{4}-\d{2}-\d{2}$/.test(r.date??'')&&Number.isFinite(r.amount)&&r.amount>0)due.push(r)};
 const link=(path:string)=>'/'+locale+'/'+path;
 for(const d of debts){
  const rawReference=String(d.reference??'').trim();
  const internalReference=!rawReference||rawReference===d.id||rawReference===d.eventId||/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(rawReference);
  const reference=internalReference?(d.side==='PAYABLE'?payableReference('',d.id):'AR-'+String(d.id).slice(0,8).toUpperCase()):rawReference;
  add({id:'obligation:'+d.id,date:d.dueDate,label:d.partyName||d.description||(ar?'جهة غير محددة':'Unspecified party'),reference,source:ar?(d.side==='PAYABLE'?'ذمة / التزام':'ذمة مدينة'):(d.side==='PAYABLE'?'Payable / obligation':'Receivable'),amount:Number(d.amount),currency:d.currency,direction:d.side==='PAYABLE'?'OUT':'IN',href:link(d.side==='PAYABLE'?'payables':'receivables')});
 }
 for(const f of flows){
  if(debtIds.has(f.source_record_id)||(f.links??[]).some((l:any)=>l.obligation_id?debtIds.has(l.obligation_id):eventIds.has(l.event_id)))continue;
  add({id:'flow:'+f.id,date:f.due_date,label:f.title,source:ar?'تدفق السيولة':'Liquidity flow',amount:remainingLiquidityFlowBase(f),currency:f.base_currency??overview?.baseCurrency,direction:f.direction==='INFLOW'?'IN':'OUT',href:link('liquidity?tab=flows')});
 }
 for(const c of investments?.contracts??[]){const t=c.terms;if(c.status!=='ACTIVE'||t.ownership_scope!==scope||scope==='ORGANIZATION'&&!organizationIds.includes(t.organization_id))continue;
  // A live investment forecast is authoritative over a second contract-principal estimate.
  if(flows.some((f:any)=>f.source_module==='INVESTMENTS'&&f.direction==='INFLOW'&&f.due_date===t.maturity_date&&String(f.source_event_key??'')==='investment:'+c.id+':forecast:REDEEM'))continue;
  add({id:'investment:'+c.id,date:t.maturity_date,label:t.name,source:ar?'أصل استثمار عند الاستحقاق':'Investment principal maturity',amount:Number(t.instrument==='DEPOSIT'?t.principal:t.face_value),currency:t.currency,direction:'IN',href:link('investments')});
 }
 due.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 const through=new Date(Date.parse(today+'T00:00:00Z')+30*86400000).toISOString().slice(0,10),upcoming=due.filter(r=>r.date<=through);
 const base=overview?.baseCurrency,accounts=overview?.accounts;
 const cashKnown=Array.isArray(accounts)&&accounts.every((a:any)=>(a.baseCurrency??a.base_currency)===base);
 const cash=cashKnown?accounts.reduce((s:number,a:any)=>s+Number(a.baseBalance??a.current_balance_base??0)-Number(a.restricted??a.restricted_balance_base??0)-Number(a.uncleared??a.uncleared_balance_base??0),0):null;
 const sum=(side:string,overdue=false)=>overview?debts.filter((d:any)=>d.side===side&&d.currency===base&&(!overdue||d.dueDate&&d.dueDate<today)).reduce((s:number,d:any)=>s+Number(d.amount),0):null;
 const sameDebtCurrency=debts.every((d:any)=>d.currency===base);
 const forecastKnown=cash!==null&&(scope==='PERSONAL'||Array.isArray(overview?.flows));
 const forecastFlows=due.filter(r=>r.currency===base).map(r=>({direction:r.direction==='IN'?'INFLOW' as const:'OUTFLOW' as const,due_date:r.date,status:'EXPECTED' as const,base_amount:r.amount}));
 const weeks=forecastKnown?buildLiquidityForecast(cash!,forecastFlows,today,13):null;
 return {upcoming,baseCurrency:base,overview:{cash,receivables:sameDebtCurrency?sum('RECEIVABLE'):null,payables:sameDebtCurrency?sum('PAYABLE'):null,overdueReceivables:sameDebtCurrency?sum('RECEIVABLE',true):null,overduePayables:sameDebtCurrency?sum('PAYABLE',true):null,lowestCash:weeks?Math.min(cash!,...weeks.map(w=>w.balance)):null,forecastIn:weeks?weeks.reduce((s,w)=>s+w.inflow,0):null,forecastOut:weeks?weeks.reduce((s,w)=>s+w.outflow,0):null},cashSeries:weeks?.map(w=>({label:w.from,inflow:w.inflow,outflow:w.outflow,revenue:0,expense:0}))??null};
}
