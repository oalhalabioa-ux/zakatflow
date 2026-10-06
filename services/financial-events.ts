import {requireUser} from './auth';
import {assertFinancialBudgetQA} from './financial-budget';
import {financialEventActionSchema,allowedEventActions,type EventPermissions,type EventPermission} from '../lib/financial-event-command';
import {z} from 'zod';

const scopes:EventPermission[]=['financial_core.view','financial_core.create','financial_core.approve','financial_core.post','liquidity.edit','liquidity.settle','vat.view','organization.edit'];
function unwrap<T>(result:{data:T;error:{message:string}|null}):T{if(result.error)throw new Error(result.error.message);return result.data;}
async function session(){return requireUser();}
async function scope(organization:string){
 z.string().uuid().parse(organization);const context=await session();
 const values=await Promise.all(scopes.map(async permission=>[permission,unwrap(await context.supabase.rpc('effective_organization_permission',{p_org:organization,p_permission:permission,p_amount:null,p_currency:null}))]));
 const permissions=Object.fromEntries(values) as EventPermissions;
 if(!permissions['financial_core.view'])throw new Error('FINANCIAL_CORE_VIEW_DENIED');
 return {...context,permissions};
}
export async function financialEventContext(){assertFinancialBudgetQA();const{user,supabase}=await session();return{userId:user.id,environment:'Financial Core QA',project:'wtzgzmcgcqouziqzsfnl',organizations:unwrap(await supabase.from('organizations').select('id,name,base_currency').order('name'))};}
export async function financialEventWorkspace(organization:string){
 assertFinancialBudgetQA();
 const{supabase,user,permissions}=await scope(organization);
 const tables=['organization_entities','organization_cost_centers','financial_classifications','liquidity_counterparties','liquidity_accounts'] as const;
 const results=await Promise.all(tables.map(table=>supabase.from(table).select('*').eq('organization_id',organization).eq('active',true).order('name')));
 const records=Object.fromEntries(results.map((result,index)=>[tables[index],unwrap(result)]));
 const events=unwrap(await supabase.from('financial_events').select('*').eq('organization_id',organization).order('created_at',{ascending:false}).limit(100));
 const sources=permissions['vat.view']?unwrap(await supabase.from('vat_documents').select('id,document_number,document_type,document_kind,transaction_date,source_currency,source_net_amount,source_tax_amount,source_gross_amount,recoverable_percent,counterparty_name').eq('organization_id',organization).order('created_at',{ascending:false}).limit(100)):[];
 const invoices=permissions['vat.view']?unwrap(await supabase.from('vat_einvoices').select('id,invoice_number,issue_date,status,currency,tax_exclusive_amount,tax_total_amount,tax_inclusive_amount').eq('organization_id',organization).in('status',['ISSUED','SUBMITTED','CLEARED','REPORTED']).order('created_at',{ascending:false}).limit(100)):[];
 return{userId:user.id,permissions,events,sources,invoices,...records};
}
export async function financialEventDetail(organization:string,eventId:string){
 assertFinancialBudgetQA();
 z.string().uuid().parse(eventId);const{supabase,user,permissions}=await scope(organization);
 const event=unwrap(await supabase.from('financial_events').select('*').eq('organization_id',organization).eq('id',eventId).single());
 const names=['financial_event_lines','financial_event_obligations','financial_event_approvals','financial_event_status_history','financial_event_links'] as const;
 const results=await Promise.all(names.map(name=>supabase.from(name).select('*').eq('organization_id',organization).eq('event_id',eventId)));
 const data=Object.fromEntries(results.map((result,index)=>[names[index],unwrap(result)]));
 const approvals=data.financial_event_approvals as {decision:string;approver_id:string}[];
 const canSelfApprove=event.created_by===user.id?Boolean(unwrap(await supabase.rpc('can_self_approve_financial_event',{p_org:organization}))):false;
 const balances=unwrap(await supabase.from('financial_event_obligation_balances').select('*').eq('organization_id',organization).eq('event_id',eventId));
 const links=data.financial_event_links as {link_type:string;target_module:string;target_record_id:string}[];
 const flowIds=links.filter(x=>x.link_type==='CASH_FLOW'&&x.target_module==='liquidity_flows').map(x=>x.target_record_id);
 const flows=flowIds.length?unwrap(await supabase.from('liquidity_flows').select('*').eq('organization_id',organization).in('id',flowIds)):[];
 const reconciliation=flowIds.length?unwrap(await supabase.from('liquidity_flow_settlement_reconciliation').select('*').eq('organization_id',organization).in('flow_id',flowIds)):[];
 const applications=unwrap(await supabase.from('financial_event_obligation_allocations').select('*').eq('organization_id',organization).eq('application_event_id',eventId));
 const settlements=unwrap(await supabase.from('liquidity_settlements').select('*').eq('organization_id',organization).eq('financial_event_id',eventId));
 return{event,permissions,allowedActions:allowedEventActions(event,user.id,permissions,approvals.some(a=>a.decision==='APPROVED'),canSelfApprove),canSelfApprove,balances,flows,reconciliation,applications,settlements,...data};
}
export async function executeFinancialEventAction(input:unknown){
 const command=financialEventActionSchema.parse(input);const org=command.action==='CREATE'?command.payload.organization_id:command.organization_id;
 const{supabase,user,permissions}=await scope(org);
 const requirePermission=(permission:EventPermission)=>{if(!permissions[permission])throw new Error(`${permission.toUpperCase().replaceAll('.','_')}_DENIED`);};
 let event:{event_type:string;source_module:string;created_by:string}|null=null;
 if('event_id' in command)event=unwrap(await supabase.from('financial_events').select('event_type,source_module,created_by').eq('organization_id',org).eq('id',command.event_id).single());
 switch(command.action){
  case 'CREATE':requirePermission('financial_core.create');return unwrap(await supabase.rpc('create_financial_event_command',{p_payload:command.payload}));
  case 'PREPARE_VAT':{
   requirePermission('financial_core.create');requirePermission('vat.view');
   // Read with the actual session and verify scope before invoking the existing adapter.
   unwrap(await supabase.from(command.source_table).select('id').eq('organization_id',org).eq('id',command.source_id).single());
   return unwrap(await supabase.rpc('prepare_vat_financial_event',{p_source_table:command.source_table,p_source_id:command.source_id,p_entity_id:command.entity_id,p_due_date:command.due_date}));
  }
  case 'TRANSITION':
   requirePermission(command.status==='ACTUAL'?'financial_core.post':'financial_core.create');
   if(command.status==='ACTUAL'&&(event?.event_type==='SETTLEMENT'||event?.source_module==='VAT_INTEGRATION'))throw new Error('DEDICATED_POST_ACTION_REQUIRED');
   return unwrap(await supabase.rpc('transition_financial_event',{p_event_id:command.event_id,p_new_status:command.status,p_note:command.note}));
  case 'APPROVE':requirePermission('financial_core.approve');return unwrap(await supabase.rpc('approve_financial_event',{p_event_id:command.event_id,p_note:command.note}));
  case 'RECOGNIZE_VAT':requirePermission('financial_core.post');requirePermission('vat.view');requirePermission('liquidity.edit');return unwrap(await supabase.rpc('post_vat_financial_event',{p_event_id:command.event_id}));
  case 'POST_SETTLEMENT':requirePermission('financial_core.post');requirePermission('liquidity.edit');requirePermission('liquidity.settle');return unwrap(await supabase.rpc('post_financial_settlement',{p_financial_event_id:command.event_id,p_account_id:command.account_id,p_direction:command.direction,p_settlement_date:command.settlement_date,p_amount:command.amount,p_currency:command.currency,p_exchange_rate:command.exchange_rate,p_base_amount:command.base_amount,p_allocations:command.allocations}));
  case 'POST_SAVED_SETTLEMENT':{
   requirePermission('financial_core.post');requirePermission('liquidity.edit');requirePermission('liquidity.settle');
   if(event?.event_type!=='SETTLEMENT')throw new Error('SETTLEMENT_EVENT_REQUIRED');
   const instruction=unwrap(await supabase.from('financial_event_links').select('target_record_id,metadata').eq('organization_id',org).eq('event_id',command.event_id).eq('link_type','OTHER').eq('target_module','liquidity_flows').contains('metadata',{purpose:'SETTLEMENT_INSTRUCTION'}).maybeSingle());
   if(!instruction)throw new Error('SETTLEMENT_INSTRUCTION_REQUIRED');
   const m=(instruction.metadata||{}) as Record<string,any>;const accountId=command.account_id??m.account_id;const settlementDate=command.settlement_date??m.settlement_date;
   if(!accountId)throw new Error('SETTLEMENT_ACCOUNT_REQUIRED');if(!settlementDate)throw new Error('SETTLEMENT_DATE_REQUIRED');
   const account=unwrap(await supabase.from('liquidity_accounts').select('id,currency').eq('organization_id',org).eq('id',accountId).single());
   if(!account)throw new Error('SETTLEMENT_ACCOUNT_REQUIRED');
   if(account.currency!==m.currency)throw new Error('SETTLEMENT_ACCOUNT_CURRENCY_MISMATCH');
   const balance=unwrap(await supabase.from('financial_event_obligation_balances').select('obligation_id,outstanding_base_amount').eq('organization_id',org).eq('obligation_id',m.obligation_id).single());
   if(!balance)throw new Error('SETTLEMENT_OBLIGATION_REQUIRED');
   if(Number(balance.outstanding_base_amount)+0.0001<Number(m.base_amount))throw new Error('SETTLEMENT_EXCEEDS_OUTSTANDING');
   const flow=unwrap(await supabase.from('liquidity_flows').select('id,currency,settled_amount,amount').eq('organization_id',org).eq('id',instruction.target_record_id).single());
   if(!flow)throw new Error('SETTLEMENT_FLOW_REQUIRED');
   const flowAmount=Number(m.flow_amount??m.amount),flowCurrency=String(m.flow_currency??flow.currency),flowExchangeRate=Number(m.flow_exchange_rate??m.exchange_rate);
   if(flowCurrency!==flow.currency)throw new Error('SETTLEMENT_FLOW_CURRENCY_MISMATCH');
   const flowOutstanding=Math.max(0,Number(flow.amount)-Number(flow.settled_amount||0));
   if(flowOutstanding+0.0001<flowAmount)throw new Error('SETTLEMENT_EXCEEDS_FLOW_OUTSTANDING');
   if(accountId!==m.account_id||settlementDate!==m.settlement_date){
    unwrap(await supabase.from('financial_event_links').insert({organization_id:org,event_id:command.event_id,link_type:'OTHER',target_module:'liquidity_flows',target_record_id:instruction.target_record_id,metadata:{purpose:'SETTLEMENT_EXECUTION_OVERRIDE',original_account_id:m.account_id,actual_account_id:accountId,original_settlement_date:m.settlement_date,actual_settlement_date:settlementDate,changed_by:user.id,changed_at:new Date().toISOString()}}));
   }
   return unwrap(await supabase.rpc('post_financial_settlement',{p_financial_event_id:command.event_id,p_account_id:accountId,p_direction:m.direction,p_settlement_date:settlementDate,p_amount:Number(m.amount),p_currency:m.currency,p_exchange_rate:Number(m.exchange_rate),p_base_amount:Number(m.base_amount),p_allocations:[{obligation_id:m.obligation_id,flow_id:instruction.target_record_id,amount:Number(m.amount),base_amount:Number(m.base_amount),flow_amount:flowAmount,flow_currency:flowCurrency,flow_exchange_rate:flowExchangeRate}]}));
  }
  case 'CLASSIFICATION':requirePermission('organization.edit');return unwrap(await supabase.from('financial_classifications').insert({organization_id:org,code:command.code,name:command.name,classification_type:command.classification_type,created_by:user.id}).select('id').single());
  case 'ROUTE':return unwrap(await supabase.rpc('configure_financial_budget',{p_key:command.key,p_payload:{action:'ROUTE',organization_id:org,event_id:command.event_id,entity_id:command.entity_id,cost_center_id:command.cost_center_id}}));
 }
}