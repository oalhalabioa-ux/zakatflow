import {NextResponse} from 'next/server';
import {z,ZodError} from 'zod';
import {isSameOriginRequest} from '../../../../lib/request-origin';
import {readApprovedGroupEliminations} from '../../../../services/financial-group-elimination-batches';
import {statementQuery} from '../../../../lib/financial-statement-source';
import {readApprovedGroupAcquisitions} from '../../../../services/financial-group-acquisition-review';
import {assertStableFinancialReplay} from '../../../../lib/financial-source-replay';
import {readGroupDocumentCoverage} from '../../../../services/financial-group-document-matches';

const worksheetRequest=z.discriminatedUnion('action',[
 z.object({action:z.literal('EXPORT'),query:statementQuery}).strict(),
 z.object({action:z.literal('DOCUMENT_COVERAGE'),query:statementQuery,identityPage:z.number().int().min(1).max(2147483647).optional()}).strict(),
]);
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
  if(typeof input==='object'&&input!==null&&'action' in input){
   const command=worksheetRequest.parse(input),{query}=command;
   if(command.action==='DOCUMENT_COVERAGE')return NextResponse.json(await readGroupDocumentCoverage(query,command.identityPage??1),{headers});
   const acquisitions=async()=>{
    try{return await readApprovedGroupAcquisitions(query);}
    catch(error){
     // Releases before the acquisition migration can still export eliminations.
     if(error instanceof Error&&error.message==='REPORTING_ACQUISITIONS_NOT_INSTALLED')return {status:'ACQUISITIONS_NOT_INSTALLED',query};
     throw error;
    }
   };
   const first=await acquisitions();
   const worksheet=await readApprovedGroupEliminations(query);
   assertStableFinancialReplay(first,await acquisitions());
   return NextResponse.json({...worksheet,acquisitionReview:first},{headers});
  }
  return NextResponse.json(await readApprovedGroupEliminations(input),{headers});
 }catch(error){
  const code=error instanceof Error?error.message:'REPORTING_UNAVAILABLE';
  const inputError=error instanceof ZodError||code==='REPORTING_INPUT_INVALID';
  const status=code==='REPORTING_DISABLED'?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:inputError?400:
   /CHANGED|CONFLICT/.test(code)?409:/^GROUP_(BATCH|DOCUMENT|CAPITAL|CASH|ADJUSTMENT|ACQUISITION|CONTROL)_/.test(code)?422:503;
  return NextResponse.json({error:inputError?'REPORTING_INPUT_INVALID':/^(REPORTING_|GROUP_BATCH_|GROUP_DOCUMENT_|GROUP_CAPITAL_|GROUP_CASH_|GROUP_ADJUSTMENT_|GROUP_ACQUISITION_|GROUP_CONTROL_)[A-Z_]+$/.test(code)?code:status===401?'UNAUTHORIZED':'REPORTING_UNAVAILABLE'},{status,headers});
 }
}
