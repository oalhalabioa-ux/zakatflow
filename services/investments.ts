import {withVoucherNumbers} from './voucher-numbers';
import {z} from 'zod';
import Decimal from 'decimal.js';
import {personalInstallmentBalances} from '../lib/personal-contracts';
import {requireUser} from './auth';
import {investmentTermsSchema,investmentOperationSchema,investmentProjection} from '@/lib/investments';
async function personalRows(q:()=>any){const rows:any[]=[];for(let i=0;i<20000;i+=500){const r=await q().order('id').range(i,i+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)return rows;}throw Error('REPORT_TOO_LARGE');}
export async function investmentWorkspace(){
 const {supabase,user}=await requireUser();
 const results=await Promise.all([
  supabase.from('investment_contracts').select('*').order('created_at',{ascending:false}),
  supabase.from('investment_operations').select('*').order('created_at',{ascending:false}),
  supabase.from('liquidity_accounts').select('id,name,organization_id,currency,active,current_balance').eq('active',true).in('account_type',['BANK','CASH','WALLET']),
  supabase.from('asset_accounts').select('id,name,currency,ownership_scope,organization_id').eq('user_id',user.id).eq('ownership_scope','PERSONAL').in('asset_type',['BANK','CASH']),
  supabase.from('profiles').select('base_currency').eq('id',user.id).single()
 ]);
 for(const r of results)if(r.error)throw r.error;
 const personalContracts=await personalRows(()=>supabase.from('personal_contracts').select('id,status,terms,principal,currency,asset_id').eq('user_id',user.id).eq('product','PARTICIPATION').eq('side','RECEIVABLE'));
 const carrying=new Map<string,number>();
 const personalAssetIds=personalContracts.map(c=>c.asset_id).filter(Boolean);
 for(let i=0;i<personalAssetIds.length;i+=100){const lots=await personalRows(()=>supabase.from('lots').select('id,asset_account_id,remaining_value_base').eq('user_id',user.id).in('asset_account_id',personalAssetIds.slice(i,i+100)));for(const l of lots)carrying.set(l.asset_account_id,new Decimal(carrying.get(l.asset_account_id)??0).plus(l.remaining_value_base).toNumber());}
 const personalParticipations=personalContracts.map(c=>({...c,outstanding:c.status==='POSTED'?carrying.get(c.asset_id)??0:0,schedule:personalInstallmentBalances(c.terms.schedule,Number(c.principal),c.status==='POSTED'?carrying.get(c.asset_id)??0:0)}));
 const operations=results[1].data??[],ids=[...new Set(operations.flatMap(o=>[o.recognition_event_id,o.settlement_event_id]).filter(Boolean))];
 const events=ids.length?await supabase.from('financial_events').select('id,status').in('id',ids):{data:[],error:null};
 if(events.error)throw events.error;const statuses=new Map((events.data??[]).map(e=>[e.id,e.status]));
 return withVoucherNumbers(supabase,{personalParticipations,contracts:(results[0].data??[]).map(c=>({...c,projection:investmentProjection(investmentTermsSchema.parse(c.terms))})),
 operations:operations.map(o=>({...o,recognition_status:statuses.get(o.recognition_event_id),settlement_status:statuses.get(o.settlement_event_id)})),
 organizationAccounts:results[2].data??[],personalAccounts:results[3].data??[],baseCurrency:results[4].data?.base_currency??'SAR'});
}
export async function investmentAction(input:unknown){
 const a=z.object({action:z.enum(['SAVE','REPLACE','CANCEL','PREPARE','APPROVE','POST','RECOGNIZE','CANCEL_OPERATION']),id:z.string().uuid().optional(),request_id:z.string().uuid().optional(),payload:z.unknown().optional()}).strict().parse(input);
 let payload:unknown=a.payload??{};
 if(a.action==='SAVE'||a.action==='REPLACE'){
  if(!a.request_id||a.action==='REPLACE'&&!a.id)throw new Error('INVESTMENT_REQUEST_REQUIRED');
  payload=investmentTermsSchema.parse(payload);
 }else if(a.action==='PREPARE'){
  const p=investmentOperationSchema.parse(payload);
  if(p.contract_id!==a.id||p.request_id!==a.request_id)throw new Error('INVESTMENT_REQUEST_CONFLICT');payload=p;
 }else if(!a.id)throw new Error('INVESTMENT_ID_REQUIRED');
 const {supabase}=await requireUser();const {data,error}=await supabase.rpc('investment_command',{p_action:a.action,p_id:a.id??null,p_payload:payload,p_request_id:a.request_id??null});
 if(error)throw error;return data;
}
