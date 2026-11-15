import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {isSameOriginRequest} from '../../../../lib/request-origin';
import {readApprovedGroupAcquisitions,readGroupAcquisitionLedgerBasis} from '../../../../services/financial-group-acquisition-review';
import {readGroupAcquisitionPosition} from '../../../../services/financial-group-acquisition-position';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
/** Approved acquisition-date amounts for the group review worksheet. */
export async function POST(request:Request){
 try{
  if(process.env.FINANCIAL_GROUP_ELIMINATION_PREVIEW!=='true')throw Error('REPORTING_DISABLED');
  if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
  if(new URL(request.url).search||!request.headers.get('content-type')?.startsWith('application/json'))throw Error('REPORTING_INPUT_INVALID');
  const body=await request.text();if(body.length>4096)throw Error('REPORTING_INPUT_INVALID');
  let input:unknown;try{input=JSON.parse(body)}catch{throw Error('REPORTING_INPUT_INVALID')}
  const wantsLedger=typeof input==='object'&&input!==null&&'action' in input;
  if(typeof input==='object'&&input!==null&&'action' in input&&input.action==='ACQUISITION_POSITION')
   return NextResponse.json(await readGroupAcquisitionPosition(input),{headers});
  return NextResponse.json(await (wantsLedger?readGroupAcquisitionLedgerBasis(input):readApprovedGroupAcquisitions(input)),{headers});
 }catch(error){
  const code=error instanceof Error?error.message:'REPORTING_UNAVAILABLE';
  const inputError=error instanceof ZodError||code==='REPORTING_INPUT_INVALID';
  const status=['REPORTING_DISABLED','REPORTING_ACQUISITIONS_NOT_INSTALLED'].includes(code)?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:inputError?400:
   /CHANGED|CONFLICT/.test(code)?409:/^GROUP_(ACQUISITION|CONTROL)_/.test(code)?422:503;
  return NextResponse.json({error:inputError?'REPORTING_INPUT_INVALID':/^(REPORTING_|GROUP_ACQUISITION_|GROUP_CONTROL_)[A-Z_]+$/.test(code)?code:status===401?'UNAUTHORIZED':'REPORTING_UNAVAILABLE'},{status,headers});
 }
}
