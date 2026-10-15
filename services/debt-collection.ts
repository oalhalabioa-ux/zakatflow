import {z} from 'zod';
import {requireUser} from './auth';
import {financialRegister} from './financial-register';
import {requireOrganizationMember} from './organization-access';
import {followupSchema} from '../lib/debt-collection';
import {riyadhToday} from '../lib/financial-register';
const unwrap=(r:any)=>{if(r.error)throw Error(r.error.message);return r.data};
async function all(q:()=>any){const rows:any[]=[];for(let offset=0;offset<20000;offset+=500){const batch=unwrap(await q().order('created_at',{ascending:false}).order('id').range(offset,offset+499));rows.push(...batch);if(batch.length<500)return rows}throw Error('REPORT_TOO_LARGE')}
export async function debtCollectionWorkspace(scope:'PERSONAL'|'ORGANIZATION',org:string|null,group:boolean){
 const data=await financialRegister(scope,org,group,true),{supabase,user}=await requireUser();
 const [followups,members,permissions]=await Promise.all([
 all(()=>{const q=supabase.from('debt_collection_followups').select('*');return scope==='PERSONAL'?q.eq('user_id',user.id).is('organization_id',null):q.in('organization_id',data.organizationIds)}),
 scope==='ORGANIZATION'?supabase.from('organization_members').select('organization_id,user_id,role').in('organization_id',data.organizationIds).eq('status','ACTIVE').then(unwrap):[],
 scope==='ORGANIZATION'?Promise.all(data.organizationIds.map(async id=>{const [view,write]=await Promise.all(['financial_core.view','financial_core.create'].map(permission=>supabase.rpc('effective_organization_permission',{p_org:id,p_permission:permission,p_amount:null,p_currency:null}).then(unwrap)));if(!view)throw Error('COLLECTION_ACCESS_DENIED');return [id,Boolean(write)];})):[]
 ]);
 const ids=[...new Set<string>(members.map((m:any)=>m.user_id))];const profiles=ids.length?unwrap(await supabase.from('profiles').select('id,name').in('id',ids)):[];
 return {asOf:data.asOf,baseCurrency:data.baseCurrency,organizations:data.organizations.filter(o=>data.organizationIds.includes(o.id)),debts:data.debts.filter(d=>['RECEIVABLE','PAYABLE'].includes(d.side)),movements:data.debtMovements.filter(m=>!m.advance),followups,members:members.map((m:any)=>({...m,name:m.user_id===user.id?'أنا':profiles.find((p:any)=>p.id===m.user_id)?.name||'عضو · '+m.user_id.slice(0,8)})),userId:user.id,canWrite:scope==='PERSONAL'?{'PERSONAL':true}:Object.fromEntries(permissions),warnings:data.warnings};
}
export async function recordDebtFollowup(input:unknown){const p=followupSchema.parse(input);if(p.action_date>riyadhToday())throw Error('FOLLOWUP_DATE_INVALID');const {supabase,user}=await requireUser();if(p.organization_id)await requireOrganizationMember(supabase,user.id,p.organization_id);const data=await financialRegister(p.scope,p.organization_id,false,true),debt=data.debts.find(d=>d.id===p.debt_id&&['RECEIVABLE','PAYABLE'].includes(d.side));if(!debt)throw Error('FOLLOWUP_TARGET_INVALID');if(p.promise_amount>debt.amount)throw Error('PROMISE_EXCEEDS_BALANCE');const {scope,...body}=p;const target_type=scope==='ORGANIZATION'?'CORE':debt.side==='PAYABLE'?'PERSONAL_PAYABLE':'PERSONAL_RECEIVABLE';return {id:unwrap(await supabase.rpc('record_debt_followup',{p_payload:{...body,target_type}}))};}
