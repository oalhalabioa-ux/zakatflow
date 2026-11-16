import {withVoucherNumbers} from './voucher-numbers';
import {requireUser} from './auth';
import {assetFinancialReview} from './asset-financial-review';
import {z} from 'zod';
export async function assetOperationWorkspace(id:string){
 z.string().uuid().parse(id);const{supabase,user}=await requireUser();
 const{data:tx,error}=await supabase.from('transactions').select('*,asset_accounts!inner(*)').eq('id',id).maybeSingle();if(error)throw error;
 const{data:cmd,error:ce}=tx?{data:null,error:null}:await supabase.from('asset_lifecycle_commands').select('*,asset_accounts!inner(*)').eq('id',id).single();if(ce)throw ce;
 if(!tx&&!cmd)throw Error('TRANSACTION_NOT_FOUND');
 const asset=tx?.asset_accounts??cmd?.asset_accounts,eventId=tx?.metadata?.financial_event_id??cmd?.financial_event_id;
 const[{data:first,error:fe},{data:canEdit,error:pe}]=await Promise.all([
  supabase.from('transactions').select('id').eq('asset_account_id',asset.id).eq('transaction_type','PURCHASE').order('created_at').limit(1).maybeSingle(),
  asset.organization_id?supabase.rpc('has_organization_permission',{p_organization_id:asset.organization_id,p_permission:'assets.edit'}):Promise.resolve({data:asset.user_id===user.id,error:null})]);if(fe||pe)throw fe||pe;
 let review=null;try{review=eventId?await assetFinancialReview(eventId):null;}catch(e:any){if(e.message!=='FINANCIAL_CORE_VIEW_DENIED')throw e;}
 const{data:lifecycle,error:le}=eventId?await supabase.from('asset_lifecycle_commands').select('*').eq('financial_event_id',eventId).maybeSingle():{data:null,error:null};if(le)throw le;
 if(review&&(review.event.organization_id!==asset.organization_id||(review.event.source_module==='ASSETS_INTEGRATION'&&review.event.source_record_id!==tx?.id)||(review.event.source_module==='ASSET_LIFECYCLE'&&(lifecycle?.asset_account_id!==asset.id||(tx&&lifecycle.transaction_id!==tx.id)))))throw Error('ASSET_EVENT_SCOPE_MISMATCH');
 const entityIds=[id,asset.id,eventId].filter(Boolean);
 const[{data:history,error:he},{data:audit,error:ae},{data:balances,error:be},{data:parties,error:pa}]=await Promise.all([
  eventId?supabase.from('financial_event_status_history').select('id,from_status,to_status,note,actor_id,created_at:changed_at').eq('event_id',eventId).order('changed_at',{ascending:false}).limit(50):Promise.resolve({data:[],error:null}),
  supabase.from('audit_logs').select('id,action,created_at,user_id').in('entity_id',entityIds).order('created_at',{ascending:false}).limit(50),
  eventId?supabase.from('financial_event_obligation_balances').select('*').eq('event_id',eventId):Promise.resolve({data:[],error:null}),
  asset.organization_id?supabase.from('liquidity_counterparties').select('id,name,party_type').eq('organization_id',asset.organization_id).eq('active',true):Promise.resolve({data:[],error:null})]);for(const e of[he,ae,be,pa])if(e)throw e;
 const{data:flowLinks,error:fl}=eventId?await supabase.from('financial_event_links').select('target_record_id').eq('event_id',eventId).eq('link_type','CASH_FLOW').eq('target_module','liquidity_flows'):{data:[],error:null};if(fl)throw fl;
 const[{data:flow,error:ff},{data:banks,error:ba},{data:entity,error:en},{data:center,error:co}]=await Promise.all([
  flowLinks?.[0]?.target_record_id?supabase.from('liquidity_flows').select('id,direction,currency,amount,base_amount,settled_amount,settlement_status').eq('id',flowLinks[0].target_record_id).eq('organization_id',asset.organization_id).single():Promise.resolve({data:null,error:null}),
  asset.organization_id?supabase.from('liquidity_accounts').select('id,name,currency').eq('organization_id',asset.organization_id).eq('active',true):Promise.resolve({data:[],error:null}),
  asset.entity_id?supabase.from('organization_entities').select('name').eq('id',asset.entity_id).maybeSingle():Promise.resolve({data:null,error:null}),
  asset.cost_center_id?supabase.from('organization_cost_centers').select('name').eq('id',asset.cost_center_id).maybeSingle():Promise.resolve({data:null,error:null})]);for(const e of[ff,ba,en,co])if(e)throw e;
 const guard=tx?await supabase.rpc('asset_transaction_delete_eligibility',{p_ids:[tx.id]}):{data:[],error:null};if(guard.error)throw guard.error;
 const record=tx??{id:cmd.id,is_lifecycle_draft:true,asset_account_id:asset.id,organization_id:asset.organization_id,transaction_type:cmd.operation==='SALE'?'SALE':'ADJUSTMENT',transaction_date:cmd.operation_date,quantity:cmd.quantity,gross_value:cmd.amount,base_value:cmd.amount,currency:review?.event.base_currency,base_currency:review?.event.base_currency,metadata:{operation:cmd.operation,vat_amount:cmd.vat_amount,asset_effect_base:-Number(cmd.book_effect),financial_event_id:eventId},asset_accounts:asset};
 const enriched={...record,entity_name:entity?.name??null,cost_center_name:center?.name??null,operation_type:lifecycle?.operation??record.metadata?.operation??record.transaction_type,source_label:review?.event.source_module==='ASSET_LIFECYCLE'?'عمليات الأصل':review?.event.source_module==='ASSETS_INTEGRATION'?'الأصول':'سجل العمليات',counterparty_name:(parties??[]).find((p:any)=>p.id===(review?.event.counterparty_id??record.metadata?.counterparty_id))?.name??null,due_date:review?.event.due_date??record.metadata?.due_date??null};
 return withVoucherNumbers(supabase,{flow,banks:banks??[],can_reverse_personal:!!tx&&tx.user_id===user.id&&!tx.organization_id&&!tx.reversal_of_transaction_id&&!tx.is_reversed&&!tx.metadata?.asset_deleted&&['ADD','OPENING_BALANCE'].includes(tx.transaction_type)&&tx.metadata?.source!=='ATOMIC_ASSET_ACQUISITION',record:enriched,asset,review,is_primary_purchase:tx?.transaction_type==='PURCHASE'&&first?.id===tx?.id&&review?.event.source_module==='ASSETS_INTEGRATION',can_edit_notes:!!canEdit&&tx?.user_id===user.id,can_replace_draft:!!canEdit&&review?.permissions['financial_core.create']&&!!lifecycle&&['DRAFT','PLANNED','COMMITTED'].includes(review.event.status)&&!review.approved,can_delete_unlinked:guard.data?.[0]?.can_delete??false,delete_block_reason:guard.data?.[0]?.delete_block_reason??null,lifecycle,history:history??[],audit:audit??[],balances:balances??[],counterparties:parties??[],currentUserId:user.id});
}
