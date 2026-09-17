import { requireUser } from './auth';
import { calculateHawl } from '@/engine/hawl';

export async function listLots(){
  const {supabase,user}=await requireUser();
  const {data,error}=await supabase
    .from('lots')
    .select('*,asset_accounts(name,asset_type,currency,is_zakatable),transactions!lots_source_transaction_id_fkey(transaction_date)')
    .eq('user_id',user.id)
    .order('hawl_due_date',{ascending:true,nullsFirst:false});
  if(error)throw error;

  const {data:profile}=await supabase.from('profiles').select('calendar_type').eq('id',user.id).single();
  const calendar=profile?.calendar_type==='GREGORIAN'?'GREGORIAN':'HIJRI_TABULAR';

  return (data??[]).map((l:any)=>{
    // Opening lots can legitimately exist before the portfolio Nisab/Hawl start
    // has been established. Do not construct Invalid Date for those rows.
    if(!l.hawl_start_date){
      return {...l,computed_hawl_due_date:l.hawl_due_date??null};
    }
    const start=new Date(`${l.hawl_start_date}T00:00:00Z`);
    if(Number.isNaN(start.getTime())){
      return {...l,computed_hawl_due_date:l.hawl_due_date??null};
    }
    const due=calculateHawl(calendar,start,new Date()).dueDate;
    return {...l,computed_hawl_due_date:due.toISOString().slice(0,10)};
  });
}
