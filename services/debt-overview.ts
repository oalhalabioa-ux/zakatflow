import {requireUser} from './auth';
import {requireOrganizationMember} from './organization-access';
import {financialRegister} from './financial-register';
import {riyadhToday,type DebtItem} from '../lib/financial-register';
import {z} from 'zod';
const unwrap=(r:any)=>{if(r.error)throw Error(r.error.message);return r.data};
async function all(query:()=>any,key:string){const rows:any[]=[];for(let offset=0;offset<50000;offset+=500){const data=unwrap(await query().order(key).range(offset,offset+499));rows.push(...data);if(data.length<500)return rows}throw Error('REPORT_TOO_LARGE')}
async function byIds(ids:string[],query:(ids:string[])=>any){const out:any[]=[];for(let i=0;i<ids.length;i+=100)out.push(...unwrap(await query(ids.slice(i,i+100))));return out}
export async function debtOverview(scope:'PERSONAL'|'ORGANIZATION',org:string|null,group:boolean,dashboard=false):Promise<{asOf:string;baseCurrency:string;debts:DebtItem[];warnings:string[];accounts?:any[];flows?:any[];cashUnavailable?:boolean}>{
 if(scope==='PERSONAL'){const data=await financialRegister(scope,null,false,true);return {asOf:data.asOf,baseCurrency:data.baseCurrency,debts:data.debts,warnings:data.warnings,...(dashboard?{accounts:data.accounts}:{} )};}
 z.string().uuid().parse(org);const {supabase,user}=await requireUser();const organizations=unwrap(await supabase.from('organizations').select('id,base_currency,parent_organization_id,organization_kind')) as any[];const root=organizations.find(o=>o.id===org);if(!root)throw Error('ORGANIZATION_ACCESS_REQUIRED');const ids=[org!,...(group&&root.organization_kind==='HOLDING'?organizations.filter(o=>o.parent_organization_id===org).map(o=>o.id):[])];await Promise.all(ids.map(async id=>{await requireOrganizationMember(supabase,user.id,id);if(!unwrap(await supabase.rpc('effective_organization_permission',{p_org:id,p_permission:'financial_core.view',p_amount:null,p_currency:null})))throw Error('DEBT_OVERVIEW_ACCESS_DENIED')}));
 const [open,advanceBalances]=await Promise.all([all(()=>supabase.from('financial_counterparty_open_items').select('organization_id,counterparty_id,counterparty_name,obligation_id,event_id,obligation_type,source_module,event_date,due_date,description,base_currency,outstanding_base_amount,applied_base_amount').in('organization_id',ids).gt('outstanding_base_amount',0),'obligation_id'),all(()=>supabase.from('financial_event_obligation_balances').select('organization_id,obligation_id,event_id,obligation_type,base_currency,outstanding_base_amount').in('organization_id',ids).in('obligation_type',['SUPPLIER_ADVANCE','CUSTOMER_ADVANCE','UNAPPLIED_CASH']).gt('outstanding_base_amount',0),'obligation_id')]);
 const events=await byIds([...new Set<string>(advanceBalances.map(b=>b.event_id))],batch=>supabase.from('financial_events').select('id,organization_id,counterparty_id,status,source_module,event_date,due_date,description').in('organization_id',ids).in('id',batch).eq('status','ACTUAL'));const partyIds=[...new Set<string>(events.map(e=>e.counterparty_id).filter(Boolean))];const parties=await byIds(partyIds,batch=>supabase.from('liquidity_counterparties').select('id,organization_id,name').in('organization_id',ids).in('id',batch));const partyMap=new Map(parties.map(p=>[p.organization_id+':'+p.id,p.name])),eventMap=new Map(events.map(e=>[e.id,e]));
 const debts:DebtItem[]=open.map(r=>({id:r.obligation_id,partyKey:r.organization_id+':'+(r.counterparty_id??'unmapped:'+r.event_id),partyName:r.counterparty_name??'جهة غير محددة',organizationId:r.organization_id,entityId:null,side:r.obligation_type,currency:r.base_currency,amount:Number(r.outstanding_base_amount),dueDate:r.due_date,date:r.event_date,description:r.description,source:r.source_module,eventId:r.event_id,appliedBase:Number(r.applied_base_amount)}));
 for(const b of advanceBalances){const e=eventMap.get(b.event_id);if(!e)continue;debts.push({id:b.obligation_id,partyKey:b.organization_id+':'+(e.counterparty_id??'unmapped:'+e.id),partyName:partyMap.get(b.organization_id+':'+e.counterparty_id)??'جهة غير محددة',organizationId:b.organization_id,entityId:null,side:b.obligation_type==='UNAPPLIED_CASH'?'UNAPPLIED':b.obligation_type,currency:b.base_currency,amount:Number(b.outstanding_base_amount),dueDate:e.due_date,date:e.event_date,description:e.description,source:e.source_module,eventId:e.id});}
 let cash:any={};
 if(dashboard){
  const allowed=await Promise.all(ids.map(p_org=>supabase.rpc('effective_organization_permission',{p_org,p_permission:'liquidity.view',p_amount:null,p_currency:null}).then(unwrap)));
  if(allowed.every(Boolean)){
   const [accounts,flows,links]=await Promise.all([
    all(()=>supabase.from('liquidity_accounts').select('id,name,organization_id,currency,current_balance_base,restricted_balance_base,uncleared_balance_base').in('organization_id',ids).in('account_type',['BANK','CASH','WALLET']).eq('active',true),'id'),
    all(()=>supabase.from('liquidity_flows').select('id,organization_id,title,direction,due_date,amount,base_amount,currency,status,settled_amount,settlement_status,transfer_id,source_module,source_record_id,source_event_key').in('organization_id',ids).in('status',['EXPECTED','CONFIRMED']),'id'),
    all(()=>supabase.from('financial_event_links').select('id,event_id,target_record_id,metadata').in('organization_id',ids).eq('target_module','liquidity_flows').eq('link_type','CASH_FLOW'),'id')
   ]);
   const currencyMap=new Map(organizations.map(o=>[o.id,o.base_currency]));
   const linksByFlow=new Map<string,any[]>();for(const l of links){const list=linksByFlow.get(l.target_record_id)??[];list.push({event_id:l.event_id,obligation_id:l.metadata?.obligation_id});linksByFlow.set(l.target_record_id,list);}
   cash={accounts:accounts.map(a=>({...a,base_currency:currencyMap.get(a.organization_id)})),flows:flows.map(f=>({...f,base_currency:currencyMap.get(f.organization_id),links:linksByFlow.get(f.id)??[]}))};
  }else cash={cashUnavailable:true};
 }
 return {asOf:riyadhToday(),baseCurrency:root.base_currency,debts,...cash,warnings:ids.length>1?['GROUP_BEFORE_INTERCOMPANY_ELIMINATION']:[]};
}
