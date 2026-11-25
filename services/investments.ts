import {withVoucherNumbers} from './voucher-numbers';
import {z} from 'zod';
import Decimal from 'decimal.js';
import {personalInstallmentBalances} from '../lib/personal-contracts';
import {requireUser} from './auth';
import {requireOrganizationMember} from './organization-access';
import {organizationScopeIds} from '../lib/workspace-organization';
import {investmentTermsSchema,investmentOperationSchema,investmentProjection} from '../lib/investments';
async function personalRows(q:()=>any){const rows:any[]=[];for(let i=0;i<20000;i+=500){const r=await q().order('id').range(i,i+499);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<500)return rows;}throw Error('REPORT_TOO_LARGE');}
const workspaceSchema=z.object({
 scope:z.enum(['PERSONAL','ORGANIZATION']),
 organization_id:z.string().uuid().nullable().default(null),
 group:z.boolean().default(false),
}).strict().superRefine((p,c)=>{
 if(p.scope==='ORGANIZATION'&&!p.organization_id||p.scope==='PERSONAL'&&(p.organization_id||p.group))c.addIssue({code:'custom',message:'INVESTMENT_SCOPE_INVALID'});
});
async function authorizedInvestmentOrganizations(supabase:any,userId:string,scope:z.infer<typeof workspaceSchema>){
 let organizationIds:string[]=[];
 if(scope.scope==='ORGANIZATION'){
  await requireOrganizationMember(supabase,userId,scope.organization_id!);
  organizationIds=[scope.organization_id!];
  if(scope.group){
   const {data,error}=await supabase.from('organizations').select('id,name,parent_organization_id,organization_kind');
   if(error)throw error;
   organizationIds=[...organizationScopeIds(data??[],scope.organization_id!,true)];
   for(const id of organizationIds)if(id!==scope.organization_id)await requireOrganizationMember(supabase,userId,id);
  }
 }
 return organizationIds;
}
export async function investmentWorkspace(input:unknown){
 const scope=workspaceSchema.parse(input),{supabase,user}=await requireUser();
 const organizationIds=await authorizedInvestmentOrganizations(supabase,user.id,scope);
 // RLS remains the authority. Explicit predicates prevent another authorized
 // workspace from entering this response or failing its term calculations.
 const scoped=(q:any)=>scope.scope==='PERSONAL'?q.eq('user_id',user.id).is('organization_id',null):q.in('organization_id',organizationIds);
 const results=await Promise.all([
  scoped(supabase.from('investment_contracts').select('*')).order('created_at',{ascending:false}),
  scoped(supabase.from('investment_operations').select('*')).order('created_at',{ascending:false}),
  scope.scope==='ORGANIZATION'?supabase.from('liquidity_accounts').select('id,name,organization_id,currency,active,current_balance').in('organization_id',organizationIds).eq('active',true).in('account_type',['BANK','CASH','WALLET']):Promise.resolve({data:[],error:null}),
  scope.scope==='PERSONAL'?supabase.from('asset_accounts').select('id,name,currency,ownership_scope,organization_id').eq('user_id',user.id).eq('ownership_scope','PERSONAL').is('organization_id',null).eq('status','ACTIVE').in('asset_type',['BANK','CASH']):Promise.resolve({data:[],error:null}),
  scope.scope==='PERSONAL'?supabase.from('profiles').select('base_currency').eq('id',user.id).single():supabase.from('organizations').select('base_currency').eq('id',scope.organization_id!).single()
 ]);
 for(const r of results)if(r.error)throw r.error;
 const personalContracts=scope.scope==='PERSONAL'?await personalRows(()=>supabase.from('personal_contracts').select('id,status,terms,principal,currency,asset_id').eq('user_id',user.id).eq('product','PARTICIPATION').eq('side','RECEIVABLE')):[];
 const carrying=new Map<string,number>();
 const personalAssetIds=personalContracts.map(c=>c.asset_id).filter(Boolean);
 for(let i=0;i<personalAssetIds.length;i+=100){const lots=await personalRows(()=>supabase.from('lots').select('id,asset_account_id,remaining_value_base').eq('user_id',user.id).in('asset_account_id',personalAssetIds.slice(i,i+100)));for(const l of lots)carrying.set(l.asset_account_id,new Decimal(carrying.get(l.asset_account_id)??0).plus(l.remaining_value_base).toNumber());}
 const personalParticipations=personalContracts.map(c=>({...c,outstanding:c.status==='POSTED'?carrying.get(c.asset_id)??0:0,schedule:personalInstallmentBalances(c.terms.schedule,Number(c.principal),c.status==='POSTED'?carrying.get(c.asset_id)??0:0)}));
 const contracts=(results[0].data??[]).map((c:any)=>{
  const terms=investmentTermsSchema.parse(c.terms);
  if(terms.ownership_scope!==scope.scope||(terms.organization_id??null)!==(c.organization_id??null))throw Error('INVESTMENT_SCOPE_MISMATCH');
  return {...c,projection:investmentProjection(terms)};
 });
 const contractIds=new Set(contracts.map((c:any)=>c.id));
 const operations=(results[1].data??[]).filter((o:any)=>contractIds.has(o.contract_id)),ids=[...new Set(operations.flatMap((o:any)=>[o.recognition_event_id,o.settlement_event_id]).filter(Boolean))];
 const events=ids.length?await supabase.from('financial_events').select('id,status').in('id',ids):{data:[],error:null};
 if(events.error)throw events.error;const statuses=new Map((events.data??[]).map(e=>[e.id,e.status]));
 return withVoucherNumbers(supabase,{personalParticipations,contracts,
 operations:operations.map((o:any)=>({...o,recognition_status:statuses.get(o.recognition_event_id),settlement_status:statuses.get(o.settlement_event_id)})),
 organizationAccounts:results[2].data??[],personalAccounts:results[3].data??[],baseCurrency:results[4].data?.base_currency??'SAR'});
}
export async function investmentAction(input:unknown){
 const a=z.object({action:z.enum(['SAVE','REPLACE','CANCEL','PREPARE','APPROVE','POST','RECOGNIZE','CANCEL_OPERATION']),id:z.string().uuid().optional(),request_id:z.string().uuid().optional(),payload:z.unknown().optional(),workspace:workspaceSchema}).strict().parse(input);
 let payload:unknown=a.payload??{};
 if(a.action==='SAVE'||a.action==='REPLACE'){
  if(!a.request_id||a.action==='REPLACE'&&!a.id)throw new Error('INVESTMENT_REQUEST_REQUIRED');
  payload=investmentTermsSchema.parse(payload);
 }else if(a.action==='PREPARE'){
  const p=investmentOperationSchema.parse(payload);
  if(p.contract_id!==a.id||p.request_id!==a.request_id)throw new Error('INVESTMENT_REQUEST_CONFLICT');payload=p;
 }else if(!a.id)throw new Error('INVESTMENT_ID_REQUIRED');
 const {supabase,user}=await requireUser();
 const organizations=await authorizedInvestmentOrganizations(supabase,user.id,a.workspace);
 const matches=(row:{user_id:string;organization_id:string|null})=>a.workspace.scope==='PERSONAL'?row.user_id===user.id&&!row.organization_id:organizations.includes(row.organization_id??'');
 let target:any=null;
 if(a.id){
  const table=['APPROVE','POST','RECOGNIZE','CANCEL_OPERATION'].includes(a.action)?'investment_operations':'investment_contracts';
  const {data,error}=await supabase.from(table).select('id,user_id,organization_id').eq('id',a.id).maybeSingle();
  if(error)throw error;
  if(!data||!matches(data))throw Error('INVESTMENT_ACCESS_DENIED');
  target=data;
 }
 if(a.action==='SAVE'||a.action==='REPLACE'){
  const terms=payload as z.infer<typeof investmentTermsSchema>;
  const expectedOrganization=target?.organization_id??a.workspace.organization_id;
  if(terms.ownership_scope!==a.workspace.scope||(terms.organization_id??null)!==(expectedOrganization??null))throw Error('INVESTMENT_SCOPE_MISMATCH');
 }
 const {data,error}=await supabase.rpc('investment_command',{p_action:a.action,p_id:a.id??null,p_payload:payload,p_request_id:a.request_id??null});
 if(error)throw error;return data;
}
