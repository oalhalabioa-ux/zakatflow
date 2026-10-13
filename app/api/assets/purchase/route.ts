import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireUser} from '@/services/auth';
import {assetFinancialReview,actOnAssetFinancialReview} from '@/services/asset-financial-review';
const headers={'Cache-Control':'no-store'};
const edit=z.object({asset_id:z.string().uuid(),expected_updated_at:z.string(),changes:z.object({purchase_value:z.number().finite().positive(),quantity:z.number().finite().positive(),fx_rate:z.number().finite().positive(),vat_input_mode:z.enum(['AMOUNT','PERCENT']),vat_rate:z.number().finite().min(0).max(100).optional(),vat_amount:z.number().finite().nonnegative(),recoverable_percent:z.number().finite().min(0).max(100),purchase_date:z.string().date(),due_date:z.string().date(),counterparty_id:z.string().uuid(),invoice_reference:z.string().trim().min(1).max(240)}).strict()}).strict();
async function context(id:string){
 z.string().uuid().parse(id);const{supabase}=await requireUser();
 const{data:asset,error}=await supabase.from('asset_accounts').select('*').eq('id',id).single();if(error)throw error;
 const{data:tx,error:te}=await supabase.from('transactions').select('id,metadata').eq('asset_account_id',id).eq('transaction_type','PURCHASE').order('created_at').limit(1).single();if(te)throw te;
 const eventId=tx.metadata?.financial_event_id;if(!eventId)throw Error('ASSET_PURCHASE_REQUIRED');
 const review=await assetFinancialReview(eventId);if(review.event.source_module!=='ASSETS_INTEGRATION'||review.event.source_record_id!==tx.id||review.event.organization_id!==asset.organization_id)throw Error('ASSET_EVENT_SCOPE_MISMATCH');
 const[{data:banks,error:be},{data:parties,error:pe},{data:links,error:le},{data:balances,error:oe},{data:canEdit,error:ce}]=await Promise.all([
  supabase.from('liquidity_accounts').select('id,name,currency').eq('organization_id',asset.organization_id).eq('active',true),
  supabase.from('liquidity_counterparties').select('id,name').eq('organization_id',asset.organization_id).in('party_type',['SUPPLIER','BOTH']).eq('active',true),
  supabase.from('financial_event_links').select('target_record_id').eq('event_id',eventId).eq('organization_id',asset.organization_id).eq('link_type','CASH_FLOW').eq('target_module','liquidity_flows'),
  supabase.from('financial_event_obligation_balances').select('*').eq('event_id',eventId).eq('organization_id',asset.organization_id),
  supabase.rpc('has_organization_permission',{p_organization_id:asset.organization_id,p_permission:'assets.edit'})]);
 if(be||pe||le||oe||ce)throw be||pe||le||oe||ce;
 const flowId=links?.[0]?.target_record_id;
 const{data:flow,error:fe}=flowId?await supabase.from('liquidity_flows').select('id,amount,base_amount,currency,settled_amount,settlement_status,due_date').eq('id',flowId).eq('organization_id',asset.organization_id).single():{data:null,error:null};if(fe)throw fe;
 const pending=['DRAFT','PLANNED','COMMITTED'].includes(review.event.status)&&!review.approved;
 return{asset,reverseBlock:review.reverseBlock,event:review.event,allowedActions:review.allowedActions,approved:review.approved,can_edit:!!canEdit&&review.permissions['financial_core.create']&&pending,can_archive:!!canEdit&&review.permissions['financial_core.create']&&pending,banks:banks??[],suppliers:parties??[],flow,balances:balances??[]};
}
const failure=(e:any)=>NextResponse.json({error:e.message},{status:e.message==='UNAUTHORIZED'?401:/DENIED/.test(e.message)?403:409,headers});
export async function GET(req:Request){try{return NextResponse.json(await context(new URL(req.url).searchParams.get('asset_id')||''),{headers});}catch(e){return failure(e);}}
export async function PATCH(req:Request){try{if(req.headers.get('origin')!==new URL(req.url).origin)throw Error('ORIGIN_REQUIRED');const p=edit.parse(await req.json());const{supabase}=await requireUser();const{error}=await supabase.rpc('amend_asset_purchase_draft',{p_asset_id:p.asset_id,p_changes:p.changes,p_expected_updated_at:p.expected_updated_at});if(error)throw error;return NextResponse.json(await context(p.asset_id),{headers});}catch(e){return failure(e);}}
export async function POST(req:Request){try{if(req.headers.get('origin')!==new URL(req.url).origin)throw Error('ORIGIN_REQUIRED');const p=z.object({asset_id:z.string().uuid(),action:z.enum(['APPROVE_AND_POST','ARCHIVE'])}).strict().parse(await req.json());const data=await context(p.asset_id);if(p.action==='ARCHIVE'){const{supabase}=await requireUser();const{data:result,error}=await supabase.rpc('archive_asset_purchase_draft',{p_asset_id:p.asset_id});if(error)throw error;return NextResponse.json(result,{headers});}await actOnAssetFinancialReview(data.event.id,'APPROVE_AND_POST');return NextResponse.json(await context(p.asset_id),{headers});}catch(e){return failure(e);}}
