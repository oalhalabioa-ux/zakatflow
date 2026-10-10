import { requireUser } from './auth';
import { assetSchema } from '@/lib/validation/schemas';
import { randomUUID } from 'node:crypto';
import {assetLedgerBalance,assetZakatPayments} from '@/lib/asset-ledger';

function openingValues(asset:any){const m=asset.metadata??{};const quantity=Number(m.quantity??(asset.asset_type==='CASH'||asset.asset_type==='BANK'?1:0));const value=Number(m.purchase_value??m.opening_value??m.market_value??m.estimated_value??0);const unitPrice=quantity>0?Number(m.purchase_price??(value/quantity)):value;const date=m.purchase_date;return{quantity,value,unitPrice,date}}
function currentValuation(asset:any){const m=asset.metadata??{};const value=Number(m.market_value??m.estimated_value??m.purchase_value??m.opening_value??0);return{current_market_value:value,current_market_price:m.market_price_per_unit??m.market_price??null,current_valuation_date:m.market_valuation_date??null,current_valuation_source:m.market_price_source??(m.market_value_auto?'MARKET_PRICE':'ASSET_METADATA'),current_valuation_currency:m.market_price_currency??asset.currency,current_valuation_auto:Boolean(m.market_value_auto)}}
async function ensureOpeningLot(supabase:any,user:any,asset:any){if(asset?.ownership_scope==='ORGANIZATION')return;if(asset?.metadata?.acquisition_mode==='PURCHASE')return;const o=openingValues(asset);if(!o.date||o.value<=0)return;const{data:existing,error:existingError}=await supabase.from('lots').select('id').eq('user_id',user.id).eq('asset_account_id',asset.id).limit(1);if(existingError)throw existingError;if(existing?.length)return;const{data:profile,error:profileError}=await supabase.from('profiles').select('base_currency').eq('id',user.id).single();if(profileError)throw profileError;const baseCurrency=profile?.base_currency||'SAR';const fx=asset.currency===baseCurrency?1:Number(asset.metadata?.fx_rate??0);if(!Number.isFinite(fx)||fx<=0)throw new Error('ASSET_OPENING_FX_RATE_REQUIRED');const baseValue=o.value*fx;const{data:tx,error:te}=await supabase.from('transactions').insert({user_id:user.id,asset_account_id:asset.id,transaction_type:'OPENING_BALANCE',transaction_date:o.date,quantity:o.quantity>0?o.quantity:1,unit_price:o.unitPrice,currency:asset.currency,gross_value:o.value,base_currency:baseCurrency,base_value:baseValue,reference:'AUTO_ASSET_OPENING',notes:'Automatically created from asset opening data',created_by:user.id,metadata:{auto_created:true,source:'ASSET_ACCOUNT'}}).select().single();if(te)throw te;const{error:le}=await supabase.from('lots').insert({user_id:user.id,asset_account_id:asset.id,source_transaction_id:tx.id,acquisition_date:o.date,hawl_start_date:o.date,hawl_due_date:null,origin_hawl_start_date:o.date,zakatable_pool_entered_date:o.date,original_quantity:o.quantity>0?o.quantity:1,remaining_quantity:o.quantity>0?o.quantity:1,original_value_base:baseValue,remaining_value_base:baseValue,status:'ACTIVE',nisab_reached_date:o.date,hawl_cycle:0,hawl_basis:'ACQUISITION_DATE',metadata:{auto_created:true,source:'ASSET_ACCOUNT',hawl_start_source:'ACQUISITION_DATE'}});if(le){await supabase.from('transactions').delete().eq('id',tx.id).eq('user_id',user.id);throw le}}
export async function listAssets(){
 const {supabase,user}=await requireUser();
 const [accounts,lotResult,exits,profileResult,cycleResult,assessmentResult,allocationResult,orgResult,operationResult]=await Promise.all([
  supabase.from('asset_accounts').select('*').order('created_at',{ascending:false}),
  supabase.from('lots').select('id,asset_account_id,original_quantity,remaining_quantity,remaining_value_base,hawl_start_date,hawl_due_date,acquisition_date,status,metadata'),
  supabase.from('transactions').select('id,asset_account_id,transaction_type,transaction_date,base_value,metadata,created_at').in('transaction_type',['PURCHASE','SALE','ADJUSTMENT']).order('created_at',{ascending:false}),
  supabase.from('profiles').select('base_currency').eq('id',user.id).single(),
  supabase.from('zakat_hawl_cycles').select('id,cycle_no,hawl_start_date,status,assessment_id,final_assessment_id').eq('user_id',user.id).order('cycle_no',{ascending:false}),
  supabase.from('zakat_assessments').select('id,assessment_date,valuation_date,status,nisab_value_base,zakat_rate,calculation_snapshot,hawl_cycle_id,currency,superseded_by').eq('user_id',user.id).neq('status','CANCELLED').order('assessment_date',{ascending:false}).order('created_at',{ascending:false}),
  supabase.from('zakat_payment_allocations').select('assessment_id,assessment_line_id,lot_id,asset_account_id,allocated_amount,hawl_cycle_id').eq('user_id',user.id),
  supabase.from('organizations').select('id,base_currency'),
  supabase.from('asset_lifecycle_commands').select('asset_account_id,financial_event_id,operation,created_at').order('created_at',{ascending:false})
 ]);
 for(const result of [accounts,lotResult,exits,profileResult,cycleResult,assessmentResult,allocationResult,orgResult,operationResult])if(result.error)throw result.error;
 const lots=lotResult.data??[],cycles=cycleResult.data??[],assessments=assessmentResult.data??[];
 const activeCycle=cycles.find((c:any)=>['OPEN','ACTIVE'].includes(c.status));
 const displayCycle=activeCycle??cycles.find((c:any)=>c.final_assessment_id||c.assessment_id);
 const selectedId=displayCycle?.final_assessment_id??displayCycle?.assessment_id;
 const latest=selectedId?assessments.find((a:any)=>a.id===selectedId):(!activeCycle?assessments.find((a:any)=>!a.superseded_by):null);
 const baseCurrency=profileResult.data?.base_currency||'SAR';
 const exitByAsset=new Map<string,any>();
 for(const tx of exits.data??[])if(['SALE','ADJUSTMENT'].includes(tx.transaction_type)&&!tx.metadata?.lifecycle_reversed&&!exitByAsset.has(tx.asset_account_id))exitByAsset.set(tx.asset_account_id,tx);
 const assets=(accounts.data??[]).map((a:any)=>{
  const assetLots=lots.filter((l:any)=>l.asset_account_id===a.id);
  const assetBase=a.ownership_scope==='ORGANIZATION'?(orgResult.data??[]).find((o:any)=>o.id===a.organization_id)?.base_currency??a.currency:baseCurrency;
  const availableLots=a.ownership_scope==='ORGANIZATION'?lots.filter((l:any)=>!l.metadata?.recognition_pending):lots;
  const balance=assetLedgerBalance(a,availableLots,assetBase);
  const exit=exitByAsset.get(a.id);
  const lifecycle_status=balance.current_quantity>0||!exit?'ACTIVE':exit.transaction_type==='SALE'?'SOLD':exit.metadata?.reason==='DISPOSAL_ZERO_VALUE'?'DISPOSED':'ACTIVE';
  const purchase=(exits.data??[]).find((t:any)=>t.asset_account_id===a.id&&t.transaction_type==='PURCHASE');
  const reviews=[...(operationResult.data??[]).filter((o:any)=>o.asset_account_id===a.id&&o.financial_event_id).map((o:any)=>({id:o.financial_event_id})),...(exits.data??[]).filter((t:any)=>t.asset_account_id===a.id&&t.transaction_type==='PURCHASE'&&t.metadata?.financial_event_id).map((t:any)=>({id:t.metadata.financial_event_id}))];
  return {...a,financial_review_events:reviews,acquisition_transaction_id:purchase?.metadata?.financial_event_id?purchase?.id:null,financial_event_id:purchase?.metadata?.financial_event_id??null,...currentValuation(a),...balance,has_financial_history:assetLots.length>0,lots:assetLots.filter((l:any)=>Number(l.remaining_quantity)>0),lifecycle_status,
   lifecycle_exit_date:lifecycle_status==='ACTIVE'?null:exit?.transaction_date??null,
   lifecycle_exit_value:lifecycle_status==='SOLD'?Number(exit?.base_value||0):0};
 });
 if(!latest)return assets.map((a:any)=>({...a,zakat_calculation:null}));
 const {data:lines,error}=await supabase.from('zakat_assessment_lines').select('*,lots!inner(asset_account_id,hawl_start_date,hawl_due_date)').eq('assessment_id',latest.id);
 if(error)throw error;
 const {currentByLot,currentByAsset,historicalByAsset}=assetZakatPayments(allocationResult.data??[],latest);
 const byAsset=new Map<string,any>();
 const common={assessment_id:latest.id,assessment_date:latest.assessment_date,valuation_date:latest.valuation_date,
  assessment_status:latest.status,cycle_number:displayCycle?.cycle_no??null,hawl_cycle_id:latest.hawl_cycle_id,currency:latest.currency,
  nisab_value_base:Number(latest.nisab_value_base||0),zakat_rate:Number(latest.zakat_rate||0),snapshot:latest.calculation_snapshot};
 for(const line of lines??[]){
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
 return assets.map((a:any)=>{
  if(a.ownership_scope==='ORGANIZATION')return{...a,zakat_calculation:null};
  const x=byAsset.get(a.id)??{...common,zakat_amount:0,paid_amount:0,market_value:0,eligible_value:0,statuses:['NOT_ASSESSED'],
   lots:a.lots.map((l:any)=>({...l,status:'NOT_ASSESSED'})),hawl_display_only:{portfolio_nisab_reached_date:activeCycle?.hawl_start_date??null}};
  x.paid_amount=currentByAsset.get(a.id)||0;
  x.remaining_amount=Math.max(0,x.zakat_amount-x.paid_amount);
  x.credit_amount=Math.max(0,x.paid_amount-x.zakat_amount);
  x.payment_status=x.paid_amount<=0?'UNPAID':x.remaining_amount<=0?'PAID':'PARTIALLY_PAID';
  x.historical_paid_amount=historicalByAsset.get(a.id)||0;
  return {...a,zakat_calculation:x};
 });
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
export async function createAsset(input:unknown){
 const parsed=assetSchema.parse(input);const{supabase,user}=await requireUser();
 await validateAssetOwnership(supabase,user,parsed);
 const requestId=(input as any)?.request_id||randomUUID();
 const{data,error}=await supabase.rpc('create_asset_with_acquisition',{p_asset:parsed,p_request_id:requestId});
 if(error)throw error;return data;
}
export async function updateAsset(id:string,input:unknown){
 const parsed=assetSchema.parse(input);const{supabase,user}=await requireUser();
 const{data:old,error:readError}=await supabase.from('asset_accounts').select('*').eq('id',id).single();if(readError)throw readError;
 const expected=(input as any)?.expected_updated_at;if(expected&&old.updated_at!==expected)throw new Error('ASSET_EDIT_CONFLICT');
 await validateAssetOwnership(supabase,user,parsed);
 const metadata={...(old.metadata??{}),...parsed.metadata};
 const{data,error}=await supabase.from('asset_accounts').update({...parsed,metadata,updated_at:new Date().toISOString()}).eq('id',id).eq('updated_at',old.updated_at).select().maybeSingle();
 if(error)throw error;if(!data)throw new Error('ASSET_EDIT_CONFLICT');
 await ensureOpeningLot(supabase,user,data);
 const{error:auditError}=await supabase.from('audit_logs').insert({user_id:user.id,entity_type:'asset_account',entity_id:id,action:'UPDATE_ASSET_DETAILS',old_data:old,new_data:data});if(auditError)throw auditError;
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
