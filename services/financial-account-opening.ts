import {requireUser} from './auth';
import {openingFinancialAccountSchema,riyadhToday} from '../lib/financial-register';
/** Shared command for the cash/debt register and asset entry. The RPC is atomic/idempotent. */
export async function openFinancialAccount(input:unknown){
 const p=openingFinancialAccountSchema.parse(input);
 if(p.opening_date>riyadhToday())throw Error('OPENING_DATE_IN_FUTURE');
 const {supabase}=await requireUser();
 const linked=Boolean(p.source_debt_id);
 const {data,error}=await supabase.rpc(linked?'linked_personal_debt_command':p.debt_category?'open_categorized_receivable':'open_financial_account',{p_payload:linked?{operation:'RECEIVABLE',command:p}:p});
 if(error)throw error;return data;
}
