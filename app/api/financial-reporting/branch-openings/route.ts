import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {isSameOriginRequest} from '../../../../lib/request-origin';
import {branchOpeningContext,branchOpeningCommand} from '../../../../services/financial-branch-opening-workspace';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
function failed(error:unknown){
 const code=error instanceof Error?error.message:'BRANCH_OPENING_UNAVAILABLE';
 const status=code==='OPENING_DISABLED'?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:
  /CONFLICT|CHANGED/.test(code)?409:error instanceof ZodError||/INVALID|INCOMPLETE|UNBALANCED|MISMATCH|REQUIRED|DUPLICATE|UNRECOGNIZED/.test(code)?422:503;
 const safe=error instanceof ZodError?'BRANCH_OPENING_INPUT_INVALID':/^BRANCH_OPENING_[A-Z_]+$/.test(code)?code:
  status===401?'UNAUTHORIZED':status===404?'OPENING_DISABLED':'BRANCH_OPENING_UNAVAILABLE';
 return NextResponse.json({error:safe},{status,headers});
}
export async function GET(request:Request){
 try{
  const q=new URL(request.url).searchParams;
  if([...q.keys()].some(key=>!['organization','fiscalStart'].includes(key)||q.getAll(key).length!==1)
    ||q.size!==2)throw Error('BRANCH_OPENING_INPUT_INVALID');
  return NextResponse.json(await branchOpeningContext({organization:q.get('organization'),fiscalStart:q.get('fiscalStart')}),{headers});
 }catch(e){return failed(e)}
}
export async function POST(request:Request){
 try{
  if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('BRANCH_OPENING_INPUT_INVALID');
  const source=await request.text();
  if(source.length>2000000)throw Error('BRANCH_OPENING_INPUT_INVALID');
  let parsed:unknown;
  try{parsed=JSON.parse(source)}catch{throw Error('BRANCH_OPENING_INPUT_INVALID')}
  return NextResponse.json(await branchOpeningCommand(parsed),{headers});
 }catch(e){return failed(e)}
}
