import {withVoucherNumbers} from './voucher-numbers';
import {requireUser} from './auth';
import {requireOrganizationMember} from './organization-access';
import {executeFinancialEventAction} from './financial-events';
import {allowedEventActions,type EventPermissions} from '../lib/financial-event-command';
import {advanceCommandSchema,advanceAmounts,compatibleAdvance,type AdvanceWorkspace} from '../lib/advances';
import {riyadhToday} from '../lib/financial-register';
import {z} from 'zod';
const unwrap=(r:any)=>{if(r.error)throw Error(r.error.message);return r.data;};
async function all(q:()=>any,key='id'){const out:any[]=[];for(let i=0;i<20000;i+=500){const page=unwrap(await q().order(key).range(i,i+499));out.push(...page);if(page.length<500)return out;}throw Error('REPORT_TOO_LARGE');}
async function context(org:string){z.string().uuid().parse(org);const c=await requireUser();await requireOrganizationMember(c.supabase,c.user.id,org);const permissions=Object.fromEntries(await Promise.all(['financial_core.view','financial_core.create','financial_core.approve','financial_core.post','liquidity.edit','liquidity.settle'].map(async p=>[p,Boolean(unwrap(await c.supabase.rpc('effective_organization_permission',{p_org:org,p_permission:p,p_amount:null,p_currency:null})))]))) as EventPermissions;if(!permissions['financial_core.view'])throw Error('ADVANCE_ACCESS_DENIED');return {...c,permissions};}
async function review(c:Awaited<ReturnType<typeof context>>,org:string,event:any){const approved=Boolean(unwrap(await c.supabase.rpc('financial_event_has_valid_approval',{p_event_id:event.id}))),self=Boolean(unwrap(await c.supabase.rpc('can_self_approve_financial_event',{p_org:org})));const actions=allowedEventActions(event,c.user.id,c.permissions,approved,self);return {...event,approved,actions:actions.filter(a=>!['ACTUAL','POST_SETTLEMENT'].includes(a)||(c.permissions['liquidity.edit']&&c.permissions['liquidity.settle'])).map(a=>a==='PLANNED'||a==='COMMITTED'?'SUBMIT':a==='ACTUAL'||a==='POST_SETTLEMENT'?'POST':a==='CANCELLED'?'CANCEL':a)};}
export async function advanceWorkspace(org:string):Promise<AdvanceWorkspace>{const c=await context(org),{supabase,permissions}=c;
 const [organization,parties,accounts,entities,balances,events,flows,partyTypes]=await Promise.all([
 supabase.from('organizations').select('base_currency').eq('id',org).single().then(unwrap),
 all(()=>supabase.from('liquidity_counterparties').select('id,name,party_type,party_type_id').eq('organization_id',org).eq('active',true)),
 all(()=>supabase.from('liquidity_accounts').select('id,name,currency,entity_id,current_balance,restricted_balance,uncleared_balance').eq('organization_id',org).eq('active',true)),
 all(()=>supabase.from('organization_entities').select('id,name').eq('organization_id',org).eq('active',true)),
 all(()=>supabase.from('financial_event_obligation_balances').select('*').eq('organization_id',org),'obligation_id'),
 all(()=>supabase.from('financial_events').select('id,event_type,status,source_module,event_date,counterparty_id,entity_id,description,created_by,created_at').eq('organization_id',org)),
 all(()=>supabase.from('liquidity_flows').select('id,title,currency,amount,settled_amount,source_module,direction').eq('organization_id',org)),
 all(()=>supabase.from('liquidity_party_types').select('id,code,name_ar,name_en').eq('organization_id',org).eq('active',true)),
 ]);
 const roots=balances.filter(b=>events.some(e=>e.id===b.event_id&&e.status==='ACTUAL')).map(b=>({...b,...{id:b.obligation_id},event:events.find(e=>e.id===b.event_id)}));
 const links=await all(()=>supabase.from('financial_event_links').select('id,event_id,target_record_id,metadata').eq('organization_id',org).eq('link_type','CASH_FLOW').eq('target_module','liquidity_flows'));
 return withVoucherNumbers(supabase,{reversibleEvents:events.filter(e=>e.status==='ACTUAL'&&['ADVANCE_WORKSPACE','DEBT_OPERATIONS'].includes(e.source_module)),baseCurrency:organization.base_currency,partyTypes,parties,accounts,entities,advances:roots.filter(b=>['SUPPLIER_ADVANCE','CUSTOMER_ADVANCE'].includes(b.obligation_type)),obligations:roots.filter(b=>['PAYABLE','RECEIVABLE'].includes(b.obligation_type)&&Number(b.outstanding_base_amount)>0&&b.event.source_module!=='INVESTMENTS'),flows:flows.map(f=>({...f,eventIds:links.filter(l=>l.target_record_id===f.id).map(l=>l.event_id)})),requests:await Promise.all(events.filter(e=>e.source_module==='ADVANCE_WORKSPACE').sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,100).map(e=>review(c,org,e))),canCreate:permissions['financial_core.create']&&permissions['liquidity.edit']&&permissions['liquidity.settle']});
}
export async function advanceAction(org:string,input:unknown){const cmd=advanceCommandSchema.parse(input),c=await context(org),{supabase,permissions}=c;
 if(!['RECORD','APPLY'].includes(cmd.action)){
  if(!('event_id'in cmd))throw Error('ADVANCE_COMMAND_INVALID');
  const event=unwrap(await supabase.from('financial_events').select('*').eq('id',cmd.event_id).eq('organization_id',org).eq('source_module','ADVANCE_WORKSPACE').single()),r=await review(c,org,event);
  if(event.status==='ACTUAL'&&cmd.action==='POST')return {eventId:event.id,status:'ACTUAL'};
  if(!r.actions.includes(cmd.action))throw Error('ADVANCE_ACTION_DENIED');
  if(cmd.action==='POST')return unwrap(await supabase.rpc('post_advance_request',{p_event_id:event.id}));
  if(cmd.action==='APPROVE')await executeFinancialEventAction({action:'APPROVE',organization_id:org,event_id:event.id,note:cmd.reason});
  if(cmd.action==='CANCEL')await executeFinancialEventAction({action:'TRANSITION',organization_id:org,event_id:event.id,status:'CANCELLED',note:cmd.reason});
  if(cmd.action==='SUBMIT'){if(event.status==='DRAFT')await executeFinancialEventAction({action:'TRANSITION',organization_id:org,event_id:event.id,status:'PLANNED',note:cmd.reason});await executeFinancialEventAction({action:'TRANSITION',organization_id:org,event_id:event.id,status:'COMMITTED',note:cmd.reason});}
  return {eventId:event.id,status:cmd.action==='CANCEL'?'CANCELLED':'COMMITTED'};
 }
 if(!permissions['financial_core.create']||!permissions['liquidity.edit']||!permissions['liquidity.settle'])throw Error('ADVANCE_ACTION_DENIED');
 if(!('date'in cmd)||cmd.date>riyadhToday())throw Error('ADVANCE_DATE_INVALID');
 const organization=unwrap(await supabase.from('organizations').select('base_currency').eq('id',org).single());
 let party:string,entity:string|null,ccy:string,rate:number,side:string,metadata:any,obligations:any[]=[],eventType:'SETTLEMENT'|'ADJUSTMENT',classificationType:string;
 if(cmd.action==='RECORD'){
  const account=unwrap(await supabase.from('liquidity_accounts').select('*').eq('organization_id',org).eq('id',cmd.account_id).eq('active',true).single());
  unwrap(await supabase.from('liquidity_counterparties').select('id').eq('organization_id',org).eq('id',cmd.counterparty_id).eq('active',true).single());
  if(cmd.entity_id)unwrap(await supabase.from('organization_entities').select('id').eq('organization_id',org).eq('id',cmd.entity_id).eq('active',true).single());
  if(account.entity_id&&account.entity_id!==cmd.entity_id)throw Error('ADVANCE_ENTITY_MISMATCH');
  party=cmd.counterparty_id;entity=cmd.entity_id;ccy=account.currency;rate=ccy===organization.base_currency?1:cmd.exchange_rate;side=cmd.side;classificationType=side==='SUPPLIER_ADVANCE'?'ASSET':'LIABILITY';eventType='SETTLEMENT';
  const amounts=advanceAmounts(cmd.amount,rate);obligations=[{obligation_key:'advance',obligation_type:side,settleable_amount:cmd.amount,currency:ccy,exchange_rate:rate,base_currency:organization.base_currency,settleable_base_amount:amounts.base}];metadata={purpose:'ADVANCE_REQUEST',kind:'RECORD',account_id:account.id,reference:cmd.reference};
 }else if(cmd.action==='APPLY'){
  const [a,o]=await Promise.all([supabase.from('financial_event_obligation_balances').select('*').eq('organization_id',org).eq('obligation_id',cmd.advance_id).single().then(unwrap),supabase.from('financial_event_obligation_balances').select('*').eq('organization_id',org).eq('obligation_id',cmd.obligation_id).single().then(unwrap)]);
  if(!compatibleAdvance(a,o))throw Error('ADVANCE_CURRENCY_OR_SIDE_MISMATCH');
  const events=unwrap(await supabase.from('financial_events').select('*').eq('organization_id',org).in('id',[a.event_id,o.event_id]));const ae=events.find((e:any)=>e.id===a.event_id),oe=events.find((e:any)=>e.id===o.event_id);
  if(!ae||!oe||ae.status!=='ACTUAL'||oe.status!=='ACTUAL'||!ae.counterparty_id||ae.counterparty_id!==oe.counterparty_id||ae.entity_id!==oe.entity_id||oe.source_module==='INVESTMENTS'||cmd.date<ae.event_date||cmd.date<oe.event_date)throw Error('ADVANCE_PARTY_OR_SOURCE_MISMATCH');
  party=ae.counterparty_id;entity=ae.entity_id;ccy=a.currency;rate=Number(a.exchange_rate);side=a.obligation_type;classificationType=o.obligation_type;eventType='ADJUSTMENT';const v=advanceAmounts(cmd.amount,rate);if(v.base>Math.min(Number(a.outstanding_base_amount),Number(o.outstanding_base_amount)))throw Error('ADVANCE_EXCEEDS_BALANCE');metadata={purpose:'ADVANCE_REQUEST',kind:'APPLY',advance_id:cmd.advance_id,obligation_id:cmd.obligation_id,flow_id:cmd.flow_id};
 }else throw Error('ADVANCE_COMMAND_INVALID');
 unwrap(await supabase.rpc('ensure_advance_classifications',{p_org:org}));
 const amounts=advanceAmounts(cmd.amount,rate),classification=unwrap(await supabase.from('financial_classifications').select('id').eq('organization_id',org).eq('classification_type',classificationType).eq('active',true).limit(1).single());
 const key='advance:'+cmd.request_id;
 const payload={organization_id:org,entity_id:entity,counterparty_id:party,event_type:eventType,source_module:'ADVANCE_WORKSPACE',source_event_key:key,event_date:cmd.date,due_date:null,base_currency:organization.base_currency,description:cmd.description,lines:[{line_number:1,cost_center_id:null,classification_id:classification.id,description:cmd.description,amount:cmd.amount,currency:ccy,exchange_rate:rate,base_amount:amounts.base,cash_direction:cmd.action==='APPLY'?'NON_CASH':side==='SUPPLIER_ADVANCE'?'OUTFLOW':'INFLOW',vat_treatment:'OUT_OF_SCOPE',vat_rate:0,vat_amount:0}],obligations,links:[{link_type:'OTHER',target_module:cmd.action==='RECORD'?'liquidity_accounts':'financial_event_obligations',target_record_id:cmd.action==='RECORD'?cmd.account_id:cmd.advance_id,metadata}]};
 const id=await executeFinancialEventAction({action:'CREATE',payload});
 const e=unwrap(await supabase.from('financial_events').select('status').eq('id',id).eq('organization_id',org).single());
 if(e.status==='DRAFT')await executeFinancialEventAction({action:'TRANSITION',organization_id:org,event_id:id,status:'PLANNED',note:cmd.description});
 if(['DRAFT','PLANNED'].includes(e.status))await executeFinancialEventAction({action:'TRANSITION',organization_id:org,event_id:id,status:'COMMITTED',note:cmd.description});
 if(e.status==='CANCELLED')throw Error('ADVANCE_REQUEST_CANCELLED');return {eventId:id,status:e.status==='ACTUAL'?'ACTUAL':'COMMITTED'};
}
