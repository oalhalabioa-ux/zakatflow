import {withVoucherNumbers} from './voucher-numbers';
import {sourceVoucher} from '../lib/source-voucher';
import {transactionVoucher,voucherNumber,movementType} from '../lib/voucher-identity';
import Decimal from 'decimal.js';
import {personalContractRegister} from '../lib/personal-contract-register';
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
 const [rawAssets,assetTransactions]=await Promise.all([debtOnly&&scope==='ORGANIZATION'?Promise.resolve([]):all(assetQuery),debtOnly?Promise.resolve([]):all(()=>{const q=supabase.from('transactions').select('id,asset_account_id,organization_id,transaction_type,purchase_number,reference,metadata');return scope==='PERSONAL'?q.eq('user_id',user.id).is('organization_id',null):q.in('organization_id',ids);})]);
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
  result.cashMovements=transactions.filter(t=>cashAssets.some((a:any)=>a.id===t.asset_account_id)&&!t.metadata?.asset_deleted).map(t=>({id:t.id,accountId:t.asset_account_id,date:t.transaction_date,createdAt:t.created_at,currency:t.base_currency,amount:signed(t),reference:t.reference||t.id,source:'ASSETS',...transactionVoucher(t,byId.get(t.reversal_of_transaction_id)),description:t.transaction_type==='OPENING_BALANCE'?'إثبات رصيد افتتاحي · '+(cashAssets.find((a:any)=>a.id===t.asset_account_id)?.name??'الحساب'):t.notes||t.transaction_type}));
  const personalDebts=new Map(assets.filter((a:any)=>a.asset_type==='RECEIVABLE').map((a:any)=>[a.id,a]));
  result.debtMovements=transactions.filter(t=>personalDebts.has(t.asset_account_id)&&!t.metadata?.asset_deleted).map(t=>({id:t.id,debtId:t.asset_account_id,createdAt:t.created_at,organizationId:'PERSONAL',partyKey:t.asset_account_id,partyName:(personalDebts.get(t.asset_account_id) as any).name,side:'SALES' as const,date:t.transaction_date,due:(personalDebts.get(t.asset_account_id) as any).metadata?.due_date||null,reference:t.reference||t.id,description:t.notes||t.transaction_type,currency:t.base_currency,amount:signed(t),advance:false,kind:t.transaction_type})).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const receivableBalances=new Map<string,number>();
  for(const movement of result.debtMovements)if(movement.debtId)receivableBalances.set(movement.debtId,(receivableBalances.get(movement.debtId)??0)+Number(movement.amount||0));
  result.debts=assets.filter((a:any)=>a.asset_type==='RECEIVABLE').map((a:any)=>({id:a.id,partyKey:a.id,partyName:a.name,organizationId:null,entityId:null,side:'RECEIVABLE' as const,currency:a.current_value_currency,amount:receivableBalances.has(a.id)?receivableBalances.get(a.id)!:Number(a.current_market_value),date:a.metadata?.purchase_date||asOf,dueDate:a.metadata?.due_date||null,description:a.name,source:'PERSONAL_ASSETS' as const,eventId:null})).filter((d:any)=>d.amount>0);
  const [personalPayables,personalPayments]=await Promise.all([all(()=>supabase.from('personal_payables').select('*').eq('user_id',user.id)),all(()=>supabase.from('personal_payable_payments').select('*').eq('user_id',user.id))]);
  const payables=personalPayableRecords(personalPayables,personalPayments,transactions);
  result.debts.push(...payables.debts);result.debtMovements.push(...payables.movements);result.debtMovements.sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt??'').localeCompare(b.createdAt??'')||({INVOICE:0,PAYMENT:1,REVERSAL:2}[a.kind as 'INVOICE']??1)-({INVOICE:0,PAYMENT:1,REVERSAL:2}[b.kind as 'INVOICE']??1)||a.id.localeCompare(b.id));
  result.personalPayments=payables.history;
  const personalFinancings=await all(()=>supabase.from('personal_financings').select('id,kind,side,receivable_id,payable_id,request_id,cash_transaction_id').eq('user_id',user.id));
  const links=await all(()=>supabase.from('personal_debt_links').select('record_id,side,party_key,party_name').eq('user_id',user.id));const linked=applyPersonalDebtLinks(result,links);const profiles=await all(()=>supabase.from('personal_debt_parties').select('id,party_key,name').eq('user_id',user.id));const aliases=new Map(profiles.map(p=>[p.party_key,p.name]));result.debts=linked.debts.map(d=>({...d,partyName:aliases.get(d.partyKey)??d.partyName}));result.debtMovements=linked.debtMovements.map(m=>({...m,partyName:aliases.get(m.partyKey)??m.partyName}));
  const advances=new Map(personalFinancings.filter(f=>f.kind==='ADVANCE').map(f=>[f.receivable_id??f.payable_id,f]));
  const fundedPayables=new Set(personalFinancings.map(f=>f.payable_id).filter(Boolean));
  result.debts=result.debts.map(d=>({...d,financialLocked:fundedPayables.has(d.id)}));
  result.debts=result.debts.map(d=>advances.has(d.id)?{...d,side:advances.get(d.id).side==='RECEIVABLE'?'SUPPLIER_ADVANCE':'CUSTOMER_ADVANCE'}:d);
  result.debtMovements=result.debtMovements.map(m=>advances.has(m.debtId)?{...m,advance:true,side:advances.get(m.debtId).side==='RECEIVABLE'?'PURCHASE':'SALES',amount:-m.amount}:m);
  const [contracts,installments,contractOperations]=await Promise.all([
   all(()=>supabase.from('personal_contracts').select('*').eq('user_id',user.id)),
   all(()=>supabase.from('personal_contract_installments').select('*').eq('user_id',user.id)),
   all(()=>supabase.from('personal_contract_movements').select('*').eq('user_id',user.id))
  ]);
  // Incoming participation losses reduce the canonical liability, but must remain
  // dated adjustments rather than rewriting the historic capital receipt.
  for(const c of contracts.filter(c=>c.status==='POSTED'&&c.product==='PARTICIPATION'&&c.payable_id)){
   const raw=personalPayables.find(d=>d.id===c.payable_id);if(!raw)continue;
   const original=personalPayableRecords([{...raw,amount:c.principal,cancelled_at:null}],personalPayments,transactions).movements;
   result.debtMovements=result.debtMovements.filter(m=>m.debtId!==c.payable_id);
   result.debtMovements.push(...original);
   for(const op of contractOperations.filter(m=>m.contract_id===c.id&&m.kind==='LOSS')){
    const root=original.find(m=>m.kind==='INVOICE');if(!root)continue;
    result.debtMovements.push({...root,id:op.id,date:op.operation_date,createdAt:op.created_at,amount:-Number(op.amount),kind:'ADJUSTMENT',description:op.notes});
    if(op.reversed_at)result.debtMovements.push({...root,id:'reverse:'+op.id,date:op.reversal_date??op.reversed_at.slice(0,10),createdAt:op.reversed_at,amount:Number(op.amount),kind:'REVERSAL',description:'عكس خسارة رأس المال'});
   }
  }
  const contractRegister=personalContractRegister(result.debts,result.debtMovements,contracts,installments,contractOperations);
  result.debts=contractRegister.debts;result.debtMovements=contractRegister.movements;
  // Classify by persisted source, never by matching amounts, dates or description.
  const sourceIdentity=new Map<string,any>();
  for(const p of personalPayables){
   const f=personalFinancings.find(f=>f.payable_id===p.id&&f.request_id===p.request_id);
   sourceIdentity.set(p.id,{voucherSourceTable:'personal_payables',voucherSourceId:p.id,voucherNumber:voucherNumber(p.id,'AP'),voucherType:f?(f.kind==='ADVANCE'?'دفعة مقدمة مستلمة':'إضافة قرض مستلم'):'رصيد افتتاحي دائن',isOpening:!f});
  }
  const initialReceivableMovements=new Set<string>();
  for(const t of transactions.filter(t=>personalDebts.has(t.asset_account_id)&&['OPENING_BALANCE','TRANSFER_IN','ADD'].includes(t.transaction_type)).sort((a,b)=>a.transaction_date.localeCompare(b.transaction_date)||(a.created_at??'').localeCompare(b.created_at??'')||a.id.localeCompare(b.id))){if(!sourceIdentity.has(t.asset_account_id)){initialReceivableMovements.add(t.id);sourceIdentity.set(t.asset_account_id,{...transactionVoucher(t)});}}

  for(const c of contracts.filter(c=>c.status==='POSTED'&&c.terms.mode!=='LINKED')){
   const id=c.asset_id??c.payable_id;if(!id)continue;
   sourceIdentity.set(id,{voucherSourceTable:c.payable_id?'personal_payables':'personal_contracts',voucherSourceId:c.payable_id??c.id,voucherNumber:voucherNumber(id,c.payable_id?'AP':'AR'),voucherType:c.terms.mode==='OPENING'?'رصيد افتتاحي':c.product==='PARTICIPATION'?'إثبات رأس مال مشاركة':c.product==='FINANCING'?'إضافة تمويل':c.side==='PAYABLE'?'إضافة قرض مستلم':'إضافة قرض ممنوح',isOpening:c.terms.mode==='OPENING'});
  }
  for(const op of contractOperations.filter(m=>['CHARGE','PROFIT'].includes(m.kind))){const id=op.payable_id??op.asset_id;if(id)sourceIdentity.set(id,{voucherSourceTable:'personal_contract_movements',voucherSourceId:op.id,voucherNumber:voucherNumber(id,op.payable_id?'AP':'AR'),voucherType:op.kind==='CHARGE'?'إثبات تكلفة تمويل':'إثبات حصة ربح',isOpening:false});}
  result.debts=result.debts.map(d=>({...d,...sourceIdentity.get(d.sourceDebtId??d.id)}));
  result.debtMovements=result.debtMovements.map(m=>{
   if((m.kind==='INVOICE'||initialReceivableMovements.has(m.id))&&sourceIdentity.has(m.debtId??''))return {...m,...sourceIdentity.get(m.debtId!)};
   if(m.id.startsWith('reverse:')){const op=contractOperations.find(o=>o.id===m.id.slice(8));if(op?.reversal_request_id)return {...m,voucherSourceTable:'personal_contract_reversals',voucherSourceId:op.reversal_request_id,voucherType:'عكس سند',isOpening:false};}
   const t=byId.get(m.id),identity=t?transactionVoucher(t,byId.get(t.reversal_of_transaction_id)):{voucherSourceTable:'transactions',voucherSourceId:personalPayments.find(p=>p.id===m.id)?.transaction_id??m.id,voucherNumber:voucherNumber(m.id,'PV'),voucherType:m.kind==='REVERSAL'?'عكس سداد':m.kind==='PAYMENT'?'سند سداد':'تسوية ذمة',isOpening:false};
   if(t?.transaction_type==='REVERSAL'&&initialReceivableMovements.has(t.reversal_of_transaction_id)){identity.isOpening=Boolean(sourceIdentity.get(m.debtId??'')?.isOpening);identity.voucherType=identity.isOpening?'عكس رصيد افتتاحي':'عكس سند';}
   return {...m,...identity};
  });
  if(contracts.some(c=>c.status==='POSTED'&&(c.product!=='PARTICIPATION'||c.side==='PAYABLE')&&installments.filter(i=>i.contract_id===c.id).length!==c.terms.schedule.length))result.warnings.push('PERSONAL_CONTRACT_SCHEDULE_UNAVAILABLE');



 }else{
  const [accounts,settlements,flows,events,obligations,allocations,parties,balances,entities,links,documents,contracts]=await Promise.all([
   debtOnly?Promise.resolve([]):all(()=>supabase.from('liquidity_accounts').select('*').in('organization_id',ids).in('account_type',['BANK','CASH','WALLET']).eq('active',true)),
   debtOnly?Promise.resolve([]):all(()=>supabase.from('liquidity_settlements').select('*').in('organization_id',ids).in('status',['POSTED','REVERSED'])),
   debtOnly?Promise.resolve([]):all(()=>supabase.from('liquidity_flows').select('id,organization_id,account_id,direction,due_date,amount,currency,title,reference,source_module,transfer_id,created_at,status').in('organization_id',ids).eq('status','ACTUAL')),
   all(()=>supabase.from('financial_events').select('id,event_type,organization_id,entity_id,counterparty_id,event_date,due_date,status,description,source_record_id,source_module,source_event_key').in('organization_id',ids)),
   all(()=>supabase.from('financial_event_obligations').select('*').in('organization_id',ids)),
   all(()=>supabase.from('financial_event_obligation_allocations').select('*').in('organization_id',ids)),
   all(()=>supabase.from('liquidity_counterparties').select('id,organization_id,name').in('organization_id',ids)),
   all(()=>supabase.from('financial_event_obligation_balances').select('*').in('organization_id',ids),['obligation_id']),
   all(()=>supabase.from('organization_entities').select('id,name,organization_id').in('organization_id',ids)),
   all(()=>supabase.from('financial_event_links').select('id,organization_id,event_id,target_module,target_record_id,metadata').in('organization_id',ids)),
   all(()=>supabase.from('vat_documents').select('id,document_type,document_kind,purchase_number,document_number').in('organization_id',ids)),
   all(()=>supabase.from('debt_contracts').select('id,organization_id,financial_event_id,reference,schedule,kind,mode,side').in('organization_id',ids).is('deleted_at',null)),
  ]);
  result.entities=entities;result.accounts=accounts.map(a=>({id:a.id,name:a.name,type:a.account_type,currency:a.currency,nativeCurrency:a.currency,balance:Number(a.current_balance),restricted:Number(a.restricted_balance),uncleared:Number(a.uncleared_balance),baseCurrency:organizations.find(o=>o.id===a.organization_id)?.base_currency??a.currency,baseBalance:Number(a.current_balance_base),organizationId:a.organization_id,entityId:a.entity_id,source:'LIQUIDITY',openingDate:a.metadata?.opening_date??null}));
  const eventMap=new Map(events.map(e=>[e.id,e])),partyMap=new Map(parties.map(p=>[p.organization_id+':'+p.id,p.name]));
  const knownCashEvents=new Set(settlements.map(s=>s.financial_event_id)),settledRoots=new Set<string>(knownCashEvents),obMap=new Map(obligations.map(o=>[o.id,o]));
  for(const a of allocations)if(knownCashEvents.has(a.application_event_id)){const ob=obMap.get(a.obligation_id);if(ob)settledRoots.add(ob.event_id);}
  const coveredFlows=new Set(links.filter(l=>l.target_module==='liquidity_flows'&&settledRoots.has(l.event_id)).map(l=>l.target_record_id));
  result.cashMovements=settlements.map(s=>({...sourceVoucher('CASH_SETTLEMENT',s),id:s.id,accountId:s.account_id,date:s.settlement_date,createdAt:s.posted_at??s.created_at,currency:s.currency,amount:Number(s.amount)*(s.direction==='INFLOW'?1:-1),description:eventMap.get(s.financial_event_id)?.description||'تسوية نقدية',reference:s.source_event_key||s.id,source:s.source_module}));
  const postedSourceKeys=events.filter(e=>knownCashEvents.has(e.id)).map(e=>e.source_event_key??'');
  result.cashMovements.push(...flows.filter(f=>!coveredFlows.has(f.id)&&!postedSourceKeys.some(k=>k.includes(f.id))).map(f=>({...sourceVoucher('CASH_FLOW',f),id:'flow:'+f.id,accountId:f.account_id,date:f.due_date,createdAt:f.created_at,currency:f.currency,amount:Number(f.amount)*(f.direction==='INFLOW'?1:-1),description:f.title,reference:f.reference||f.id,source:f.transfer_id?'TRANSFER':'LEGACY_FLOW'})));
  result.debts=balances.flatMap((b:any):DebtItem[]=>{const e=eventMap.get(b.event_id);if(!e||e.status!=='ACTUAL')return [];const side=['RECEIVABLE','PAYABLE','CUSTOMER_ADVANCE','SUPPLIER_ADVANCE'].includes(b.obligation_type)?b.obligation_type:'UNAPPLIED';return [{id:b.obligation_id,partyKey:e.organization_id+':'+(e.counterparty_id||'unmapped:'+e.id),partyName:partyMap.get(e.organization_id+':'+e.counterparty_id)||'غير محدد',organizationId:e.organization_id,entityId:e.entity_id,side,currency:b.base_currency,amount:Number(b.outstanding_base_amount),dueDate:e.due_date,date:e.event_date,description:e.description,source:e.source_module,eventId:e.id,originalCurrency:b.currency,originalAmount:Number(b.settleable_amount),exchangeRate:Number(b.exchange_rate),totalBase:Number(b.adjusted_settleable_base_amount),appliedBase:Number(side.endsWith('_ADVANCE')?b.consumed_advance_base_amount:b.applied_base_amount)}];});
  const references=new Map<string,string>([...documents.map(d=>[d.id,d.purchase_number||d.document_number] as [string,string]),...contracts.map(c=>[c.id,c.reference] as [string,string])]),sides=new Map<string,'SALES'|'PURCHASE'>(documents.map(d=>[d.id,d.document_type]));
  const referenceTransactions=debtOnly?await inBatches([...new Set<string>(events.filter(e=>['ASSETS_INTEGRATION','ASSET_LIFECYCLE'].includes(e.source_module)).map(e=>e.source_record_id).filter(Boolean))],batch=>supabase.from('transactions').select('id,transaction_type,purchase_number,reference,metadata').in('organization_id',ids).in('id',batch)):assetTransactions;
  for(const tx of referenceTransactions){const ref=tx.reference||tx.metadata?.invoice_reference;if(ref&&!references.has(tx.id))references.set(tx.id,ref);}
  for(const l of links.filter(l=>l.target_module==='vat_documents')){const e=eventMap.get(l.event_id),d=documents.find(d=>d.id===l.target_record_id);if(e?.source_record_id&&d){references.set(e.source_record_id,d.document_number);sides.set(e.source_record_id,d.document_type);}}
  const advanceReferences=new Map(links.filter(l=>l.metadata?.purpose==='ADVANCE_REQUEST'&&l.metadata?.reference).map(l=>[l.event_id,String(l.metadata.reference)]));
  result.debts=result.debts.map(d=>({...d,reference:advanceReferences.get(d.eventId!)??references.get(eventMap.get(d.eventId!)?.source_record_id??'')??d.eventId??d.id}));
  for(const d of result.debts){const sourceId=eventMap.get(d.eventId!)?.source_record_id;const side=sourceId?sides.get(sourceId):undefined;if(side)sourceDebtSides.set(d.id,side);}
  for(const e of events){const tx=referenceTransactions.find(t=>t.id===e.source_record_id);if(tx){const v=sourceVoucher('ASSET',tx);Object.assign(e,{voucher_number:v.voucherNumber,voucher_type:v.voucherType});}}
  for(const e of events){const doc=documents.find(d=>d.id===e.source_record_id);if(doc)Object.assign(e,{document_number:doc.purchase_number||doc.document_number,document_type:doc.document_type,document_kind:doc.document_kind});}
  result.debtMovements=buildReportMovements(events,obligations,allocations,parties,references,sides);
  const installmentDue=new Map(links.filter(l=>l.metadata?.obligation_id&&l.metadata?.due_date).map(l=>[l.metadata.obligation_id,l.metadata.due_date]));
  // The current saved schedule includes approved rescheduling. Links are a fallback
  // for older records; dates never change the canonical outstanding balances.
  const contractsByEvent=new Map(contracts.map(c=>[c.financial_event_id,c])),contractsById=new Map(contracts.map(c=>[c.id,c]));
  const contractDue=new Map<string,string>();
  for(const b of balances){const c=contractsByEvent.get(b.event_id);if(!c||c.organization_id!==b.organization_id)continue;const key=b.obligation_key??obMap.get(b.obligation_id)?.obligation_key;const match=/^installment:([1-9]\d*)$/.exec(key??'');const due=match?c.schedule?.[Number(match[1])-1]?.due_date:null;if(due)contractDue.set(b.obligation_id,due);}
  result.debts=result.debts.map(d=>{const e=eventMap.get(d.eventId),cost=e?.source_module==='FINANCE_CONTRACTS',c=contractsByEvent.get(d.eventId)??(cost?contractsById.get(e.source_record_id):undefined);return {...d,loanContractId:c?.kind==='LOAN'?c.id:undefined,contractCategory:cost&&c?(c.side==='RECEIVABLE'?'O_AR_ACCRUED':'O_AP_ACCRUAL'):c?.kind==='LOAN'?(c.side==='RECEIVABLE'?'O_AR_LOAN':'O_AP_LOAN'):c?.kind==='EMPLOYEE_ADVANCE'?'O_AR_EMPLOYEE':undefined,dueDate:contractDue.get(d.id)??installmentDue.get(d.id)??d.dueDate};});
  result.debtMovements=result.debtMovements.map(m=>({...m,due:contractDue.get(m.debtId??'')??installmentDue.get(m.debtId)??m.due}));
  result.debts=result.debts.map(d=>{const e=eventMap.get(d.eventId),c=contractsByEvent.get(d.eventId);return {...d,...(c?sourceVoucher('DEBT',c):sourceVoucher(e?.document_number?'INVOICE':'EVENT',e??{id:d.eventId??d.id})),isOpening:Boolean(c&&(c.kind==='OPENING'||c.mode==='OPENING'))};});
  result.debtMovements=result.debtMovements.map(m=>{const e=eventMap.get(obMap.get(m.debtId??'')?.event_id),c=contractsByEvent.get(e?.id);return c&&['INVOICE','ADVANCE'].includes(m.kind)?{...m,...sourceVoucher('DEBT',c),isOpening:c.kind==='OPENING'||c.mode==='OPENING'}:m;});
  if(ids.length>1)result.warnings.push('GROUP_BEFORE_INTERCOMPANY_ELIMINATION');
 }
 const categories=await all(()=>{const q=supabase.from('financial_debt_categories').select('*');return scope==='PERSONAL'?q.eq('owner_id',user.id):q.in('organization_id',ids);},['origin','record_id']);
 const categoryMap=new Map(categories.map(c=>[c.origin+':'+c.record_id,c.category]));
 result.debts=result.debts.map(d=>{
  const origin=d.organizationId?'CORE':d.side==='PAYABLE'?'PERSONAL_PAYABLE':'PERSONAL_RECEIVABLE';
  const saved=categoryMap.get(origin+':'+(d.categoryRootId??d.id)),inferred=d.contractCategory??inferDebtCategory(scope,d.side,d.source,sourceDebtSides.get(d.id));
  return {...d,category:['SUPPLIER_ADVANCE','CUSTOMER_ADVANCE'].includes(d.side)?d.side:saved??inferred,categoryInferred:!saved&&inferred!=='UNCLASSIFIED',categoryOrigin:!d.personalContractId&&['RECEIVABLE','PAYABLE'].includes(d.side)?origin:undefined};
 });
 const classifiedDebts=new Map(result.debts.map(d=>[d.id,d]));
 result.debtMovements=result.debtMovements.map(m=>{const origin=scope==='ORGANIZATION'?'CORE':m.side==='SALES'?'PERSONAL_RECEIVABLE':'PERSONAL_PAYABLE';return {...m,source:scope==='PERSONAL'?(m.side==='SALES'?'PERSONAL_ASSETS':'PERSONAL_PAYABLE'):m.source,category:m.advance?(m.side==='SALES'?'CUSTOMER_ADVANCE':'SUPPLIER_ADVANCE'):categoryMap.get(origin+':'+m.debtId)??classifiedDebts.get(m.debtId??'')?.category??'UNCLASSIFIED'};});
 result.assets=assets.filter((a:any)=>isRecognizedAsset(a)&&!['SOLD','DISPOSED','REDEEMED','CANCELLED'].includes(a.lifecycle_status)).filter((a:any)=>scope==='ORGANIZATION'||!['CASH','BANK','RECEIVABLE'].includes(a.asset_type)).map((a:any)=>({id:a.id,name:a.name,type:a.asset_type,assetClassCode:a.asset_class_code??null,assetTypeCode:a.asset_type_code??null,currency:a.current_value_currency,cost:Number(a.current_cost_value),market:Number(a.current_market_value),organizationId:a.organization_id??null,entityId:a.entity_id??null,category:['CASH','BANK'].includes(a.asset_type)?'LEGACY_CASH':a.asset_type==='RECEIVABLE'?'LEGACY_RECEIVABLE':a.metadata?.investment_id||a.metadata?.personal_contract_id&&a.asset_type==='OTHER'||a.asset_class_code==='INVESTMENT'||a.asset_type==='STOCK'?'INVESTMENT':'ASSET',source:a.metadata?.personal_contract_id?'PERSONAL_CONTRACT':a.metadata?.investment_id?'INVESTMENTS':'ASSETS'}));
 if(scope==='ORGANIZATION'&&!debtOnly&&ids.length){
  const [contracts,movements]=await Promise.all([all(()=>supabase.from('participation_contracts').select('id,project,currency,organization_id,entity_id').in('organization_id',ids).eq('direction','OUTGOING').is('deleted_at',null)),all(()=>supabase.from('participation_movements').select('contract_id,kind,amount').in('organization_id',ids).eq('execution_state','POSTED'))]);
  for(const c of contracts){const rows=movements.filter(m=>m.contract_id===c.id),funded=rows.filter(m=>m.kind==='CAPITAL_RECEIPT').reduce((n,m)=>n.plus(m.amount),new Decimal(0)).toNumber(),reductions=rows.filter(m=>['CAPITAL_RETURN','LOSS'].includes(m.kind)).reduce((n,m)=>n.plus(m.amount),new Decimal(0)).toNumber(),carrying=Decimal.max(0,new Decimal(funded).minus(reductions)).toNumber();if(carrying>0)result.assets.push({id:c.id,name:c.project,type:'INVESTMENT',currency:c.currency,cost:carrying,market:carrying,organizationId:c.organization_id,entityId:c.entity_id,category:'INVESTMENT',source:'EXTERNAL_INVESTMENT'});}
 }
 if(result.assets.some(a=>a.category.startsWith('LEGACY_')&&(a.cost||a.market)))result.warnings.push('LEGACY_FINANCIAL_ASSETS_NOT_DOUBLED');
 return withVoucherNumbers(supabase,result);
}
