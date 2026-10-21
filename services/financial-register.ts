import Decimal from 'decimal.js';
import {applyPersonalDebtLinks} from '../lib/personal-debt-parties';
import {organizationScopeIds} from '../lib/workspace-organization';
import {inferDebtCategory} from '../lib/debt-categories';
import {personalPayableRecords} from '../lib/personal-payables';
import {requireUser} from './auth';
import {requireOrganizationMember} from './organization-access';
import {assetLedgerBalance} from '../lib/asset-ledger';
import {isRecognizedAsset} from '../lib/asset-reports';
import {buildReportMovements} from '../lib/vat-financial-reports';
import {riyadhToday,type RegisterData,type CashMovement,type DebtItem} from '../lib/financial-register';

async function inBatches(ids:string[],query:(ids:string[])=>any){const rows:any[]=[];for(let i=0;i<ids.length;i+=150)rows.push(...await all(()=>query(ids.slice(i,i+150))));return rows;}
async function all(query:()=>any,keys=['id']):Promise<any[]>{const rows:any[]=[];for(let offset=0;offset<50000;offset+=500){let q=query();for(const key of keys)q=q.order(key);const r=await q.range(offset,offset+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)return rows;}throw new Error('REPORT_TOO_LARGE');}
export async function financialRegister(scope:'PERSONAL'|'ORGANIZATION',organizationId:string|null,group:boolean,debtOnly=false):Promise<RegisterData>{
 const {supabase,user}=await requireUser();const asOf=riyadhToday();
 const [{data:profile,error:profileError},organizations]=await Promise.all([supabase.from('profiles').select('base_currency').eq('id',user.id).single(),all(()=>supabase.from('organizations').select('id,name,base_currency,parent_organization_id,organization_kind'))]);if(profileError)throw profileError;
 let ids:string[]=[];if(scope==='ORGANIZATION'){
  if(!organizationId)throw new Error('ORGANIZATION_ID_REQUIRED');await requireOrganizationMember(supabase,user.id,organizationId);ids=[organizationId];
  const root=organizations.find(o=>o.id===organizationId);if(!root)throw new Error('ORGANIZATION_ACCESS_REQUIRED');
  if(group){
   const descendants=organizationScopeIds(organizations,organizationId,true);
   const children=organizations.filter(o=>o.id!==organizationId&&descendants.has(o.id));
   for(const child of children){try{await requireOrganizationMember(supabase,user.id,child.id);ids.push(child.id);}catch{throw new Error('GROUP_MEMBER_ACCESS_REQUIRED');}}
  }
 }
 const baseCurrency=scope==='PERSONAL'?profile.base_currency:organizations.find(o=>o.id===organizationId).base_currency;
 const assetQuery=()=>{const q=supabase.from('asset_accounts').select('*').or('metadata->>archived.is.null,metadata->>archived.neq.true');if(debtOnly)q.in('asset_type',['CASH','BANK','RECEIVABLE']);return scope==='PERSONAL'?q.eq('user_id',user.id).is('organization_id',null):q.in('organization_id',ids);};
 const [rawAssets,assetTransactions]=await Promise.all([debtOnly&&scope==='ORGANIZATION'?Promise.resolve([]):all(assetQuery),debtOnly?Promise.resolve([]):all(()=>{const q=supabase.from('transactions').select('id,asset_account_id,organization_id,transaction_type,reference,metadata');return scope==='PERSONAL'?q.eq('user_id',user.id).is('organization_id',null):q.in('organization_id',ids);})]);
 const eventIds=[...new Set<string>(assetTransactions.map(t=>t.metadata?.financial_event_id).filter(Boolean))];
 const [lots,statuses]=await Promise.all([inBatches(rawAssets.map(a=>a.id),ids=>supabase.from('lots').select('*').in('asset_account_id',ids)),inBatches(eventIds,ids=>supabase.from('financial_events').select('id,status').in('id',ids))]);
 const lotsByAsset=new Map<string,any[]>();for(const l of lots)if(!l.metadata?.recognition_pending)lotsByAsset.set(l.asset_account_id,[...(lotsByAsset.get(l.asset_account_id)??[]),l]);
 const statusById=new Map(statuses.map(e=>[e.id,e.status]));
 const assets=rawAssets.map((a:any)=>{const tx=assetTransactions.find(t=>t.asset_account_id===a.id&&t.transaction_type==='PURCHASE');const values=assetLedgerBalance(a,lotsByAsset.get(a.id)??[],a.organization_id?organizations.find(o=>o.id===a.organization_id)?.base_currency??a.currency:baseCurrency);return {...a,...values,financial_event_status:statusById.get(tx?.metadata?.financial_event_id)??null,lifecycle_status:a.metadata?.investment_status};});
 const sourceDebtSides=new Map<string,string>();
 const result:RegisterData={asOf,baseCurrency,organizations,organizationIds:ids,entities:[],accounts:[],cashMovements:[],debts:[],debtMovements:[],assets:[],warnings:[]};
 const cashAssets=assets.filter((a:any)=>['CASH','BANK'].includes(a.asset_type));
 if(scope==='PERSONAL'){
  result.accounts=cashAssets.map((a:any)=>({id:a.id,name:a.name,type:a.asset_type,currency:a.current_value_currency,nativeCurrency:a.currency,balance:Number(a.current_market_value),restricted:0,uncleared:0,baseCurrency:a.current_value_currency,baseBalance:Number(a.current_market_value),organizationId:null,entityId:null,source:'PERSONAL_ASSETS',openingDate:a.metadata?.purchase_date??null}));
  const transactions=await all(()=>supabase.from('transactions').select('id,asset_account_id,transaction_type,transaction_date,base_value,base_currency,reference,notes,metadata,reversal_of_transaction_id,created_at').eq('user_id',user.id).is('organization_id',null));
  const byId=new Map(transactions.map(t=>[t.id,t]));
  function signed(t:any,depth=0):number{if(depth>10)throw new Error('REVERSAL_CHAIN_INVALID');if(t.transaction_type==='REVERSAL'){const original=byId.get(t.reversal_of_transaction_id);if(!original)throw new Error('REVERSAL_SOURCE_REQUIRED');return -signed(original,depth+1);}const out=['SALE','WITHDRAWAL','TRANSFER_OUT','ZAKAT_PAYMENT'].includes(t.transaction_type)||t.transaction_type==='ADJUSTMENT'&&t.metadata?.adjustment_direction==='OUT';return Number(t.base_value)*(out?-1:1);}
  result.cashMovements=transactions.filter(t=>cashAssets.some((a:any)=>a.id===t.asset_account_id)&&!t.metadata?.asset_deleted).map(t=>({id:t.id,accountId:t.asset_account_id,date:t.transaction_date,createdAt:t.created_at,currency:t.base_currency,amount:signed(t),description:t.notes||t.transaction_type,reference:t.reference||t.id,source:'ASSETS'}));
  const personalDebts=new Map(assets.filter((a:any)=>a.asset_type==='RECEIVABLE').map((a:any)=>[a.id,a]));
  result.debtMovements=transactions.filter(t=>personalDebts.has(t.asset_account_id)&&!t.metadata?.asset_deleted).map(t=>({id:t.id,debtId:t.asset_account_id,createdAt:t.created_at,organizationId:'PERSONAL',partyKey:t.asset_account_id,partyName:(personalDebts.get(t.asset_account_id) as any).name,side:'SALES' as const,date:t.transaction_date,due:(personalDebts.get(t.asset_account_id) as any).metadata?.due_date||null,reference:t.reference||t.id,description:t.notes||t.transaction_type,currency:t.base_currency,amount:signed(t),advance:false,kind:t.transaction_type})).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const receivableBalances=new Map<string,number>();
  for(const movement of result.debtMovements)if(movement.debtId)receivableBalances.set(movement.debtId,(receivableBalances.get(movement.debtId)??0)+Number(movement.amount||0));
  result.debts=assets.filter((a:any)=>a.asset_type==='RECEIVABLE').map((a:any)=>({id:a.id,partyKey:a.id,partyName:a.name,organizationId:null,entityId:null,side:'RECEIVABLE' as const,currency:a.current_value_currency,amount:receivableBalances.has(a.id)?receivableBalances.get(a.id)!:Number(a.current_market_value),date:a.metadata?.purchase_date||asOf,dueDate:a.metadata?.due_date||null,description:a.name,source:'PERSONAL_ASSETS' as const,eventId:null})).filter((d:any)=>d.amount>0);
  const [personalPayables,personalPayments]=await Promise.all([all(()=>supabase.from('personal_payables').select('*').eq('user_id',user.id)),all(()=>supabase.from('personal_payable_payments').select('*').eq('user_id',user.id))]);
  const payables=personalPayableRecords(personalPayables,personalPayments,transactions);
  result.debts.push(...payables.debts);result.debtMovements.push(...payables.movements);result.debtMovements.sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt??'').localeCompare(b.createdAt??'')||({INVOICE:0,PAYMENT:1,REVERSAL:2}[a.kind as 'INVOICE']??1)-({INVOICE:0,PAYMENT:1,REVERSAL:2}[b.kind as 'INVOICE']??1)||a.id.localeCompare(b.id));
  result.personalPayments=payables.history;
  const personalFinancings=await all(()=>supabase.from('personal_financings').select('id,kind,side,receivable_id,payable_id').eq('user_id',user.id));
  const links=await all(()=>supabase.from('personal_debt_links').select('record_id,side,party_key,party_name').eq('user_id',user.id));const linked=applyPersonalDebtLinks(result,links);const profiles=await all(()=>supabase.from('personal_debt_parties').select('id,party_key,name').eq('user_id',user.id));const aliases=new Map(profiles.map(p=>[p.party_key,p.name]));result.debts=linked.debts.map(d=>({...d,partyName:aliases.get(d.partyKey)??d.partyName}));result.debtMovements=linked.debtMovements.map(m=>({...m,partyName:aliases.get(m.partyKey)??m.partyName}));
  const advances=new Map(personalFinancings.filter(f=>f.kind==='ADVANCE').map(f=>[f.receivable_id??f.payable_id,f]));
  result.debts=result.debts.map(d=>advances.has(d.id)?{...d,side:advances.get(d.id).side==='RECEIVABLE'?'SUPPLIER_ADVANCE':'CUSTOMER_ADVANCE'}:d);
  result.debtMovements=result.debtMovements.map(m=>advances.has(m.debtId)?{...m,advance:true,side:advances.get(m.debtId).side==='RECEIVABLE'?'PURCHASE':'SALES',amount:-m.amount}:m);


 }else{
  const [accounts,settlements,flows,events,obligations,allocations,parties,balances,entities,links,documents]=await Promise.all([
   debtOnly?Promise.resolve([]):all(()=>supabase.from('liquidity_accounts').select('*').in('organization_id',ids).in('account_type',['BANK','CASH','WALLET']).eq('active',true)),
   debtOnly?Promise.resolve([]):all(()=>supabase.from('liquidity_settlements').select('*').in('organization_id',ids).in('status',['POSTED','REVERSED'])),
   debtOnly?Promise.resolve([]):all(()=>supabase.from('liquidity_flows').select('id,organization_id,account_id,direction,due_date,amount,currency,title,reference,source_module,transfer_id,created_at').in('organization_id',ids).eq('status','ACTUAL')),
   all(()=>supabase.from('financial_events').select('id,organization_id,entity_id,counterparty_id,event_date,due_date,status,description,source_record_id,source_module,source_event_key').in('organization_id',ids)),
   all(()=>supabase.from('financial_event_obligations').select('*').in('organization_id',ids)),
   all(()=>supabase.from('financial_event_obligation_allocations').select('*').in('organization_id',ids)),
   all(()=>supabase.from('liquidity_counterparties').select('id,organization_id,name').in('organization_id',ids)),
   all(()=>supabase.from('financial_event_obligation_balances').select('*').in('organization_id',ids),['obligation_id']),
   all(()=>supabase.from('organization_entities').select('id,name,organization_id').in('organization_id',ids)),
   all(()=>supabase.from('financial_event_links').select('id,organization_id,event_id,target_module,target_record_id,metadata').in('organization_id',ids)),
   all(()=>supabase.from('vat_documents').select('id,document_type,document_number').in('organization_id',ids)),
  ]);
  result.entities=entities;result.accounts=accounts.map(a=>({id:a.id,name:a.name,type:a.account_type,currency:a.currency,nativeCurrency:a.currency,balance:Number(a.current_balance),restricted:Number(a.restricted_balance),uncleared:Number(a.uncleared_balance),baseCurrency:organizations.find(o=>o.id===a.organization_id)?.base_currency??a.currency,baseBalance:Number(a.current_balance_base),organizationId:a.organization_id,entityId:a.entity_id,source:'LIQUIDITY',openingDate:a.metadata?.opening_date??null}));
  const eventMap=new Map(events.map(e=>[e.id,e])),partyMap=new Map(parties.map(p=>[p.organization_id+':'+p.id,p.name]));
  const knownCashEvents=new Set(settlements.map(s=>s.financial_event_id)),settledRoots=new Set<string>(knownCashEvents),obMap=new Map(obligations.map(o=>[o.id,o]));
  for(const a of allocations)if(knownCashEvents.has(a.application_event_id)){const ob=obMap.get(a.obligation_id);if(ob)settledRoots.add(ob.event_id);}
  const coveredFlows=new Set(links.filter(l=>l.target_module==='liquidity_flows'&&settledRoots.has(l.event_id)).map(l=>l.target_record_id));
  result.cashMovements=settlements.map(s=>({id:s.id,accountId:s.account_id,date:s.settlement_date,createdAt:s.posted_at??s.created_at,currency:s.currency,amount:Number(s.amount)*(s.direction==='INFLOW'?1:-1),description:eventMap.get(s.financial_event_id)?.description||'تسوية نقدية',reference:s.source_event_key||s.id,source:s.source_module}));
  const postedSourceKeys=events.filter(e=>knownCashEvents.has(e.id)).map(e=>e.source_event_key??'');
  result.cashMovements.push(...flows.filter(f=>!coveredFlows.has(f.id)&&!postedSourceKeys.some(k=>k.includes(f.id))).map(f=>({id:'flow:'+f.id,accountId:f.account_id,date:f.due_date,createdAt:f.created_at,currency:f.currency,amount:Number(f.amount)*(f.direction==='INFLOW'?1:-1),description:f.title,reference:f.reference||f.id,source:f.transfer_id?'TRANSFER':'LEGACY_FLOW'})));
  result.debts=balances.flatMap((b:any):DebtItem[]=>{const e=eventMap.get(b.event_id);if(!e||e.status!=='ACTUAL')return [];const side=['RECEIVABLE','PAYABLE','CUSTOMER_ADVANCE','SUPPLIER_ADVANCE'].includes(b.obligation_type)?b.obligation_type:'UNAPPLIED';return [{id:b.obligation_id,partyKey:e.organization_id+':'+(e.counterparty_id||'unmapped:'+e.id),partyName:partyMap.get(e.organization_id+':'+e.counterparty_id)||'غير محدد',organizationId:e.organization_id,entityId:e.entity_id,side,currency:b.base_currency,amount:Number(b.outstanding_base_amount),dueDate:e.due_date,date:e.event_date,description:e.description,source:e.source_module,eventId:e.id,originalCurrency:b.currency,originalAmount:Number(b.settleable_amount),exchangeRate:Number(b.exchange_rate),totalBase:Number(b.adjusted_settleable_base_amount),appliedBase:Number(side.endsWith('_ADVANCE')?b.consumed_advance_base_amount:b.applied_base_amount)}];});
  const references=new Map<string,string>(documents.map(d=>[d.id,d.document_number])),sides=new Map<string,'SALES'|'PURCHASE'>(documents.map(d=>[d.id,d.document_type]));
  const referenceTransactions=debtOnly?await inBatches([...new Set<string>(events.filter(e=>['ASSETS_INTEGRATION','ASSET_LIFECYCLE'].includes(e.source_module)).map(e=>e.source_record_id).filter(Boolean))],batch=>supabase.from('transactions').select('id,reference,metadata').in('organization_id',ids).in('id',batch)):assetTransactions;
  for(const tx of referenceTransactions){const ref=tx.reference||tx.metadata?.invoice_reference;if(ref&&!references.has(tx.id))references.set(tx.id,ref);}
  for(const l of links.filter(l=>l.target_module==='vat_documents')){const e=eventMap.get(l.event_id),d=documents.find(d=>d.id===l.target_record_id);if(e?.source_record_id&&d){references.set(e.source_record_id,d.document_number);sides.set(e.source_record_id,d.document_type);}}
  const advanceReferences=new Map(links.filter(l=>l.metadata?.purpose==='ADVANCE_REQUEST'&&l.metadata?.reference).map(l=>[l.event_id,String(l.metadata.reference)]));
  result.debts=result.debts.map(d=>({...d,reference:advanceReferences.get(d.eventId!)??references.get(eventMap.get(d.eventId!)?.source_record_id??'')??d.eventId??d.id}));
  for(const d of result.debts){const sourceId=eventMap.get(d.eventId!)?.source_record_id;const side=sourceId?sides.get(sourceId):undefined;if(side)sourceDebtSides.set(d.id,side);}
  result.debtMovements=buildReportMovements(events,obligations,allocations,parties,references,sides);
  const installmentDue=new Map(links.filter(l=>l.metadata?.obligation_id&&l.metadata?.due_date).map(l=>[l.metadata.obligation_id,l.metadata.due_date]));
  result.debts=result.debts.map(d=>({...d,dueDate:installmentDue.get(d.id)??d.dueDate}));
  result.debtMovements=result.debtMovements.map(m=>({...m,due:installmentDue.get(m.debtId)??m.due}));
  if(ids.length>1)result.warnings.push('GROUP_BEFORE_INTERCOMPANY_ELIMINATION');
 }
 const categories=await all(()=>{const q=supabase.from('financial_debt_categories').select('*');return scope==='PERSONAL'?q.eq('owner_id',user.id):q.in('organization_id',ids);},['origin','record_id']);
 const categoryMap=new Map(categories.map(c=>[c.origin+':'+c.record_id,c.category]));
 result.debts=result.debts.map(d=>{
  const origin=d.organizationId?'CORE':d.source==='PERSONAL_PAYABLE'?'PERSONAL_PAYABLE':'PERSONAL_RECEIVABLE';
  const saved=categoryMap.get(origin+':'+d.id),inferred=inferDebtCategory(scope,d.side,d.source,sourceDebtSides.get(d.id));
  return {...d,category:['SUPPLIER_ADVANCE','CUSTOMER_ADVANCE'].includes(d.side)?d.side:saved??inferred,categoryInferred:!saved&&inferred!=='UNCLASSIFIED',categoryOrigin:['RECEIVABLE','PAYABLE'].includes(d.side)?origin:undefined};
 });
 const classifiedDebts=new Map(result.debts.map(d=>[d.id,d]));
 result.debtMovements=result.debtMovements.map(m=>{const origin=scope==='ORGANIZATION'?'CORE':m.side==='SALES'?'PERSONAL_RECEIVABLE':'PERSONAL_PAYABLE';return {...m,source:scope==='PERSONAL'?(m.side==='SALES'?'PERSONAL_ASSETS':'PERSONAL_PAYABLE'):m.source,category:m.advance?(m.side==='SALES'?'CUSTOMER_ADVANCE':'SUPPLIER_ADVANCE'):categoryMap.get(origin+':'+m.debtId)??classifiedDebts.get(m.debtId??'')?.category??'UNCLASSIFIED'};});
 result.assets=assets.filter((a:any)=>isRecognizedAsset(a)&&!['SOLD','DISPOSED','REDEEMED','CANCELLED'].includes(a.lifecycle_status)).filter((a:any)=>scope==='ORGANIZATION'||!['CASH','BANK','RECEIVABLE'].includes(a.asset_type)).map((a:any)=>({id:a.id,name:a.name,type:a.asset_type,currency:a.current_value_currency,cost:Number(a.current_cost_value),market:Number(a.current_market_value),organizationId:a.organization_id??null,entityId:a.entity_id??null,category:['CASH','BANK'].includes(a.asset_type)?'LEGACY_CASH':a.asset_type==='RECEIVABLE'?'LEGACY_RECEIVABLE':a.metadata?.investment_id||a.asset_class_code==='INVESTMENT'||a.asset_type==='STOCK'?'INVESTMENT':'ASSET',source:a.metadata?.investment_id?'INVESTMENTS':'ASSETS'}));
 if(scope==='ORGANIZATION'&&!debtOnly&&ids.length){
  const [contracts,movements]=await Promise.all([all(()=>supabase.from('participation_contracts').select('id,project,currency,organization_id,entity_id').in('organization_id',ids).eq('direction','OUTGOING').is('deleted_at',null)),all(()=>supabase.from('participation_movements').select('contract_id,kind,amount').in('organization_id',ids).eq('execution_state','POSTED'))]);
  for(const c of contracts){const rows=movements.filter(m=>m.contract_id===c.id),funded=rows.filter(m=>m.kind==='CAPITAL_RECEIPT').reduce((n,m)=>n.plus(m.amount),new Decimal(0)).toNumber(),reductions=rows.filter(m=>['CAPITAL_RETURN','LOSS'].includes(m.kind)).reduce((n,m)=>n.plus(m.amount),new Decimal(0)).toNumber(),carrying=Decimal.max(0,new Decimal(funded).minus(reductions)).toNumber();if(carrying>0)result.assets.push({id:c.id,name:c.project,type:'INVESTMENT',currency:c.currency,cost:carrying,market:carrying,organizationId:c.organization_id,entityId:c.entity_id,category:'INVESTMENT',source:'EXTERNAL_INVESTMENT'});}
 }
 if(result.assets.some(a=>a.category.startsWith('LEGACY_')&&(a.cost||a.market)))result.warnings.push('LEGACY_FINANCIAL_ASSETS_NOT_DOUBLED');
 return result;
}
