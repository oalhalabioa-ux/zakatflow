import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {isSameOriginRequest} from '../../../../lib/request-origin';
import {centerBranchRegistry,assignCenterBranch,transferCenterBranch} from '../../../../services/financial-center-branch-registry';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
function enabled(){if(process.env.FINANCIAL_CENTER_BRANCH_REGISTRY!=='true')throw Error('CENTER_BRANCH_DISABLED')}
function failed(error:unknown){
 const code=error instanceof Error?error.message:'CENTER_BRANCH_UNAVAILABLE';
 const status=code==='CENTER_BRANCH_DISABLED'?404:code==='UNAUTHORIZED'?401:/DENIED/.test(code)?403:/CONFLICT|OVERLAP/.test(code)?409:error instanceof ZodError||/INVALID|REQUIRED|UNCHANGED/.test(code)?422:503;
 const safe=error instanceof ZodError?'CENTER_BRANCH_INPUT_INVALID':/^CENTER_BRANCH_[A-Z_]+$/.test(code)||code==='UNAUTHORIZED'?code:'CENTER_BRANCH_UNAVAILABLE';
 return NextResponse.json({error:safe},{status,headers});
}
export async function GET(request:Request){
 try{
  enabled();const q=new URL(request.url).searchParams;
  if(q.size!==1||q.getAll('organization').length!==1)throw Error('CENTER_BRANCH_INPUT_INVALID');
  return NextResponse.json(await centerBranchRegistry({organization:q.get('organization')}),{headers});
 }catch(e){return failed(e)}
}
export async function POST(request:Request){
 try{
  enabled();if(!isSameOriginRequest(request))return NextResponse.json({error:'ORIGIN_REQUIRED'},{status:403,headers});
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('CENTER_BRANCH_INPUT_INVALID');
  const text=await request.text();if(text.length>10000)throw Error('CENTER_BRANCH_INPUT_INVALID');
  let value:unknown;try{value=JSON.parse(text)}catch{throw Error('CENTER_BRANCH_INPUT_INVALID')}
  const isTransfer=value!==null&&typeof value==='object'&&'action' in value&&value.action==='transfer';
  return NextResponse.json(await (isTransfer?transferCenterBranch(value):assignCenterBranch(value)),{status:201,headers});
 }catch(e){return failed(e)}
}
