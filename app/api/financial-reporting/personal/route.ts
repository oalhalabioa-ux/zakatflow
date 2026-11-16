import {NextResponse} from 'next/server';
import {z,ZodError} from 'zod';
import {financialRegister} from '../../../../services/financial-register';
import {personalFinancialReports} from '../../../../lib/personal-financial-reports';
import {riyadhToday} from '../../../../lib/financial-register';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const query=z.object({from:z.string().date(),to:z.string().date()}).strict().refine(p=>p.from<=p.to&&p.to<=riyadhToday(),{message:'PERSONAL_REPORT_PERIOD_INVALID'});

/** User's personal books only. No organization or group selector is accepted. */
export async function GET(request:Request){
 try{
  const params=new URL(request.url).searchParams;
  if([...params.keys()].some(key=>!['from','to'].includes(key)||params.getAll(key).length!==1))throw Error('PERSONAL_REPORT_INPUT_INVALID');
  const today=riyadhToday(),period=query.parse({from:params.get('from')??today.slice(0,4)+'-01-01',to:params.get('to')??today});
  const register=await financialRegister('PERSONAL',null,false);
  return NextResponse.json(personalFinancialReports(register,period.from,period.to),{headers});
 }catch(error){
  const message=error instanceof Error?error.message:'',status=message==='UNAUTHORIZED'?401:error instanceof ZodError||/PERSONAL_REPORT_(PERIOD|INPUT)_INVALID/.test(message)?400:503;
  return NextResponse.json({error:status===401?'UNAUTHORIZED':status===400?'PERSONAL_REPORT_INPUT_INVALID':'PERSONAL_REPORT_UNAVAILABLE'},{status,headers});
 }
}
