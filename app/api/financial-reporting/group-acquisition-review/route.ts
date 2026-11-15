import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {isSameOriginRequest} from '../../../../lib/request-origin';
import {reviewGroupAcquisition} from '../../../../services/financial-group-acquisition-review';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
/** Draft measurement; no persistence, approval or final financial issuance. */
export async function POST(request:Request){
 try{
  if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
  if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
  if(new URL(request.url).search||!request.headers.get('content-type')?.startsWith('application/json'))throw Error('REPORTING_INPUT_INVALID');
  const body=await request.text();if(body.length>200000)throw Error('REPORTING_INPUT_INVALID');
  let input:unknown;try{input=JSON.parse(body)}catch{throw Error('REPORTING_INPUT_INVALID')}
  return NextResponse.json(await reviewGroupAcquisition(input),{headers});
 }catch(error){
  const code=error instanceof Error?error.message:'REPORTING_UNAVAILABLE';
  const inputError=error instanceof ZodError||code==='REPORTING_INPUT_INVALID';
  const status=code==='REPORTING_DISABLED'?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:inputError?400:
   /CHANGED|CONFLICT/.test(code)?409:/^GROUP_(ACQUISITION|CONTROL)_/.test(code)?422:503;
  return NextResponse.json({error:inputError?'REPORTING_INPUT_INVALID':/^(REPORTING_|GROUP_ACQUISITION_|GROUP_CONTROL_)[A-Z_]+$/.test(code)?code:status===401?'UNAUTHORIZED':'REPORTING_UNAVAILABLE'},{status,headers});
 }
}
