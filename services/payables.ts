import {sourceVoucher} from '../lib/source-voucher';
import {requireUser} from './auth';
import {requireOrganizationMember} from './organization-access';
import {executeFinancialEventAction} from './financial-events';
import {allowedEventActions,type EventPermissions} from '../lib/financial-event-command';
import {payableCommandSchema,payablePaymentAmounts,type PayableDetail} from '../lib/payables';
import {riyadhToday} from '../lib/financial-register';
import {z} from 'zod';
const unwrap=(r:any)=>{if(r.error)throw Error(r.error.message);return r.data;};
async function rows(query:()=>any){const result:any[]=[];for(let offset=0;offset<20000;offset+=500){const page=unwrap(await query().order('id').range(offset,offset+499));result.push(...page);if(page.length<500)return result;}throw Error('REPORT_TOO_LARGE');}
async function context(organizationId:string,obligationId:string){
 z.string().uuid().parse(organizationId);z.string().uuid().parse(obligationId);
 const {supabase,user}=await requireUser();await requireOrganizationMember(supabase,user.id,organizationId);
 const scopeNames=['financial_core.view','financial_core.create','financial_core.approve','financial_core.post','liquidity.edit','liquidity.settle'] as const;
 const permissions=Object.fromEntries(await Promise.all(scopeNames.map(async p=>[p,Boolean(unwrap(await supabase.rpc('effective_organization_permission',{p_org:organizationId,p_permission:p,p_amount:null,p_currency:null})))]))) as EventPermissions;
 if(!permissions['financial_core.view'])throw Error('FINANCIAL_CORE_VIEW_DENIED');
 const obligation=unwrap(await supabase.from('financial_event_obligations').select('*').eq('organization_id',organizationId).eq('id',obligationId).single());
 if(!['PAYABLE','RECEIVABLE'].includes(obligation.obligation_type)||obligation.adjusts_obligation_id)throw Error('PAYABLE_OBLIGATION_REQUIRED');
 const event=unwrap(await supabase.from('financial_events').select('*').eq('organization_id',organizationId).eq('id',obligation.event_id).single());
 if(event.status!=='ACTUAL')throw Error('PAYABLE_RECOGNITION_REQUIRED');
 const balance=unwrap(await supabase.from('financial_event_obligation_balances').select('*').eq('organization_id',organizationId).eq('obligation_id',obligationId).single());
 return {supabase,user,permissions,obligation:{...obligation,...balance,id:obligation.id},event};
}
async function requestReview(c:Awaited<ReturnType<typeof context>>,eventId:string){
 const {supabase,event,obligation,permissions,user}=c;
 const request=unwrap(await supabase.from('financial_events').select('*').eq('organization_id',event.organization_id).eq('id',eventId).eq('event_type','SETTLEMENT').single());
 // Source-controlled investment cash must always be posted by the investment workflow.
 if(request.source_module==='INVESTMENTS'||event.source_module==='INVESTMENTS')throw Error('PAYABLE_MANAGE_FROM_SOURCE');
 const link=unwrap(await supabase.from('financial_event_links').select('*').eq('organization_id',event.organization_id).eq('event_id',eventId).eq('link_type','OTHER').eq('target_module','liquidity_flows').contains('metadata',{purpose:'SETTLEMENT_INSTRUCTION',obligation_id:obligation.id}).single());
 if(link.metadata.recognition_event_id&&link.metadata.recognition_event_id!==event.id)throw Error('PAYABLE_REQUEST_SCOPE_MISMATCH');
 const approved=Boolean(unwrap(await supabase.rpc('financial_event_has_valid_approval',{p_event_id:eventId}))),self=Boolean(unwrap(await supabase.rpc('can_self_approve_financial_event',{p_org:event.organization_id})));
 const actions=allowedEventActions(request,user.id,permissions,approved,self);
 if(request.status==='COMMITTED'&&!approved&&permissions['financial_core.approve']&&permissions['financial_core.post']&&permissions['liquidity.edit']&&permissions['liquidity.settle']&&(request.created_by!==user.id||self))actions.push('APPROVE_AND_POST');
 return {event:request,instruction:{...link.metadata,flow_id:link.target_record_id},approved,actions};
}
export async function payableDetail(organizationId:string,obligationId:string):Promise<PayableDetail>{
 const c=await context(organizationId,obligationId),{supabase,event,obligation,permissions}=c;
 const [organization,party,links,accounts,allocations,instructions]=await Promise.all([
  supabase.from('organizations').select('id,name,base_currency').eq('id',organizationId).single().then(unwrap),
  event.counterparty_id?supabase.from('liquidity_counterparties').select('name').eq('organization_id',organizationId).eq('id',event.counterparty_id).maybeSingle().then(unwrap):null,
  rows(()=>supabase.from('financial_event_links').select('*').eq('organization_id',organizationId).eq('event_id',event.id)),
  rows(()=>supabase.from('liquidity_accounts').select('id,name,currency,current_balance,restricted_balance,uncleared_balance,active').eq('organization_id',organizationId)),
  rows(()=>supabase.from('financial_event_obligation_allocations').select('*').eq('organization_id',organizationId).eq('obligation_id',obligationId)),
  rows(()=>supabase.from('financial_event_links').select('*').eq('organization_id',organizationId).eq('link_type','OTHER').eq('target_module','liquidity_flows').contains('metadata',{purpose:'SETTLEMENT_INSTRUCTION',obligation_id:obligationId})),
 ]);
 const flowIds=[...new Set(links.filter(l=>l.link_type==='CASH_FLOW'&&l.target_module==='liquidity_flows'&&(!l.metadata?.obligation_id||l.metadata.obligation_id===obligationId)).map(l=>l.target_record_id))];
 const flows=flowIds.length?await rows(()=>supabase.from('liquidity_flows').select('id,title,account_id,currency,amount,settled_amount,direction,due_date,source_module,reference').eq('organization_id',organizationId).in('id',flowIds).eq('direction',obligation.obligation_type==='PAYABLE'?'OUTFLOW':'INFLOW')):[];
 const applicationIds=[...new Set(allocations.map(a=>a.application_event_id))];
 const applicationEvents=applicationIds.length?await rows(()=>supabase.from('financial_events').select('id,status,event_date,description').eq('organization_id',organizationId).in('id',applicationIds)):[];
 const settlements=applicationIds.length?await rows(()=>supabase.from('liquidity_settlements').select('id,financial_event_id,account_id,currency,amount,settlement_date,status').eq('organization_id',organizationId).in('financial_event_id',applicationIds)):[];
 const history=allocations.map(a=>{const e=applicationEvents.find(e=>e.id===a.application_event_id),s=settlements.find(s=>s.financial_event_id===a.application_event_id);return {...a,...sourceVoucher('EVENT',e??{id:a.application_event_id}),eventStatus:e?.status,date:s?.settlement_date??e?.event_date,description:e?.description??a.allocation_type,settlement:s??null,accountName:accounts.find(a=>a.id===s?.account_id)?.name??'—'};}).sort((a,b)=>(b.date??'').localeCompare(a.date??'')||a.id.localeCompare(b.id));
 const requestIds=[...new Set(instructions.map(i=>i.event_id))];
 // Only ordinary payable cash requests are offered here, never investment source commands.
 const requests=event.source_module==='INVESTMENTS'?[]:await Promise.all(requestIds.map(id=>requestReview(c,id)));
 const documentLink=links.find(l=>l.target_module==='vat_documents');
 const documentId=documentLink?.target_record_id??(event.source_module==='VAT_INTEGRATION'?event.source_record_id:null);
 const doc=documentId?unwrap(await supabase.from('vat_documents').select('id,purchase_number,document_number,document_kind,document_type').eq('organization_id',organizationId).eq('id',documentId).maybeSingle()):null;
 const assetSource=event.source_module==='ASSETS_INTEGRATION'&&event.source_record_id?unwrap(await supabase.from('transactions').select('id,purchase_number,reference,metadata,transaction_type').eq('organization_id',organizationId).eq('id',event.source_record_id).maybeSingle()):null;
 const contract=event.source_module==='DEBT_CONTRACTS'&&event.source_record_id?unwrap(await supabase.from('debt_contracts').select('id,kind,mode,side').eq('organization_id',organizationId).eq('id',event.source_record_id).maybeSingle()):null;
 const identity=doc?sourceVoucher('INVOICE',doc):assetSource?sourceVoucher('ASSET',assetSource):contract?sourceVoucher('DEBT',contract):sourceVoucher('EVENT',event);
 const sourceManaged=event.source_module==='INVESTMENTS';
 const due=links.find(l=>l.metadata?.obligation_id===obligationId&&l.metadata?.due_date)?.metadata.due_date;if(due)event.due_date=due;
 return {...identity,organization,obligation,event,partyName:party?.name??'غير محدد',reference:doc?.document_number??assetSource?.reference??assetSource?.metadata?.invoice_reference??flows.find(f=>f.reference)?.reference??event.source_event_key??event.id,flows,accounts,history,requests,sourceManaged,canPrepare:!sourceManaged&&Number(obligation.outstanding_base_amount)>0&&permissions['financial_core.create']&&permissions['liquidity.edit']&&permissions['liquidity.settle']};
}
export async function actOnPayable(organizationId:string,obligationId:string,input:unknown){
 const command=payableCommandSchema.parse(input),c=await context(organizationId,obligationId),{supabase,event,obligation,permissions}=c;
 if(event.source_module==='INVESTMENTS')throw Error('PAYABLE_MANAGE_FROM_SOURCE');
 if(command.action!=='PREPARE'){
  const review=await requestReview(c,command.event_id);
  if(review.event.status==='ACTUAL'&&command.action!=='CANCEL')return {eventId:command.event_id,status:'ACTUAL'};
  if(command.action==='SUBMIT'){
   if(!review.actions.some(a=>['PLANNED','COMMITTED'].includes(a)))throw Error('PAYABLE_ACTION_DENIED');
   if(review.event.status==='DRAFT')await executeFinancialEventAction({action:'TRANSITION',organization_id:organizationId,event_id:command.event_id,status:'PLANNED',note:command.reason});
   await executeFinancialEventAction({action:'TRANSITION',organization_id:organizationId,event_id:command.event_id,status:'COMMITTED',note:command.reason});
   return {eventId:command.event_id,status:'COMMITTED'};
  }
  if(command.action==='APPROVE'){
   if(!review.actions.includes('APPROVE'))throw Error('PAYABLE_ACTION_DENIED');
   await executeFinancialEventAction({action:'APPROVE',organization_id:organizationId,event_id:command.event_id,note:command.reason});
   return {eventId:command.event_id,status:'COMMITTED',approved:true};
  }
  if(command.action==='CANCEL'){
   if(!review.actions.includes('CANCELLED'))throw Error('PAYABLE_ACTION_DENIED');
   await executeFinancialEventAction({action:'TRANSITION',organization_id:organizationId,event_id:command.event_id,status:'CANCELLED',note:command.reason});
   return {eventId:command.event_id,status:'CANCELLED'};
  }
  if(command.action==='APPROVE_AND_POST'){
   if(!review.actions.includes('APPROVE_AND_POST'))throw Error('PAYABLE_ACTION_DENIED');
   await executeFinancialEventAction({action:'APPROVE',organization_id:organizationId,event_id:command.event_id,note:command.reason});
  }else if(!review.actions.includes('POST_SETTLEMENT'))throw Error('PAYABLE_ACTION_DENIED');
  await executeFinancialEventAction({action:'POST_SAVED_SETTLEMENT',organization_id:organizationId,event_id:command.event_id});
  return {eventId:command.event_id,status:'ACTUAL'};
 }
 if(!permissions['financial_core.create']||!permissions['liquidity.edit']||!permissions['liquidity.settle'])throw Error('PAYABLE_ACTION_DENIED');
 if(command.date>riyadhToday()||command.date<event.event_date)throw Error('PAYABLE_PAYMENT_DATE_INVALID');
 const key=`payable-register:${obligationId}:${command.request_id}`,fingerprint=JSON.stringify([obligationId,command.account_id,command.flow_id,command.date,command.amount,command.notes]);
 const prior=unwrap(await supabase.from('financial_events').select('id,status').eq('organization_id',organizationId).eq('source_module','OPERATIONAL_CONSOLE').eq('source_event_key',key).maybeSingle());
 if(prior){const r=await requestReview(c,prior.id);if(r.instruction.register_fingerprint!==fingerprint)throw Error('PAYABLE_REQUEST_CONFLICT');if(r.event.status==='CANCELLED')throw Error('PAYABLE_REQUEST_CANCELLED');if(r.event.status==='DRAFT')await executeFinancialEventAction({action:'TRANSITION',organization_id:organizationId,event_id:prior.id,status:'PLANNED',note:'استكمال طلب السداد المحفوظ'});if(['DRAFT','PLANNED'].includes(r.event.status))await executeFinancialEventAction({action:'TRANSITION',organization_id:organizationId,event_id:prior.id,status:'COMMITTED',note:'بانتظار اعتماد السداد'});return {eventId:prior.id,status:['DRAFT','PLANNED'].includes(r.event.status)?'COMMITTED':r.event.status};}
 const [account,flow,link]=await Promise.all([
  supabase.from('liquidity_accounts').select('id,currency,active').eq('organization_id',organizationId).eq('id',command.account_id).single().then(unwrap),
  supabase.from('liquidity_flows').select('id,direction,currency,amount,settled_amount').eq('organization_id',organizationId).eq('id',command.flow_id).single().then(unwrap),
  supabase.from('financial_event_links').select('id,metadata').eq('organization_id',organizationId).eq('event_id',event.id).eq('target_module','liquidity_flows').eq('link_type','CASH_FLOW').eq('target_record_id',command.flow_id).single().then(unwrap),
 ]);
 if(!link||(link.metadata?.obligation_id&&link.metadata.obligation_id!==obligationId)||!account.active||flow.direction!==(obligation.obligation_type==='PAYABLE'?'OUTFLOW':'INFLOW')||account.currency!==obligation.currency||flow.currency!==obligation.currency)throw Error('PAYABLE_PAYMENT_SCOPE_MISMATCH');
 const amounts=payablePaymentAmounts(command.amount,Number(obligation.exchange_rate),Number(obligation.outstanding_base_amount),Number(flow.amount)-Number(flow.settled_amount??0));
 const classification=unwrap(await supabase.from('financial_classifications').select('id').eq('organization_id',organizationId).eq('classification_type',obligation.obligation_type).eq('active',true).order('id').limit(1).maybeSingle());if(!classification)throw Error('SETTLEMENT_CLASSIFICATION_REQUIRED');
 const created:any=await executeFinancialEventAction({action:'CREATE',payload:{organization_id:organizationId,entity_id:event.entity_id,counterparty_id:event.counterparty_id,event_type:'SETTLEMENT',source_module:'OPERATIONAL_CONSOLE',source_event_key:key,event_date:command.date,due_date:null,base_currency:obligation.base_currency,description:`${obligation.obligation_type==='PAYABLE'?'سداد':'تحصيل'} / ${event.description} / ${command.notes}`,lines:[{line_number:1,description:command.notes,classification_id:classification.id,cost_center_id:null,amount:amounts.amount,currency:obligation.currency,exchange_rate:amounts.exchangeRate,base_amount:amounts.baseAmount,cash_direction:obligation.obligation_type==='PAYABLE'?'OUTFLOW':'INFLOW',vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}],obligations:[],links:[{link_type:'OTHER',target_module:'liquidity_flows',target_record_id:command.flow_id,metadata:{purpose:'SETTLEMENT_INSTRUCTION',register_fingerprint:fingerprint,account_id:command.account_id,settlement_date:command.date,recognition_event_id:event.id,obligation_id:obligationId,direction:obligation.obligation_type==='PAYABLE'?'OUTFLOW':'INFLOW',amount:amounts.amount,currency:obligation.currency,exchange_rate:amounts.exchangeRate,base_amount:amounts.baseAmount,flow_amount:amounts.amount,flow_currency:flow.currency,flow_exchange_rate:amounts.exchangeRate}}]}});
 const eventId=typeof created==='string'?created:created?.event_id??created?.id;if(!eventId)throw Error('SETTLEMENT_EVENT_ID_MISSING');
 const state=unwrap(await supabase.from('financial_events').select('status').eq('organization_id',organizationId).eq('id',eventId).single());
 if(state.status==='DRAFT')await executeFinancialEventAction({action:'TRANSITION',organization_id:organizationId,event_id:eventId,status:'PLANNED',note:'طلب سداد من الذمم الدائنة'});
 if(['DRAFT','PLANNED'].includes(state.status))await executeFinancialEventAction({action:'TRANSITION',organization_id:organizationId,event_id:eventId,status:'COMMITTED',note:'بانتظار اعتماد السداد'});
 return {eventId,status:'COMMITTED'};
}
