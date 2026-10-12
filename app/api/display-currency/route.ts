import {NextResponse} from 'next/server';
import {requireUser} from '../../../services/auth';
/** Read only. The authenticated client and fx_rates RLS determine visible organizations. */
export async function GET(){
 try{
  const {supabase}=await requireUser();
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Riyadh'});
  const latest=new Map<string,Record<string,unknown>>();
  for(let offset=0;offset<50000;offset+=500){
   const {data,error}=await supabase.from('fx_rates').select('id,organization_id,from_currency,to_currency,rate,valuation_date,source').lte('valuation_date',today).gt('rate',0).order('valuation_date',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499);
   if(error)throw error;
   for(const row of data||[]){if(!Number.isFinite(Number(row.rate)))continue;const key=`${row.organization_id||'GLOBAL'}:${row.from_currency}:${row.to_currency}`;if(!latest.has(key)){const {id,...rate}=row;latest.set(key,{...rate,rate:Number(row.rate)});}}
   if((data?.length||0)<500)return NextResponse.json([...latest.values()],{headers:{'Cache-Control':'private, no-store'}});
  }
  return NextResponse.json({error:'FX_REFERENCE_LIMIT_EXCEEDED'},{status:503});
 }catch(e:unknown){const message=e instanceof Error?e.message:'FX_REFERENCE_UNAVAILABLE';return NextResponse.json({error:message},{status:message==='UNAUTHORIZED'?401:500});}
}
