import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {isSameOriginRequest} from '../../../../lib/request-origin';
import {readApprovedGroupEliminations} from '../../../../services/financial-group-elimination-batches';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
/** Read-only approved adjustment worksheet; no company ledger writes. */
export async function POST(request:Request){
 try{
  if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
  if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
  if(new URL(request.url).search||!request.headers.get('content-type')?.startsWith('application/json'))throw Error('REPORTING_INPUT_INVALID');
  const body=await request.text();if(body.length>200000)throw Error('REPORTING_INPUT_INVALID');
  let input:unknown;try{input=JSON.parse(body)}catch{throw Error('REPORTING_INPUT_INVALID')}
  return NextResponse.json(await readApprovedGroupEliminations(input),{headers});
 }catch(error){
  const code=error instanceof Error?error.message:'REPORTING_UNAVAILABLE';
  const inputError=error instanceof ZodError||code==='REPORTING_INPUT_INVALID';
  const status=code==='REPORTING_DISABLED'?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:inputError?400:
   /CHANGED|CONFLICT/.test(code)?409:/^GROUP_(BATCH|DOCUMENT|CAPITAL|CASH|ADJUSTMENT)_/.test(code)?422:503;
  return NextResponse.json({error:inputError?'REPORTING_INPUT_INVALID':/^(REPORTING_|GROUP_BATCH_|GROUP_DOCUMENT_|GROUP_CAPITAL_|GROUP_CASH_|GROUP_ADJUSTMENT_)[A-Z_]+$/.test(code)?code:status===401?'UNAUTHORIZED':'REPORTING_UNAVAILABLE'},{status,headers});
 }
}
