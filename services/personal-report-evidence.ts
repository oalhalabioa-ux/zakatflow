import {requireUser} from './auth';
import {personalReportEvidence} from '../lib/personal-report-evidence';
import type {RegisterData} from '../lib/financial-register';

export async function readPersonalReportEvidence(register:RegisterData,to:string){
 const {supabase,user}=await requireUser();
 async function all<T>(read:(first:number,last:number)=>PromiseLike<{data:T[]|null;error:unknown}>){
  const rows:T[]=[];
  for(let offset=0;;offset+=500){
   const {data,error}=await read(offset,offset+499);
   if(error||!data)throw Error('PERSONAL_REPORT_EVIDENCE_UNAVAILABLE');
   rows.push(...data);
   if(data.length<500)return rows;
  }
 }
 const [contracts,movements,funding,transactions,payables]=await Promise.all([
  all((a,b)=>supabase.from('personal_contracts').select('id,product,side,status,currency').eq('user_id',user.id).order('id').range(a,b)),
  all((a,b)=>supabase.from('personal_contract_movements').select('id,contract_id,request_id,kind,amount,operation_date,asset_id,payable_id,transaction_ids,reversed_at,reversal_date')
   .eq('user_id',user.id).lte('operation_date',to).order('id').range(a,b)),
  all((a,b)=>supabase.from('personal_financings').select('cash_transaction_id,kind,side').eq('user_id',user.id).order('id').range(a,b)),
  all((a,b)=>supabase.from('transactions').select('id,asset_account_id,transaction_type,transaction_date,currency,gross_value,quantity,base_currency,base_value,metadata')
   .eq('user_id',user.id).is('organization_id',null).lte('transaction_date',to).order('id').range(a,b)),
  all((a,b)=>supabase.from('personal_payables').select('id,request_id,amount,currency,event_date').eq('user_id',user.id).lte('event_date',to).order('id').range(a,b)),
 ]);
 return personalReportEvidence(register,{contracts,movements,funding,transactions,payables});
}
