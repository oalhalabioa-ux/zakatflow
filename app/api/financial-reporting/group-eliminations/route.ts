import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {isSameOriginRequest} from '../../../../lib/request-origin';
import {liveSourceBoundGroupPreview} from '../../../../services/financial-group-source-bound-adjustments';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
/** This endpoint intentionally cannot save, approve or publish a worksheet. */
export async function POST(request:Request){
 try{
  if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
  if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
  if(new URL(request.url).search||!request.headers.get('content-type')?.startsWith('application/json'))throw Error('REPORTING_INPUT_INVALID');
  const body=await request.text();if(body.length>200000)throw Error('REPORTING_INPUT_INVALID');
  let input:unknown;try{input=JSON.parse(body)}catch{throw Error('REPORTING_INPUT_INVALID')}
  return NextResponse.json(await liveSourceBoundGroupPreview(input),{headers});
 }catch(error){
  const code=error instanceof Error?error.message:'REPORTING_UNAVAILABLE';
  const inputError=error instanceof ZodError||code==='REPORTING_INPUT_INVALID';
  const status=code==='REPORTING_DISABLED'?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:inputError?400:
   /^GROUP_(ADJUSTMENT|CASH|CAPITAL)_/.test(code)?422:/CHANGED/.test(code)?409:503;
  return NextResponse.json({error:inputError?'REPORTING_INPUT_INVALID':/^(REPORTING_|GROUP_ADJUSTMENT_|GROUP_CASH_|GROUP_CAPITAL_)[A-Z_]+$/.test(code)?code:status===401?'UNAUTHORIZED':'REPORTING_UNAVAILABLE'},{status,headers});
 }
}
