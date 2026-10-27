import {withVoucherNumbers} from './voucher-numbers';
import {requireUser} from './auth';
import {financialRegister} from './financial-register';
import {personalContractCommandSchema,personalInstallmentBalances,personalContractPlan} from '../lib/personal-contracts';
import {riyadhToday} from '../lib/financial-register';
const unwrap=(r:any)=>{if(r.error)throw Error(r.error.message);return r.data};
async function rows(query:()=>any){const all:any[]=[];for(let i=0;i<20000;i+=500){const r=unwrap(await query().order('id').range(i,i+499));all.push(...r);if(r.length<500)return all;}throw Error('REPORT_TOO_LARGE');}
export async function personalContractsWorkspace(){
 const {supabase,user}=await requireUser();
 const [contracts,movements,register]=await Promise.all([rows(()=>supabase.from('personal_contracts').select('*').eq('user_id',user.id)),rows(()=>supabase.from('personal_contract_movements').select('*').eq('user_id',user.id)),financialRegister('PERSONAL',null,false)]);
 // One canonical balance source; contracts and schedules never add another balance.
 const debt=new Map<string,{amount:number}>();for(const d of register.debts){const key=d.sourceDebtId??d.id;debt.set(key,{amount:(debt.get(key)?.amount??0)+d.amount})}const asset=new Map(register.assets.map(a=>[a.id,a]));
 return withVoucherNumbers(supabase,{register,contracts:contracts.map(c=>{const outstanding=c.status==='POSTED'?(c.asset_id?(c.product==='PARTICIPATION'?asset.get(c.asset_id)?.cost:debt.get(c.asset_id)?.amount):debt.get(c.payable_id)?.amount)??0:0;return {...c,outstanding,schedule:personalInstallmentBalances(c.terms.schedule,Number(c.principal),outstanding),plan:personalContractPlan(c.terms),movements:movements.filter(m=>m.contract_id===c.id).map(m=>({...m,outstanding:m.asset_id?debt.get(m.asset_id)?.amount??0:m.payable_id?debt.get(m.payable_id)?.amount??0:0}))};}),asOf:register.asOf});
}
export async function personalContractAction(input:unknown){const p=personalContractCommandSchema.parse(input);if(p.action==='SAVE'?p.payload.date>riyadhToday():'date'in p&&p.date>riyadhToday())throw Error('DATE_IN_FUTURE');const {supabase}=await requireUser();return unwrap(await supabase.rpc('personal_contract_command',{p_payload:p}));}
