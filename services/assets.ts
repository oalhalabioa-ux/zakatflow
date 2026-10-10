import { requireUser } from './auth';
import { assetSchema } from '@/lib/validation/schemas';
import { createTransaction } from './transactions';
import {assetLedgerBalance,assetZakatPayments} from '@/lib/asset-ledger';

function openingValues(asset:any){const m=asset.metadata??{};const quantity=Number(m.quantity??(asset.asset_type==='CASH'||asset.asset_type==='BANK'?1:0));const value=Number(m.purchase_value??m.opening_value??m.market_value??m.estimated_value??0);const unitPrice=quantity>0?Number(m.purchase_price??(value/quantity)):value;const date=m.purchase_date;return{quantity,value,unitPrice,date}}
function currentValuation(asset:any){const m=asset.metadata??{};const value=Number(m.market_value??m.estimated_value??m.purchase_value??m.opening_value??0);return{current_market_value:value,current_market_price:m.market_price_per_unit??m.market_price??null,current_valuation_date:m.market_valuation_date??null,current_valuation_source:m.market_price_source??(m.market_value_auto?'MARKET_PRICE':'ASSET_METADATA'),current_valuation_currency:m.market_price_currency??asset.currency,current_valuation_auto:Boolean(m.market_value_auto)}}
async function ensureOpeningLot(supabase:any,user:any,asset:any){if(asset?.ownership_scope==='ORGANIZATION')return;if(asset?.metadata?.acquisition_mode==='PURCHASE')return;const o=openingValues(asset);if(!o.date||o.value<=0)return;const{data:existing,error:existingError}=await supabase.from('lots').select('id').eq('user_id',user.id).eq('asset_account_id',asset.id).limit(1);if(existingError)throw existingError;if(existing?.length)return;const{data:profile,error:profileError}=await supabase.from('profiles').select('base_currency').eq('id',user.id).single();if(profileError)throw profileError;const baseCurrency=profile?.base_currency||'SAR';const fx=asset.currency===baseCurrency?1:Number(asset.metadata?.fx_rate??0);if(!Number.isFinite(fx)||fx<=0)throw new Error('ASSET_OPENING_FX_RATE_REQUIRED');const baseValue=o.value*fx;const{data:tx,error:te}=await supabase.from('transactions').insert({user_id:user.id,asset_account_id:asset.id,transaction_type:'OPENING_BALANCE',transaction_date:o.date,quantity:o.quantity>0?o.quantity:1,unit_price:o.unitPrice,currency:asset.currency,gross_value:o.value,base_currency:baseCurrency,base_value:baseValue,reference:'AUTO_ASSET_OPENING',notes:'Automatically created from asset opening data',created_by:user.id,metadata:{auto_created:true,source:'ASSET_ACCOUNT'}}).select().single();if(te)throw te;const{error:le}=await supabase.from('lots').insert({user_id:user.id,asset_account_id:asset.id,source_transaction_id:tx.id,acquisition_date:o.date,hawl_start_date:o.date,hawl_due_date:null,origin_hawl_start_date:o.date,zakatable_pool_entered_date:o.date,original_quantity:o.quantity>0?o.quantity:1,remaining_quantity:o.quantity>0?o.quantity:1,original_value_base:baseValue,remaining_value_base:baseValue,status:'ACTIVE',nisab_reached_date:o.date,hawl_cycle:0,hawl_basis:'ACQUISITION_DATE',metadata:{auto_created:true,source:'ASSET_ACCOUNT',hawl_start_source:'ACQUISITION_DATE'}});if(le){await supabase.from('transactions').delete().eq('id',tx.id).eq('user_id',user.id);throw le}}
export async function listAssets(){
 const {supabase,user}=await requireUser();
 const [accounts,lotResult,exits,profileResult,cycleResult,assessmentResult,allocationResult]=await Promise.all([
  supabase.from('asset_accounts').select('*').order('created_at',{ascending:false}),
  supabase.from('lots').select('id,asset_account_id,original_quantity,remaining_quantity,remaining_value_base,hawl_start_date,hawl_due_date,acquisition_date,status').eq('user_id',user.id),
  supabase.from('transactions').select('asset_account_id,transaction_type,transaction_date,base_value,metadata,created_at').eq('user_id',user.id).in('transaction_type',['SALE','ADJUSTMENT']).order('created_at',{ascending:false}),
  supabase.from('profiles').select('base_currency').eq('id',user.id).single(),
  supabase.from('zakat_hawl_cycles').select('id,cycle_no,hawl_start_date,status,assessment_id,final_assessment_id').eq('user_id',user.id).order('cycle_no',{ascending:false}),
  supabase.from('zakat_assessments').select('id,assessment_date,valuation_date,status,nisab_value_base,zakat_rate,calculation_snapshot,hawl_cycle_id,currency,superseded_by').eq('user_id',user.id).neq('status','CANCELLED').order('assessment_date',{ascending:false}).order('created_at',{ascending:false}),
  supabase.from('zakat_payment_allocations').select('assessment_id,assessment_line_id,lot_id,asset_account_id,allocated_amount,hawl_cycle_id').eq('user_id',user.id)
 ]);
 for(const result of [accounts,lotResult,exits,profileResult,cycleResult,assessmentResult,allocationResult])if(result.error)throw result.error;
 const lots=lotResult.data??[],cycles=cycleResult.data??[],assessments=assessmentResult.data??[];
 const activeCycle=cycles.find((c:any)=>['OPEN','ACTIVE'].includes(c.status));
 const displayCycle=activeCycle??cycles.find((c:any)=>c.final_assessment_id||c.assessment_id);
 const selectedId=displayCycle?.final_assessment_id??displayCycle?.assessment_id;
 const latest=selectedId?assessments.find((a:any)=>a.id===selectedId):(!activeCycle?assessments.find((a:any)=>!a.superseded_by):null);
 const baseCurrency=profileResult.data?.base_currency||'SAR';
 const exitByAsset=new Map<string,any>();
 for(const tx of exits.data??[])if(!exitByAsset.has(tx.asset_account_id))exitByAsset.set(tx.asset_account_id,tx);
 const assets=(accounts.data??[]).map((a:any)=>{
  const assetLots=lots.filter((l:any)=>l.asset_account_id===a.id);
  const balance=assetLedgerBalance(a,lots,baseCurrency);
  const exit=exitByAsset.get(a.id);
  const lifecycle_status=balance.current_quantity>0||!exit?'ACTIVE':exit.transaction_type==='SALE'?'SOLD':exit.metadata?.reason==='DISPOSAL_ZERO_VALUE'?'DISPOSED':'ACTIVE';
  return {...a,...currentValuation(a),...balance,lots:assetLots.filter((l:any)=>Number(l.remaining_quantity)>0),lifecycle_status,
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
 if(parsed.ownership_scope!=='ORGANIZATION')return;
 const {data:member,error:memberError}=await supabase.from('organization_members').select('organization_id,user_id,status').eq('organization_id',parsed.organization_id).eq('user_id',user.id).eq('status','ACTIVE').maybeSingle();
 if(memberError)throw memberError;if(!member)throw new Error('ASSET_ORGANIZATION_ACCESS_DENIED');
 if(parsed.entity_id){const{data,error}=await supabase.from('organization_entities').select('id').eq('id',parsed.entity_id).eq('organization_id',parsed.organization_id).maybeSingle();if(error)throw error;if(!data)throw new Error('ASSET_ENTITY_SCOPE_MISMATCH');}
 if(parsed.cost_center_id){const{data,error}=await supabase.from('organization_cost_centers').select('id').eq('id',parsed.cost_center_id).eq('organization_id',parsed.organization_id).maybeSingle();if(error)throw error;if(!data)throw new Error('ASSET_COST_CENTER_SCOPE_MISMATCH');}
 if(parsed.asset_type_code){const{data,error}=await supabase.from('asset_types_v2').select('code,class_code').eq('code',parsed.asset_type_code).eq('active',true).maybeSingle();if(error)throw error;if(!data||data.class_code!==parsed.asset_class_code)throw new Error('ASSET_CLASS_TYPE_MISMATCH');}
}
export async function createAsset(input:unknown){const parsed=assetSchema.parse(input);const{supabase,user}=await requireUser();await validateAssetOwnership(supabase,user,parsed);const acquisitionMode=parsed.metadata?.acquisition_mode==='PURCHASE'?'PURCHASE':'OPENING_BALANCE';const fundingAccountId=parsed.metadata?.funding_account_id??null;if(parsed.ownership_scope==='PERSONAL'&&acquisitionMode==='PURCHASE'&&!fundingAccountId)throw new Error('PERSONAL_PURCHASE_FUNDING_ACCOUNT_REQUIRED');if(parsed.ownership_scope==='PERSONAL'&&acquisitionMode==='PURCHASE'){const{data:funding,error:fundingError}=await supabase.from('asset_accounts').select('id,asset_type,ownership_scope,currency').eq('id',fundingAccountId).eq('user_id',user.id).maybeSingle();if(fundingError)throw fundingError;if(!funding||funding.ownership_scope!=='PERSONAL'||!['CASH','BANK'].includes(funding.asset_type))throw new Error('PERSONAL_PURCHASE_FUNDING_ACCOUNT_INVALID');if(funding.currency!==parsed.currency)throw new Error('PERSONAL_PURCHASE_CURRENCY_MISMATCH');if(funding.id===parsed.metadata?.asset_account_id)throw new Error('PERSONAL_PURCHASE_FUNDING_ACCOUNT_INVALID');}
 const{data,error}=await supabase.from('asset_accounts').insert({...parsed,user_id:user.id}).select().single();if(error)throw error;
 if(parsed.ownership_scope==='PERSONAL'&&acquisitionMode==='PURCHASE'){const o=openingValues(data);if(!o.date||o.value<=0){await supabase.from('asset_accounts').delete().eq('id',data.id).eq('user_id',user.id);throw new Error('PERSONAL_PURCHASE_VALUE_AND_DATE_REQUIRED');}const{data:profile,error:profileError}=await supabase.from('profiles').select('base_currency').eq('id',user.id).single();if(profileError){await supabase.from('asset_accounts').delete().eq('id',data.id).eq('user_id',user.id);throw profileError;}const baseCurrency=profile?.base_currency||'SAR';if(data.currency!==baseCurrency){await supabase.from('asset_accounts').delete().eq('id',data.id).eq('user_id',user.id);throw new Error('PERSONAL_PURCHASE_FX_RATE_REQUIRED');}const quantity=o.quantity>0?o.quantity:1;const{data:purchase,error:purchaseError}=await supabase.from('transactions').insert({user_id:user.id,asset_account_id:data.id,transaction_type:'PURCHASE',transaction_date:o.date,quantity,unit_price:o.unitPrice,currency:data.currency,gross_value:o.value,base_currency:baseCurrency,base_value:o.value,reference:'AUTO_ASSET_PURCHASE',notes:'Created with personal asset purchase',created_by:user.id,metadata:{auto_created:true,source:'ASSET_ACCOUNT',acquisition_mode:'PURCHASE',funding_account_id:fundingAccountId}}).select().single();if(purchaseError){await supabase.from('asset_accounts').delete().eq('id',data.id).eq('user_id',user.id);throw purchaseError;}const{error:lotError}=await supabase.from('lots').insert({user_id:user.id,asset_account_id:data.id,source_transaction_id:purchase.id,acquisition_date:o.date,original_quantity:quantity,remaining_quantity:quantity,original_value_base:o.value,remaining_value_base:o.value,status:'ACTIVE',metadata:{source:'asset_purchase'}});if(lotError){await supabase.from('transactions').delete().eq('id',purchase.id).eq('user_id',user.id);await supabase.from('asset_accounts').delete().eq('id',data.id).eq('user_id',user.id);throw lotError;}const{data:fundingLots,error:fundingLotsError}=await supabase.from('lots').select('remaining_quantity,remaining_value_base').eq('user_id',user.id).eq('asset_account_id',fundingAccountId).gt('remaining_quantity',0);if(fundingLotsError){await supabase.from('lots').delete().eq('source_transaction_id',purchase.id).eq('user_id',user.id);await supabase.from('transactions').delete().eq('id',purchase.id).eq('user_id',user.id);await supabase.from('asset_accounts').delete().eq('id',data.id).eq('user_id',user.id);throw fundingLotsError;}const fundingQuantity=(fundingLots??[]).reduce((sum:number,lot:any)=>sum+Number(lot.remaining_quantity||0),0);const fundingValue=(fundingLots??[]).reduce((sum:number,lot:any)=>sum+Number(lot.remaining_value_base||0),0);if(fundingValue<o.value||fundingQuantity<=0){await supabase.from('lots').delete().eq('source_transaction_id',purchase.id).eq('user_id',user.id);await supabase.from('transactions').delete().eq('id',purchase.id).eq('user_id',user.id);await supabase.from('asset_accounts').delete().eq('id',data.id).eq('user_id',user.id);throw new Error('PERSONAL_PURCHASE_INSUFFICIENT_FUNDS');}const withdrawalQuantity=Number((fundingQuantity*(o.value/fundingValue)).toFixed(12));const{data:withdrawal,error:withdrawalError}=await supabase.rpc('post_withdrawal',{p_user_id:user.id,p_asset_account_id:fundingAccountId,p_date:o.date,p_quantity:withdrawalQuantity,p_value:o.value,p_currency:data.currency,p_base_currency:baseCurrency,p_base_value:o.value,p_notes:`Purchase of ${data.name}`,p_allocation_method:'FIFO',p_transaction_type:'WITHDRAWAL'});if(withdrawalError){await supabase.from('lots').delete().eq('source_transaction_id',purchase.id).eq('user_id',user.id);await supabase.from('transactions').delete().eq('id',purchase.id).eq('user_id',user.id);await supabase.from('asset_accounts').delete().eq('id',data.id).eq('user_id',user.id);throw withdrawalError;}await supabase.from('audit_logs').insert({user_id:user.id,entity_type:'asset_account',entity_id:data.id,action:'CREATE_WITH_PERSONAL_PURCHASE',new_data:{purchase_transaction_id:purchase.id,funding_account_id:fundingAccountId,withdrawal_transaction_id:withdrawal,value:o.value}});return data;}
 if(parsed.ownership_scope==='ORGANIZATION'&&acquisitionMode==='PURCHASE'){const o=openingValues(data);if(!o.date||o.value<=0){await supabase.from('asset_accounts').delete().eq('id',data.id).eq('user_id',user.id);throw new Error('ORGANIZATION_PURCHASE_VALUE_AND_DATE_REQUIRED');}try{await createTransaction({asset_account_id:data.id,transaction_type:'PURCHASE',transaction_date:o.date,quantity:o.quantity>0?o.quantity:1,unit_price:o.unitPrice,currency:data.currency,gross_value:o.value,base_currency:data.currency,base_value:o.value,notes:`Purchase of ${data.name}`});}catch(purchaseError){await supabase.from('asset_accounts').delete().eq('id',data.id).eq('user_id',user.id);throw purchaseError;}await supabase.from('audit_logs').insert({user_id:user.id,entity_type:'asset_account',entity_id:data.id,action:'CREATE_WITH_ORGANIZATION_PURCHASE',new_data:{acquisition_mode:'PURCHASE'}});return data;}
 await ensureOpeningLot(supabase,user,data);return data}
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
  supabase.from('lots').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('asset_account_id',id),
  supabase.from('transactions').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('asset_account_id',id),
  supabase.from('transfers').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('source_asset_account_id',id),
  supabase.from('transfers').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('destination_asset_account_id',id),
  supabase.from('zakat_payment_allocations').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('asset_account_id',id)
 ]);
 if(le||te||se||de||pe)throw(le||te||se||de||pe);
 const linked={lots:lots||0,transactions:tx||0,transfers:(src||0)+(dst||0),allocations:alloc||0};
 if(linked.lots||linked.transactions||linked.transfers||linked.allocations){const e:any=new Error('ASSET_PROTECTED');e.linked=linked;throw e}
 const{error}=await supabase.from('asset_accounts').delete().eq('id',id);if(error)throw error;
 await supabase.from('audit_logs').insert({user_id:user.id,entity_type:'asset_account',entity_id:id,action:'DELETE_UNUSED_ASSET',old_data:asset,new_data:{linked}});
 return{ok:true,id};
}
