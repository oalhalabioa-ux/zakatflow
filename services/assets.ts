import Decimal from 'decimal.js';
import {financialAssetProjection} from './financial-asset-projection';
import {openFinancialAccount} from './financial-account-opening';
import {financialOpeningFromAsset} from '../lib/asset-entry';
import {debtContractAction} from './debt-contracts';
import { requireUser } from './auth';
import {assetReportAssessments} from '@/lib/asset-zakat-report';
import { assetSchema } from '@/lib/validation/schemas';
import { randomUUID } from 'node:crypto';
import {assetEntryTaxSettings} from '@/lib/asset-entry-tax';
import {resolveAssetEntryFx} from './asset-entry-fx';
import {acquisitionValuation} from '@/lib/asset-entry-details';
import {assetLedgerBalance,assetLifecycleStatus,assetZakatPayments,disposedAssetHistory,soldAssetHistory} from '@/lib/asset-ledger';

function currentValuation(asset: any) {
 const metadata = asset.metadata ?? {};
 const source = metadata.market_price_source ?? null;
 const sourceMode = metadata.market_price_source_mode === 'MANUAL' ||
   source === 'MANUAL_MARKET_PRICE' || source === 'USER_MANUAL' ? 'MANUAL'
   : source === 'ALYAWMGOLD_LIVE_SA' ? 'PROVIDER'
   : source === 'ACQUISITION_COST' ? 'ACQUISITION' : 'RECORDED';
 return {
  current_market_value: Number(metadata.market_value ?? metadata.estimated_value ?? metadata.purchase_value ?? metadata.opening_value ?? 0),
  current_market_price: metadata.market_price_per_unit ?? metadata.market_price ?? null,
  current_valuation_date: metadata.market_valuation_date ?? null,
  current_valuation_source: source ?? 'ASSET_METADATA',
  current_price_source_mode: sourceMode,
  current_valuation_currency: metadata.market_price_currency ?? asset.currency,
  current_valuation_auto: metadata.market_value_auto === true,
 };
}
export async function listAssets(){
 const {supabase,user}=await requireUser();
 const [accounts,lotResult,exits,profileResult,cycleResult,assessmentResult,allocationResult,orgResult,operationResult,methodResult]=await Promise.all([
  supabase.from('asset_accounts').select('*').or('metadata->>archived.is.null,metadata->>archived.neq.true').order('created_at',{ascending:false}),
  supabase.from('lots').select('id,asset_account_id,original_quantity,remaining_quantity,remaining_value_base,hawl_start_date,hawl_due_date,acquisition_date,status,metadata'),
  supabase.from('transactions').select('id,asset_account_id,transaction_type,transaction_date,quantity,unit_price,base_value,metadata,created_at').in('transaction_type',['PURCHASE','SALE','ADJUSTMENT']).or('metadata->>asset_deleted.is.null,metadata->>asset_deleted.neq.true').order('created_at',{ascending:false}),
  supabase.from('profiles').select('base_currency,zakat_method_id').eq('id',user.id).single(),
  supabase.from('zakat_hawl_cycles').select('id,cycle_no,hawl_start_date,hawl_due_date,status,assessment_id,final_assessment_id,snapshot').eq('user_id',user.id).order('cycle_no',{ascending:false}),
  supabase.from('zakat_assessments').select('id,assessment_date,valuation_date,status,nisab_value_base,zakat_rate,calculation_snapshot,hawl_cycle_id,currency,superseded_by').eq('user_id',user.id).neq('status','CANCELLED').order('assessment_date',{ascending:false}).order('created_at',{ascending:false}),
  supabase.from('zakat_payment_allocations').select('assessment_id,assessment_line_id,lot_id,asset_account_id,allocated_amount,hawl_cycle_id').eq('user_id',user.id),
  supabase.from('organizations').select('id,base_currency'),
  supabase.from('asset_lifecycle_commands').select('asset_account_id,financial_event_id,operation,created_at').order('created_at',{ascending:false}),
  supabase.from('zakat_methods').select('id,calendar_type')
 ]);
 for(const result of [accounts,lotResult,exits,profileResult,cycleResult,assessmentResult,allocationResult,orgResult,operationResult,methodResult])if(result.error)throw result.error;
 const configuredMethod=(methodResult.data??[]).find((m:any)=>m.id===profileResult.data?.zakat_method_id);
 const periodResult=configuredMethod?await supabase.rpc('zakat_lot_hawl_periods',{p_calendar:configuredMethod.calendar_type}):{data:[],error:null};
 if(periodResult.error)throw periodResult.error;
 const currentPeriods=new Map<string,any>((periodResult.data??[]).map((p:any)=>[p.lot_id,p]));
 const headers=(exits.data??[]).filter((t:any)=>!t.metadata?.lifecycle_reversed&&!t.metadata?.sale_correction_replacement_id);
 const saleIds=headers.filter((t:any)=>t.transaction_type==='SALE').map((t:any)=>t.id);
 const exitAllocationResult=saleIds.length?await supabase.from('transaction_allocations').select('transaction_id,lot_id,quantity,value_base').in('transaction_id',saleIds):{data:[],error:null};
 if(exitAllocationResult.error)throw exitAllocationResult.error;
 const lots=lotResult.data??[],cycles=cycleResult.data??[],assessments=assessmentResult.data??[];
 const lotOwners=new Map(lots.map(l=>[l.id,l.asset_account_id]));
 const assetLines=(exitAllocationResult.data??[]).map(l=>({...l,asset_account_id:lotOwners.get(l.lot_id)}));
 const activeExits=headers.flatMap(tx=>{
  if(!tx.metadata?.lot_sale_request)return [tx];
  const portions=new Map<string,Decimal>();
  for(const line of assetLines.filter(l=>l.transaction_id===tx.id)){
   if(!line.asset_account_id)throw Error('ASSET_STATEMENT_ALLOCATION');
   portions.set(line.asset_account_id,(portions.get(line.asset_account_id)??new Decimal(0)).plus(line.quantity));
  }
  return Array.from(portions,([asset_account_id,qty])=>({...tx,asset_account_id,quantity:qty.toNumber(),base_value:qty.times(tx.unit_price).toNumber()}));
 });
 const activeCycle=cycles.find((c:any)=>['OPEN','ACTIVE'].includes(c.status));
 const displayCycle=[...cycles].reverse().find((c:any)=>c.final_assessment_id&&c.status!=='PAID')??activeCycle??cycles.find((c:any)=>c.final_assessment_id||c.assessment_id);
 const selectedId=displayCycle?.final_assessment_id??displayCycle?.assessment_id;
 const latest=selectedId?assessments.find((a:any)=>a.id===selectedId):(!activeCycle?assessments.find((a:any)=>!a.superseded_by):null);
 const baseCurrency=profileResult.data?.base_currency||'SAR';
 const exitByAsset=new Map<string,any>();
 for(const tx of activeExits)if(['SALE','ADJUSTMENT'].includes(tx.transaction_type)&&!exitByAsset.has(tx.asset_account_id))exitByAsset.set(tx.asset_account_id,tx);
 const reviewIds=[...new Set((exits.data??[]).map((t:any)=>t.metadata?.financial_event_id).filter(Boolean))];
 const eventResult=reviewIds.length?await supabase.from('financial_events').select('id,status').in('id',reviewIds):{data:[],error:null};if(eventResult.error)throw eventResult.error;
 const eventStatuses=new Map((eventResult.data??[]).map((e:any)=>[e.id,e.status]));
 const projected=await financialAssetProjection(supabase,orgResult.data??[]);
 const assets=[...(accounts.data??[]).map((a:any)=>{
  const assetLots=lots.filter((l:any)=>l.asset_account_id===a.id);
  const assetBase=a.ownership_scope==='ORGANIZATION'?(orgResult.data??[]).find((o:any)=>o.id===a.organization_id)?.base_currency??a.currency:baseCurrency;
  const availableLots=a.ownership_scope==='ORGANIZATION'?lots.filter((l:any)=>!l.metadata?.recognition_pending):lots;
  const balance=assetLedgerBalance(a,availableLots,assetBase);
  const exit=exitByAsset.get(a.id);
  const lifecycle_status=a.metadata?.investment_id?(a.metadata.investment_status==='CLOSED'?'REDEEMED':a.metadata.investment_status):assetLifecycleStatus(balance.current_quantity,exit);
  const purchase=(exits.data??[]).filter((t:any)=>t.asset_account_id===a.id&&t.transaction_type==='PURCHASE').sort((x:any,y:any)=>String(x.created_at).localeCompare(String(y.created_at)))[0];
  const reviews=[...(operationResult.data??[]).filter((o:any)=>o.asset_account_id===a.id&&o.financial_event_id).map((o:any)=>({id:o.financial_event_id})),...(exits.data??[]).filter((t:any)=>t.asset_account_id===a.id&&t.transaction_type==='PURCHASE'&&t.metadata?.financial_event_id).map((t:any)=>({id:t.metadata.financial_event_id}))];
  return {...a,financial_event_status:eventStatuses.get(purchase?.metadata?.financial_event_id)??null,pending_purchase_cost_base:assetLots.filter((l:any)=>l.metadata?.recognition_pending).reduce((v:number,l:any)=>v+Number(l.remaining_value_base||0),0),financial_review_events:reviews,acquisition_transaction_id:purchase?.metadata?.financial_event_id?purchase?.id:null,financial_event_id:purchase?.metadata?.financial_event_id??null,...currentValuation(a),...balance,has_financial_history:assetLots.length>0,lots:assetLots.filter((l:any)=>Number(l.remaining_quantity)>0).map((l:any)=>({...l,current_hawl_start_date:currentPeriods.get(l.id)?.hawl_start_date??null,current_hawl_due_date:currentPeriods.get(l.id)?.hawl_due_date??null})),lifecycle_status,
   lifecycle_exit_date:lifecycle_status==='ACTIVE'?null:exit?.transaction_date??null,
   ...disposedAssetHistory(a.id,exits.data??[]),
   ...soldAssetHistory(a.id,activeExits,assetLines),
   exit_history:activeExits.filter((t:any)=>t.asset_account_id===a.id&&(t.transaction_type==='SALE'||t.metadata?.reason==='DISPOSAL_ZERO_VALUE')).map((t:any)=>({
    id:t.id,date:t.transaction_date,kind:t.transaction_type==='SALE'?'SOLD':'DISPOSED',quantity:Number(t.quantity||0),
    cost:t.transaction_type==='SALE'?soldAssetHistory(a.id,[t],assetLines).sold_cost_value:disposedAssetHistory(a.id,[t]).disposed_cost_value,
    proceeds:t.transaction_type==='SALE'?Number(t.base_value||0):0
   })),
   lifecycle_exit_value:lifecycle_status==='SOLD'?Number(exit?.base_value||0):0};
 }),...projected];
 const referenced=assetReportAssessments(cycles,assessments);
 const ids=[...new Set([...referenced.map(r=>r.assessment.id),...(latest?[latest.id]:[])])];
 if(!ids.length)return assets.map((a:any)=>({...a,zakat_calculation:null,zakat_cycle_calculations:[]}));
 const {data:lines,error}=await supabase.from('zakat_assessment_lines').select('*,lots!inner(asset_account_id,hawl_start_date,hawl_due_date)').in('assessment_id',ids);
 if(error)throw error;
 const calculationsByAssessment=new Map<string,any[]>();
 const selections=[...referenced];
 if(latest&&!selections.some(r=>r.assessment.id===latest.id))selections.push({assessment:latest,cycle:displayCycle,closed:!!displayCycle&&['CLOSED','PAID'].includes(displayCycle.status)});
 for(const {assessment:latest,cycle,closed} of selections){
  const {currentByLot,currentByAsset,historicalByAsset}=assetZakatPayments(allocationResult.data??[],latest);
 const byAsset=new Map<string,any>();
 const common={assessment_id:latest.id,assessment_date:latest.assessment_date,valuation_date:latest.valuation_date,
  assessment_status:latest.status,cycle_number:cycle?.cycle_no??null,hawl_cycle_id:latest.hawl_cycle_id,currency:latest.currency,
  nisab_value_base:Number(latest.nisab_value_base||0),zakat_rate:Number(latest.zakat_rate||0),snapshot:latest.calculation_snapshot,cycle_closed:closed,cycle_start_date:cycle?.hawl_start_date??null,cycle_end_date:latest.assessment_date};
 for(const line of (lines??[]).filter((line:any)=>line.assessment_id===latest.id)){
  const lot:any=Array.isArray(line.lots)?line.lots[0]:line.lots;
  if(!lot?.asset_account_id)continue;
  const frozen=(line as any).valuation_snapshot??{};
  const x=byAsset.get(lot.asset_account_id)??{...common,zakat_amount:0,paid_amount:0,remaining_amount:0,market_value:0,eligible_value:0,statuses:[],lots:[]};
  const linePaid=currentByLot.get(line.lot_id)||0;
  x.zakat_amount+=Number(line.zakat_amount||0);x.paid_amount+=linePaid;
  x.market_value+=Number(line.market_value||0);x.eligible_value+=Number(line.eligible_value||0);
  x.statuses.push(line.eligibility_status);
  x.lots.push({...line,hawl_start_date:frozen.hawlStartDate??lot.hawl_start_date,
   hawl_due_date:frozen.hawlDueDate??lot.hawl_due_date,paid_amount:linePaid,
   remaining_amount:Math.max(0,Number(line.zakat_amount||0)-linePaid)});
  byAsset.set(lot.asset_account_id,x);
 }
 const calculations=assets.map((a:any)=>{
  if(a.ownership_scope==='ORGANIZATION')return null;
  const x=byAsset.get(a.id)??{...common,zakat_amount:0,paid_amount:0,market_value:0,eligible_value:0,statuses:['NOT_ASSESSED'],
   lots:a.lots.map((l:any)=>({...l,status:'NOT_ASSESSED'})),hawl_display_only:{portfolio_nisab_reached_date:activeCycle?.hawl_start_date??null}};
  x.paid_amount=currentByAsset.get(a.id)||0;
  if(cycle?.snapshot?.historical_settled)x.paid_amount=x.zakat_amount;
  x.remaining_amount=Math.max(0,x.zakat_amount-x.paid_amount);
  x.credit_amount=Math.max(0,x.paid_amount-x.zakat_amount);
  x.payment_status=x.paid_amount<=0?'UNPAID':x.remaining_amount<=0?'PAID':'PARTIALLY_PAID';
  x.historical_paid_amount=historicalByAsset.get(a.id)||0;
  return x;
 });
  calculationsByAssessment.set(latest.id,calculations);
 }
 return assets.map((a:any,index:number)=>({...a,
  zakat_calculation:latest?calculationsByAssessment.get(latest.id)?.[index]??null:null,
  zakat_cycle_calculations:referenced.map(r=>calculationsByAssessment.get(r.assessment.id)?.[index]).filter((c:any)=>c&&!c.statuses.includes('NOT_ASSESSED'))
 }));
}
async function validateAssetOwnership(supabase:any,user:any,parsed:any){
 if(parsed.asset_type_code){const{data,error}=await supabase.from('asset_types_v2').select('code,class_code,default_legacy_asset_type').eq('code',parsed.asset_type_code).eq('active',true).maybeSingle();if(error)throw error;if(!data||data.class_code!==parsed.asset_class_code||data.default_legacy_asset_type!==parsed.asset_type)throw new Error('ASSET_CLASS_TYPE_MISMATCH');}
 if(parsed.ownership_scope!=='ORGANIZATION')return;
 const {data:member,error:memberError}=await supabase.from('organization_members').select('organization_id,user_id,status').eq('organization_id',parsed.organization_id).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle();
 if(memberError)throw memberError;if(!member)throw new Error('ASSET_ORGANIZATION_ACCESS_DENIED');
 if(parsed.entity_id){const{data,error}=await supabase.from('organization_entities').select('id').eq('id',parsed.entity_id).eq('organization_id',parsed.organization_id).maybeSingle();if(error)throw error;if(!data)throw new Error('ASSET_ENTITY_SCOPE_MISMATCH');}
 if(parsed.cost_center_id){const{data,error}=await supabase.from('organization_cost_centers').select('id').eq('id',parsed.cost_center_id).eq('organization_id',parsed.organization_id).maybeSingle();if(error)throw error;if(!data)throw new Error('ASSET_COST_CENTER_SCOPE_MISMATCH');}
 if(parsed.asset_type_code){const{data,error}=await supabase.from('asset_types_v2').select('code,class_code').eq('code',parsed.asset_type_code).eq('active',true).maybeSingle();if(error)throw error;if(!data||data.class_code!==parsed.asset_class_code)throw new Error('ASSET_CLASS_TYPE_MISMATCH');}
}
export async function createAsset(input:unknown, supplierSchedule?:{
 mode:'DEFERRED'|'INSTALLMENTS';
 entries:Array<{kind:'DOWN_PAYMENT'|'INSTALLMENT';due_date:string;principal:string}>;
}){
 const parsed=assetSchema.parse(input);
 if(supplierSchedule){
  const firstDue=supplierSchedule.entries.find(entry=>entry.kind==='INSTALLMENT')?.due_date;
  if(parsed.ownership_scope!=='ORGANIZATION'||parsed.metadata.acquisition_mode!=='PURCHASE'||
   !['OTHER','REAL_ESTATE'].includes(parsed.asset_type)||!firstDue)throw Error('ASSET_SUPPLIER_SCHEDULE_ASSET_UNSUPPORTED');
  parsed.metadata={...parsed.metadata,due_date:firstDue};
 }
 const{supabase,user}=await requireUser();
 await validateAssetOwnership(supabase,user,parsed);
 const quote=await resolveAssetEntryFx(supabase,user.id,parsed.currency,String(parsed.metadata?.purchase_date||''),parsed.ownership_scope==='ORGANIZATION'?parsed.organization_id??null:null);
 parsed.metadata=acquisitionValuation({...parsed.metadata,fx_rate:quote.rate,fx_rate_id:quote.row?.id??null,fx_rate_date:quote.row?.valuation_date??parsed.metadata?.purchase_date,fx_rate_source:quote.row?.source??'BASE_CURRENCY',...(parsed.ownership_scope==='PERSONAL'&&parsed.metadata.acquisition_mode==='PURCHASE'?{fx_source_from:quote.row?.from_currency??parsed.currency,fx_source_to:quote.row?.to_currency??quote.base_currency}:{})},parsed.currency);
 if(parsed.metadata.tax_category){const tax=assetEntryTaxSettings({...parsed.metadata,ownership_scope:parsed.ownership_scope},Number(parsed.metadata.purchase_value||0));parsed.metadata={...parsed.metadata,...tax.metadata};}
 const requestId=(input as any)?.request_id||randomUUID();
 if(['CASH','BANK','RECEIVABLE'].includes(parsed.asset_type)){
  const m=parsed.metadata??{};
  if(m.acquisition_mode==='PURCHASE')throw Error('USE_FINANCIAL_OPENING');
  if(parsed.asset_type==='RECEIVABLE'&&parsed.ownership_scope==='ORGANIZATION'){
   const value=Number(m.purchase_value??0),date=String(m.purchase_date??'');
   return debtContractAction({action:'CREATE',organization_id:parsed.organization_id,request_id:requestId,kind:'OPENING',mode:'OPENING',side:'RECEIVABLE',counterparty_id:m.counterparty_id,entity_id:parsed.entity_id??null,account_id:null,category:m.debt_category,description:parsed.name,reference:String(m.invoice_reference||requestId),date,currency:parsed.currency,exchange_rate:Number(m.fx_rate),principal:value,schedule:[{amount:value,due_date:String(m.due_date||date)}]});
  }
  return openFinancialAccount(financialOpeningFromAsset(parsed,requestId));
 }

 const acquisition={p_asset:parsed,p_request_id:requestId};
 const{data,error}=supplierSchedule
  ? await supabase.rpc('create_scheduled_supplier_asset',{...acquisition,p_terms:supplierSchedule})
  : await supabase.rpc('create_asset_with_acquisition',acquisition);
 if(error)throw error;return data;
}
export async function assetEditAvailability(id: string) {
  const {supabase} = await requireUser();
  const {data, error} = await supabase.rpc('asset_edit_availability', {p_asset_id: id});
  if (error) throw error;
  return data;
}

