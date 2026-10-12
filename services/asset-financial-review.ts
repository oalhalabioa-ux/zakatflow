import {requireUser} from './auth';
import {allowedEventActions,type EventPermissions} from '../lib/financial-event-command';
import {executeFinancialEventAction} from './financial-events';
import {z} from 'zod';
const scopes=['financial_core.view','financial_core.create','financial_core.approve','financial_core.post','liquidity.edit','liquidity.settle','vat.view','organization.edit'] as const;
export async function assetFinancialReview(eventId:string){
 z.string().uuid().parse(eventId);const{supabase,user}=await requireUser();
 const{data:event,error}=await supabase.from('financial_events').select('*').eq('id',eventId).single();if(error)throw error;
 if(!['ASSETS_INTEGRATION','ASSET_LIFECYCLE'].includes(event.source_module))throw Error('ASSET_EVENT_REQUIRED');
 const table=event.source_module==='ASSET_LIFECYCLE'?'asset_lifecycle_commands':'transactions';
 const{data:source,error:se}=await supabase.from(table).select('asset_account_id').eq('id',event.source_record_id).single();if(se)throw se;
 const{data:asset,error:ae}=await supabase.from('asset_accounts').select('id,organization_id').eq('id',source.asset_account_id).eq('organization_id',event.organization_id).single();if(ae||!asset)throw ae||Error('ASSET_EVENT_SCOPE_MISMATCH');
 const values=await Promise.all(scopes.map(async p=>{const r=await supabase.rpc('effective_organization_permission',{p_org:event.organization_id,p_permission:p,p_amount:null,p_currency:null});if(r.error)throw r.error;return[p,r.data];}));const permissions=Object.fromEntries(values) as EventPermissions;
 if(!permissions['financial_core.view'])throw Error('FINANCIAL_CORE_VIEW_DENIED');
 const[{data:approved,error:ap},{data:canSelf,error:cs}]=await Promise.all([supabase.rpc('financial_event_has_valid_approval',{p_event_id:event.id}),supabase.rpc('can_self_approve_financial_event',{p_org:event.organization_id})]);if(ap||cs)throw ap||cs;
 const allowedActions=allowedEventActions(event,user.id,permissions,!!approved,!!canSelf);
 if(['DRAFT','PLANNED','COMMITTED'].includes(event.status)&&(event.status==='COMMITTED'||permissions['financial_core.create'])&&permissions['financial_core.post']&&(approved||(permissions['financial_core.approve']&&(event.created_by!==user.id||canSelf))))allowedActions.push('APPROVE_AND_POST');
 return{event,approved:!!approved,permissions,allowedActions};
}
export async function actOnAssetFinancialReview(eventId:string,action:string){
 let review=await assetFinancialReview(eventId);
 if(action==='APPROVE_AND_POST'&&review.event.status==='ACTUAL')return review;
 if(!review.allowedActions.includes(action))throw Error('ASSET_EVENT_ACTION_DENIED');
 const transition=(status:string)=>executeFinancialEventAction({action:'TRANSITION',organization_id:review.event.organization_id,event_id:eventId,status,note:'Asset financial workflow'});
 if(action==='APPROVE_AND_POST'){
  if(review.event.status==='DRAFT')await transition('PLANNED');
  review=await assetFinancialReview(eventId);if(review.event.status==='PLANNED')await transition('COMMITTED');
  review=await assetFinancialReview(eventId);if(!review.approved)await executeFinancialEventAction({action:'APPROVE',organization_id:review.event.organization_id,event_id:eventId,note:'Asset financial approval'});
  review=await assetFinancialReview(eventId);if(review.event.status==='COMMITTED')await transition('ACTUAL');
  return assetFinancialReview(eventId);
 }
 return action==='APPROVE'?executeFinancialEventAction({action:'APPROVE',organization_id:review.event.organization_id,event_id:eventId,note:'Asset financial approval'}):transition(action);
}
