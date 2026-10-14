import {requireUser} from './auth';
import {requireOrganizationMember} from './organization-access';
import {debtContractSchema} from '../lib/debt-contracts';
import {executeFinancialEventAction} from './financial-events';
import {z} from 'zod';
const unwrap=(r:any)=>{if(r.error)throw Error(r.error.message);return r.data;};
async function ctx(org:string){z.string().uuid().parse(org);const c=await requireUser();await requireOrganizationMember(c.supabase,c.user.id,org);if(!unwrap(await c.supabase.rpc('effective_organization_permission',{p_org:org,p_permission:'financial_core.view',p_amount:null,p_currency:null})))throw Error('DEBT_CONTRACT_ACCESS_DENIED');return c;}
async function all(q:()=>any){const out:any[]=[];for(let i=0;i<20000;i+=500){const p=unwrap(await q().order('id').range(i,i+499));out.push(...p);if(p.length<500)return out;}throw Error('REPORT_TOO_LARGE');}
export async function debtContracts(org:string){const {supabase}=await ctx(org);const [organization,contracts,parties,accounts,entities]=await Promise.all([
 supabase.from('organizations').select('id,name,base_currency').eq('id',org).single().then(unwrap),all(()=>supabase.from('debt_contracts').select('*').eq('organization_id',org)),all(()=>supabase.from('liquidity_counterparties').select('id,name,party_type').eq('organization_id',org).eq('active',true)),all(()=>supabase.from('liquidity_accounts').select('id,name,currency,entity_id').eq('organization_id',org).eq('active',true)),all(()=>supabase.from('organization_entities').select('id,name').eq('organization_id',org).eq('active',true))]);
 const ids=contracts.map(c=>c.financial_event_id),events=ids.length?await all(()=>supabase.from('financial_events').select('id,status').eq('organization_id',org).in('id',ids)):[],balances=ids.length?await all(()=>supabase.from('financial_event_obligation_balances').select('*').eq('organization_id',org).in('event_id',ids)):[];
 return {organization,parties,accounts,entities,contracts:contracts.map(c=>({...c,status:events.find(e=>e.id===c.financial_event_id)?.status,installments:balances.filter(b=>b.event_id===c.financial_event_id).sort((a,b)=>Number(a.obligation_key?.split(':')[1])-Number(b.obligation_key?.split(':')[1]))}))};}
export async function debtContractAction(input:unknown){const h=z.object({action:z.enum(['CREATE','APPROVE','POST','CANCEL']),organization_id:z.string().uuid()}).passthrough().parse(input);const {supabase}=await ctx(h.organization_id);
 if(h.action==='CREATE'){const {action,...payload}=h;const p=debtContractSchema.parse(payload);return unwrap(await supabase.rpc('create_debt_contract',{p_payload:p}));}
 const p=z.object({action:z.enum(['APPROVE','POST','CANCEL']),organization_id:z.string().uuid(),id:z.string().uuid(),reason:z.string().trim().min(3).max(500)}).strict().parse(input);
 const c=unwrap(await supabase.from('debt_contracts').select('financial_event_id').eq('id',p.id).eq('organization_id',p.organization_id).single());
 if(p.action==='POST')return unwrap(await supabase.rpc('post_debt_contract',{p_id:p.id}));
 return executeFinancialEventAction(p.action==='APPROVE'?{action:'APPROVE',organization_id:p.organization_id,event_id:c.financial_event_id,note:p.reason}:{action:'TRANSITION',organization_id:p.organization_id,event_id:c.financial_event_id,status:'CANCELLED',note:p.reason});}