export async function updateAsset(id: string, input: {name?: string; expected_updated_at: string; market_price?: number}) {
  const {supabase} = await requireUser();
  const {data, error} = await supabase.rpc('edit_asset_details', {
    p_asset_id: id,
    p_expected_updated_at: input.expected_updated_at,
    p_name: input.name ?? null,
    p_market_price: input.market_price ?? null,
  });
  if (error) throw error;
  return data;
}

export async function deleteAsset(id:string){
 const{supabase,user}=await requireUser();
 const{data:asset,error:ae}=await supabase.from('asset_accounts').select('id,name,ownership_scope').eq('id',id).maybeSingle();
 if(ae)throw ae;if(!asset)throw new Error('ASSET_NOT_FOUND');
 const [{count:lots,error:le},{count:tx,error:te},{count:src,error:se},{count:dst,error:de},{count:alloc,error:pe}]=await Promise.all([
  supabase.from('lots').select('id',{count:'exact',head:true}).eq('asset_account_id',id),
  supabase.from('transactions').select('id',{count:'exact',head:true}).eq('asset_account_id',id),
  supabase.from('transfers').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('source_asset_account_id',id),
  supabase.from('transfers').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('destination_asset_account_id',id),
  supabase.from('zakat_payment_allocations').select('id',{count:'exact',head:true}).eq('asset_account_id',id)
 ]);
 if(le||te||se||de||pe)throw(le||te||se||de||pe);
 const linked={lots:lots||0,transactions:tx||0,transfers:(src||0)+(dst||0),allocations:alloc||0};
 if(linked.lots||linked.transactions||linked.transfers||linked.allocations){const e:any=new Error('ASSET_PROTECTED');e.linked=linked;throw e}
 const{error}=await supabase.from('asset_accounts').delete().eq('id',id);if(error)throw error;
 await supabase.from('audit_logs').insert({user_id:user.id,entity_type:'asset_account',entity_id:id,action:'DELETE_UNUSED_ASSET',old_data:asset,new_data:{linked}});
 return{ok:true,id};
}
